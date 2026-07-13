// 통합 파이프라인 엔진.
// 흐름(단계 순서·scope·토글·조각할당)은 config(pipeline.json + _meta.pipeline)로,
// 프롬프트·역할은 data 파일(frontmatter 태그 매칭)로 결정한다. — 하드코딩 금지 원칙.
//
// 기존 generateContent(단일 호출)·runAgentPipeline(네이버 전용)을 대체하는 3번째 경로.
// _meta.json에 "engine": "pipeline"이 있는 채널만 이 엔진을 탄다(점진적 도입).

import { type ChannelKey } from "../channels";
import {
  getChannelMeta,
  readChannelFile,
  readChannelFileBase64,
  type ChannelMeta,
} from "../channelFiles";
import { type Provider } from "../aiConfig";
import { callProvider, callProviderForObject, callProviderForObjectWithImages } from "../apiClients";
import { resolveStages, loadPipelineConfig } from "./loadConfig";
import { getRecentFeedback, getRecentExamples, getRecentBadExamples, getRecentResearch, addBadExample, addResearch, contextBudget } from "../pipelineMemory";
import { assembleNaverBlogHtml } from "../htmlAssembler";
import { spliceImageCardsFromArray } from "./imageCards";
import { extractDraftTitle, extractThumbnailSubtitle } from "./thumbnailBuilder";
import { buildCardSvg, buildFallbackCardSvg, buildThumbnailSvg, cardGenerationSchema, imageReviewSchema } from "./cardTemplateBuilder";
import type { CardAsset } from "./cardStorage";
// 페르소나·가이드 로딩/코드펜스 제거는 promptAssembly로 추출(M0 리팩터, 동작 무변화).
import { stripCodeFence, loadPersona, loadAllGuides, selectGuides, guidesText } from "./promptAssembly";
// provider 인증 해석 + 검색-불가 provider 자동 폴백은 auth.ts로 추출(M5 리팩터, 동작 무변화).
import { createAuthResolver } from "./auth";
// captureCards/uploadCards는 @resvg/resvg-js(네이티브 바이너리)를 정적 최상단에서 import하면,
// 실제로 호출하지 않는 Vercel(Next.js API route) 쪽에서도 모듈 로드 시점에 번들링/로딩이
// 실패한다 — 이 파일이 render-worker와 Next.js API route 양쪽에서 import되기 때문에, 아래
// image 단계 안에서만 동적 import(await import)로 지연 로드한다.
import type { ResolvedStage } from "./types";

// ─── 단계 종류 추론 (config의 id로부터 엔진 동작 결정) ──────────
type StageKind = "producer" | "writer" | "reviewer" | "image";
function stageKind(id: string): StageKind {
  if (id === "writer") return "writer";
  if (id.includes("image")) return "image";
  if (id.includes("review")) return "reviewer";
  return "producer"; // research / brainstorm / research-deep / skeleton 등
}

// ─── 동시성 상한을 둔 병렬 map ──────────────────────────────────
// Railway 워커는 채널 최대 5개를 동시에 처리한다(MAX_CONCURRENT, render-worker/index.ts).
// 카드 호출처럼 채널 하나 안에서도 병렬로 여러 번 호출하는 작업을 그냥 Promise.all로 다 풀어버리면,
// 로컬에서 채널 1개만 테스트할 땐 안 걸리다가 실제 배포에서 채널 5개가 겹칠 때 provider API의
// 분당 요청 한도를 순간적으로 초과하기 쉽다 — 여기서 상한을 걸어 실제 운영 동시성 기준으로 안전하게 만든다.
async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── 부분 패치 적용 (전체 재작성 대신 find/replace만) ───────────
// 검수 반려 시 글 전체를 다시 쓰게 하면 출력 토큰이 커서(naver-blog는 최대 24,000 토큰) 느리다 —
// 실측 결과 content-review·tone-review가 각각 최대 3회씩 재시도되면 25분 넘게 걸릴 수 있었다.
// 재시도 횟수가 많은 채널(현재는 naver-blog)만, "무엇을 어떻게 고칠지"를 작은 JSON 패치로만 받아
// 코드에서 문자열 치환한다 — 출력 길이가 훨씬 짧아 응답 속도가 크게 준다.
interface TextPatch { find: string; replace: string; }

function parsePatches(raw: string): TextPatch[] | null {
  const m = raw.trim().match(/\[[\s\S]*\]/); // 모델이 설명을 덧붙였을 경우를 대비해 배열 부분만 추출
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (p): p is TextPatch => typeof p?.find === "string" && typeof p?.replace === "string" && p.find.length > 0
    );
  } catch {
    return null;
  }
}

// patches를 draft에 순서대로 적용. find가 draft에 없으면(모델이 원문을 살짝 다르게 인용)
// 그 항목만 건너뛰고 나머지는 계속 적용한다 — 일부 실패로 전체를 포기하지 않는다.
function applyPatches(draft: string, patches: TextPatch[]): { draft: string; appliedCount: number } {
  let result = draft;
  let appliedCount = 0;
  for (const { find, replace } of patches) {
    if (result.includes(find)) {
      result = result.replace(find, replace);
      appliedCount++;
    }
  }
  return { draft: result, appliedCount };
}

// ─── 기계적 규칙 사전 게이트(naver-blog 전용) ────────────────────
// 이미지 개수·제목 글자수처럼 "셀 수 있는" 규칙까지 LLM 리뷰어가 잡게 하면 반려 왕복(20~50초 +
// 호출 비용)을 그 이유만으로 날린다 — 실측 확인: 이미지 수량 미달로 반려 라운드가 2번 연속
// 낭비된 사례(2026-07-12, 1차 패치가 못 고쳐서 2차에서 같은 사유로 또 반려). writer 완료 직후
// 코드로 먼저 세어보고, 걸리면 짧은 부분 패치 1회만 시도한다 — 그래도 안 고쳐지면 조용히
// content-review로 넘긴다(기존 백스톱 그대로 유지, 이 게이트는 순수 절약용이지 필수 관문이 아님).
// ── 절대 금지 문구(정확한 문자열 매칭 항목) 사전 스캔 ─────────────
// 출처: guide/03-quality-check.md Step 2(블로거 톤·격언체·광고 표현) + agents/tone-reviewer.md
// 판정기준 1~4(금칙어·기계적 종결어미·감정 과잉·괄호 병기) — "판단이 아니라 문자열 매칭"인
// 항목만 포함했다(5~9는 문맥 판단이 필요해 tone-review LLM에 그대로 남긴다).
// 실측 사례(2026-07-12 배포): "함정" 1건이 tone-review 3라운드 내내 다른 위치에서 재등장해
// 결국 미해결로 발행됐다 — 부분 패치가 한 번에 한 곳만 고치다 보니 전체 등장 횟수를 놓쳤기
// 때문. 여기서 문구별 등장 횟수까지 세어 한 번에 알려주면 패치가 전부를 잡을 확률이 높아진다.
const FORBIDDEN_PHRASES: string[] = [
  // tone-reviewer.md 판정기준 1: 금칙어
  "혁신적인", "놀라운", "획기적인", "패러다임", "기적", "소중한", "선사", "선물합니다",
  "최첨단", "꿰뚫다", "절대", "완전히", "완벽하게", "탁월한", "압도적", "극대화",
  "드라마틱", "게임체인저", "판도를 바꾸", "함정", "즉시", "실체",
  // tone-reviewer.md 판정기준 2: 기계적 종결어미
  "해보세요", "해 보세요", "잊지 마세요", "기억하세요", "주목하세요", "함께하세요",
  "만나보세요", "놓치지 마세요",
  // tone-reviewer.md 판정기준 3 + guide 03 "블로거 톤" (중복 제거해 합침)
  "힘드시죠", "지치셨죠", "속상하", "고민이 많으실", "걱정되시", "안녕하세요", "여러분",
  "우와", "대박", "짜잔", "독자분들", "저는", "제가", "알아보겠습니다", "함께 살펴보시죠",
  "도움이 되셨길", "이웃추가", "공감과 댓글",
  // guide 03 "격언체" 고정 문구
  "숫자는 정직하다", "결과는 같았다", "그게 진짜 비용이다", "원인은 단절이다",
  // guide 03 "광고 표현"
  "무료 진단", "무료 체험", "100% 만족", "강력 추천", "지금 바로 클릭",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkForbiddenPhrases(scope: string): string[] {
  const hits: string[] = [];
  for (const phrase of FORBIDDEN_PHRASES) {
    // 앞쪽에 한글 음절이 이어붙지 않은 경우만 매칭 — "제가"가 "문제가"(문제+가) 안에, "기적"이
    // "전기적"·"유기적" 안에 우연히 낀 경우를 잡아내지 않기 위함(실측 오탐 발견). 한국어는
    // 조사가 뒤에 바로 붙으므로(예: "함정을") 뒤쪽은 제한하지 않는다 — 앞쪽만 막아도 목적 달성.
    const re = new RegExp(`(?<![가-힣])${escapeRegExp(phrase)}`, "g");
    const count = (scope.match(re) ?? []).length;
    if (count > 0) hits.push(`"${phrase}" — ${count}회 등장(전부 다른 표현으로 교체)`);
  }
  // tone-reviewer.md 판정기준 4: 용어 뒤 영문 괄호 병기(예: AX(AI transformation))
  const parenMatches = scope.match(/[A-Za-z]+\s*\([A-Za-z\s]+\)/g) ?? [];
  if (parenMatches.length > 0) {
    hits.push(
      `용어 뒤 영문 괄호 병기 ${parenMatches.length}건(예: "${parenMatches[0]}") — 괄호 설명을 제거하고 원어만 남기세요.`
    );
  }
  return hits;
}

function checkMechanicalRules(draft: string): string[] | null {
  const publishBlock = draft.match(/<!-- PUBLISH:START -->([\s\S]*?)<!-- PUBLISH:END -->/);
  const scope = publishBlock ? publishBlock[1] : draft;
  const issues: string[] = [];

  const imageCount = (scope.match(/\[IMAGE:\s*[^\]]+\]/g) ?? []).length;
  if (imageCount < 4 || imageCount > 6) {
    issues.push(
      `이미지 마커([IMAGE: ...])가 ${imageCount}개입니다. 4~6개가 되도록 마커를 추가하거나 ` +
      `제거하세요(내용이 있는 소제목 아래 배치, 비교표·수치 나열형 정보는 마커 대신 마크다운 표로).`
    );
  }

  const title = extractDraftTitle(draft);
  const titleLen = title.length;
  if (title && (titleLen < 22 || titleLen > 35)) {
    issues.push(
      `제목("${title}")이 공백 포함 ${titleLen}자입니다. 22~35자가 되도록 수정하세요 ` +
      `(핵심 키워드는 맨 앞 유지, 의미가 바뀌지 않게 줄이거나 보강).`
    );
  }

  issues.push(...checkForbiddenPhrases(scope));

  return issues.length > 0 ? issues : null;
}

// ─── 검수 결과 판정 (JSON verdict 또는 텍스트 PASS/FAIL/REJECT) ─
function isRejected(reviewOutput: string): boolean {
  const s = reviewOutput.trim();
  const vm = s.match(/"verdict"\s*:\s*"([^"]+)"/i);
  if (vm) return /reject|fail/i.test(vm[1]);
  const nm = s.match(/"is_natural"\s*:\s*(true|false)/i);
  if (nm) return nm[1].toLowerCase() === "false";
  const first = s.split("\n")[0]?.trim().toUpperCase() ?? "";
  if (first.startsWith("REJECT") || first.startsWith("FAIL")) return true;
  if (first.startsWith("APPROVE") || first.startsWith("PASS")) return false;
  return /\bREJECT\b|반려/i.test(s) && !/\bAPPROVED\b|승인/i.test(s);
}

export async function runPipeline(
  channel: ChannelKey,
  topic: string,
  userDraft: string,
  token: string | undefined,
  provider: Provider,
  statusCallback?: (status: string) => Promise<void>,
  apiKeyOverride?: string,
  // 이미지 카드가 실제 PNG로 캡처·업로드되면 호출자에게 전달(기존 반환 타입은 유지 — 다른 호출부에
  // 영향 없음). 콜백이 없으면 업로드 자체를 시도하지 않는다(예: 로컬 dev fallback 경로).
  onCardAssets?: (assets: CardAsset[]) => void,
  // [M6] run_id로 finalize된 브레인스토밍 결과(리서치+심화+스켈레톤)를 여러 채널이 공유할 때
  // 채널별 runPipeline 호출마다 이 문자열을 그대로 주입한다. contextParts 최우선에 push되어
  // 이 채널의 자체 producer 단계보다 먼저 writer/producer에게 전달된다.
  sharedContext?: string,
  // 브라우저에서 고른 모델(활성 provider용) — 워커가 env/기본값 대신 이 모델로 강제한다.
  // pipeline.json에 단계별 modelId가 명시된 경우엔 그게 우선(auth.ts에서 처리).
  modelOverride?: string,
  // [M8 재개선] 사용자가 준 개선 방향 — writer에 주입. includeAccumulated면 누적 리서치도 참고.
  improveDirection?: string,
  includeAccumulated?: boolean,
  // [M8 ④] 컨텍스트 참조 예산('light'|'normal'|'heavy') — 누적 주입 건수·길이 조절.
  contextBudgetName?: string
): Promise<string> {
  const meta: ChannelMeta = await getChannelMeta(channel, token);
  const draftProvided = !!(userDraft && userDraft.trim());
  const stages = resolveStages(channel, meta, { draftProvided });
  const bud = contextBudget(contextBudgetName);

  console.log(`[engine] ${channel}: 활성 단계 ${stages.length}개 → ${stages.map(s => s.id).join(", ")}`);

  if (stages.length === 0) {
    throw new Error(`[engine] ${channel}: 활성화된 파이프라인 단계가 없습니다. pipeline.json / _meta.pipeline을 확인하세요.`);
  }

  if (provider === "mock") {
    return `[engine mock] ${channel} · ${topic} · 단계: ${stages.map(s => s.id).join(">")}`;
  }

  // ── Provider 인증 해석 + 검색-불가 provider 자동 폴백 (auth.ts 공용 모듈에 위임, M5 리팩터 — 동작 무변화) ──
  const { resolveAuth, resolveModelFor } = createAuthResolver(token, provider, apiKeyOverride, modelOverride);

  const baseAuth = await resolveAuth(provider);
  if (!baseAuth) {
    throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
  }

  // 단계의 provider/model 해석. 명시 지정한 provider 키가 워커에 없으면 명확한 에러(조용한 폴백 금지).
  const resolveStageModel = (s: ResolvedStage) =>
    resolveModelFor({ model: s.model, modelId: s.modelId, useSearch: s.useSearch, stageId: s.id });

  // ── LLM 호출 헬퍼 (provider·model을 인자로 받음) — apiClients.callProvider에 위임 ──
  const call = (
    p: Provider, apiKey: string, model: string,
    system: string, user: string, maxTokens: number,
    useSearch: boolean, disableThinking: boolean,
    onSource?: (n: number) => void,
    // config-driven: 단계에 thinking 예산이 설정된 경우에만 Claude 네이티브 thinking 활성화.
    // claude 경로에서만 유효(gemini는 자체 thinkingConfig, openai는 무관). 검색 단계는 미적용.
    thinkingBudget?: number
  ): Promise<string> =>
    callProvider(p, apiKey, model, system, user, maxTokens, {
      useSearch, disableThinking, onSearchSource: onSource, thinkingBudget,
    });

  const allGuides = await loadAllGuides(channel, token);

  // 누적 컨텍스트(producer 산출물) + 현재 초안
  const contextParts: string[] = [];
  if (sharedContext) contextParts.push(sharedContext);
  if (draftProvided) {
    contextParts.push(`[작성자 초안]\n${userDraft}`);
    // [M8] 충실한 개선 지시 — 초안 개선(모드 B) 시 원문을 통째 재작성하지 않도록 명시.
    contextParts.push(
      `[개선 지시] 위 [작성자 초안]을 개선하라. 초안의 핵심 논지·메시지·목소리는 최대한 보존하고, ` +
      `근거 부족·논리 비약·표현 약점만 보강한다. 통째 재작성 금지. 채널 형식엔 맞추되 초안의 본질은 유지한다. ` +
      `(위 리서치 산출물이 있으면 약한 주장의 근거로 활용)`
    );
  }
  // [M8 재개선] 사용자가 지정한 개선 방향(최우선 반영). 초안 보존 원칙과 상충하면 이 방향을 우선한다.
  if (improveDirection && improveDirection.trim()) {
    contextParts.push(`[사용자 개선 방향 — 최우선 반영]\n${improveDirection.trim()}`);
  }
  // [M8 재개선 ②] 전체 누적 리서치도 참고(관련도 아닌 최신순 — 참고용 보조).
  if (includeAccumulated) {
    const acc = await getRecentResearch(bud.research, bud.researchDays).catch(() => []);
    if (acc.length) {
      contextParts.push(`[누적 리서치 참고]\n${acc.map(r => `- (${r.stage}) ${r.content.slice(0, bud.cap)}`).join("\n")}`);
    }
  }

  // 동적 컨텍스트(Phase 4): 누적 피드백(전 단계) + 우수작 퓨샷(writer 전용)
  // 서로 무관한 조회 3개라 순차 대기 대신 병렬 실행(brainstorm 경로와 동일 패턴).
  const [feedback, exampleTexts, badExamples] = await Promise.all([
    getRecentFeedback(channel, bud.feedback).catch(() => []),
    getRecentExamples(channel, bud.examples).catch(() => []),
    getRecentBadExamples(channel, bud.bad).catch(() => []),
  ]);
  if (feedback.length) {
    contextParts.push(`[누적 피드백 — 아래 지적을 반드시 반영]\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`);
    console.log(`[engine] ${channel}: 누적 피드백 ${feedback.length}개 주입`);
  }
  // 저장 시점(pipelineMemory.addExample)에 이미지 데이터를 걷어내지만, 그 전에 저장된 옛 데이터나
  // 다른 경로로 들어온 비정상적으로 큰 항목까지 방어하기 위해 주입 시점에도 상한을 둔다(2중 안전장치).
  // 실측 사고: 우수작 1건이 701KB로 저장돼 있어 재주입 시 writer 프롬프트가 129만 토큰까지 불어나
  // Claude 컨텍스트 한도(100만 토큰)를 넘겨 생성이 실패했다. 8000자면 이 채널 목표 분량(3,500~5,000자)의
  // 완성된 글 하나를 온전히 담고도 여유가 있다.
  const EXAMPLE_INJECT_CAP = 8000;
  const exampleBlock = exampleTexts.length
    ? `[우수 참고작 — 이 톤·구조·품질을 따르되 내용은 주제에 맞게 새로 작성]\n${exampleTexts.map((e, i) => {
        const truncated = e.length > EXAMPLE_INJECT_CAP;
        if (truncated) console.warn(`[engine] ${channel}: 우수 참고작 ${i + 1}번이 ${e.length}자라 ${EXAMPLE_INJECT_CAP}자로 잘라 주입(비정상적으로 큰 저장 데이터로 추정)`);
        return `─ 참고작 ${i + 1} ─\n${e.slice(0, EXAMPLE_INJECT_CAP)}${truncated ? "\n[...이하 생략]" : ""}`;
      }).join("\n\n")}`
    : "";
  if (exampleTexts.length) console.log(`[engine] ${channel}: 우수 참고작 ${exampleTexts.length}개 주입`);

  const badBlock = badExamples.length
    ? `[과거 기각 사례 — 검수에서 지적된 문제. 아래 같은 표현·패턴을 반드시 피할 것]\n${badExamples.map((b, i) => `${i + 1}. (${b.reason ?? ""}) ${b.content.slice(0, bud.cap)}`).join("\n")}`
    : "";
  if (badExamples.length) console.log(`[engine] ${channel}: 기각 사례 ${badExamples.length}개 주입(회피용)`);

  let draft = "";
  let writerSystemBase = ""; // 검수 반려 시 재작성에 재사용
  let writerCall: { p: Provider; apiKey: string; model: string } =
    { p: provider, apiKey: baseAuth.apiKey, model: baseAuth.model }; // 재작성은 writer 모델로
  let replacedCards: string[] = []; // image 단계에서 만든 카드 HTML (플레이스홀더 → 최종 치환용)
  // 검수 재시도(maxRetries)를 다 쓴 뒤에도 마지막 패치가 실제로 문제를 해결했는지 재검수해서
  // 안 고쳐졌으면 여기 쌓는다 — 예전엔 마지막 라운드 패치를 재검수 없이 그냥 통과 처리해서,
  // "발행됐는데 사실 못 고친 문제가 남아있다"를 아무도 모르는 채 넘어갔다(실측 확인된 문제).
  // 결과 HTML 맨 앞에 주석으로 남겨 최소한 흔적은 남긴다.
  const unresolvedReviewIssues: string[] = [];

  for (const stage of stages) {
    const kind = stageKind(stage.id);
    const persona = await loadPersona(channel, stage.persona ?? stage.id, token);
    if (!persona) {
      console.warn(`[engine] ${channel}/${stage.id}: 페르소나 '${stage.persona ?? stage.id}' 파일 없음 → 단계 건너뜀`);
      continue;
    }
    const selected = selectGuides(allGuides, stage);
    const stageGuides = guidesText(selected);
    const maxTok = stage.maxTokens ?? 4096;
    const { p: sp, apiKey: sk, model: sm } = await resolveStageModel(stage);
    if (statusCallback) await statusCallback(stage.id);
    console.log(`[engine] ${channel} · ${stage.id}(${kind}) — 모델 ${sp}/${sm} · 조각 ${selected.length}개${selected.length ? " [" + selected.map(g => g.path).join(", ") + "]" : ""}`);

    if (kind === "producer") {
      const system = persona + stageGuides;
      const user =
        `[주제]\n${topic}\n\n` +
        (contextParts.length ? `[이전 단계 산출물]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
        `위 정보를 바탕으로 이 단계의 역할을 수행해 결과를 직접 출력하세요.`;
      const out = stripCodeFence(await call(sp, sk, sm, system, user, maxTok, stage.useSearch, stage.disableThinking,
        (n) => { if (statusCallback) void statusCallback(`소스 ${n}개 검색 중`); }, stage.thinking?.budgetTokens));
      if (out.trim()) {
        contextParts.push(`[${stage.id} 산출물]\n${out}`);
        // 웹서치 단계 산출물은 자료실용으로 아카이브(자동 저장) — fire-and-forget.
        // 품질 게이트: 실제 검색으로 출처가 붙은 결과만 저장한다(apiClients가 성공 시
        // 본문 끝에 "[출처]" 섹션을 덧붙임). 출처가 없으면 근거 없는 응답이므로
        // "리서치"로 저장하지 않는다 — 예전엔 검색 실패 폴백 산출물까지 무조건 저장했음.
        if (stage.useSearch) {
          if (out.includes("[출처]")) void addResearch(channel, stage.id, topic, out);
          else console.warn(`[engine] ${channel} · ${stage.id}: 출처 없는 리서치 산출물 → 아카이브 건너뜀`);
        }
      }
      console.log(`[engine] ${channel} · ${stage.id} 완료 (${out.length}자)`);

    } else if (kind === "writer") {
      const system = persona + stageGuides;
      writerSystemBase = system;
      writerCall = { p: sp, apiKey: sk, model: sm };
      const user =
        `[주제]\n${topic}\n\n` +
        (contextParts.length ? `[참고 자료 — 이전 단계 산출물]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
        (exampleBlock ? `${exampleBlock}\n\n` : "") +
        (badBlock ? `${badBlock}\n\n` : "") +
        `위 자료와 시스템 프롬프트의 가이드 규칙을 철저히 적용해 ${channel} 채널 콘텐츠를 완성하세요.`;
      draft = stripCodeFence(await call(sp, sk, sm, system, user, maxTok, false, meta.disableThinking ?? false));
      if (!draft.trim()) throw new Error(`[engine] ${channel} writer 단계 결과가 비어 있습니다.`);
      console.log(`[engine] ${channel} · writer 완료 (${draft.length}자)`);

      if (channel === "naver-blog") {
        // 금칙 문구는 등장 위치가 여러 곳일 수 있어(실측: "함정" 재발 사례), 패치 1회로 안 끝나면
        // 최대 2회까지 재검사→재패치를 반복한다. 그래도 안 지워지면 기존처럼 content-review로
        // 넘어가는 백스톱은 그대로 유지(발행 자체를 막지 않음).
        const MAX_MECHANICAL_FIX_ATTEMPTS = 2;
        for (let attempt = 1; attempt <= MAX_MECHANICAL_FIX_ATTEMPTS; attempt++) {
          const mechanicalIssues = checkMechanicalRules(draft);
          if (!mechanicalIssues) break;
          console.log(`[engine] ${channel} · writer 기계적 규칙 위반 ${mechanicalIssues.length}건(시도 ${attempt}/${MAX_MECHANICAL_FIX_ATTEMPTS}) — 짧은 수정 요청: ${mechanicalIssues.join(" / ")}`);
          const fixUser =
            `[현재 원고]\n${draft}\n\n` +
            `[고쳐야 할 문제 — 아래 항목만 정확히 고치는 부분 수정만 제시, 다른 내용은 절대 건드리지 마십시오. ` +
            `등장 횟수가 2회 이상인 항목은 해당하는 모든 위치를 빠짐없이 각각 패치로 제시하십시오]\n` +
            mechanicalIssues.map(i => `- ${i}`).join("\n") + "\n\n" +
            `[출력 형식 — 반드시 이 형식만, 다른 설명 금지]\n` +
            `[{"find": "원고에 실제로 있는 문자열 그대로", "replace": "수정된 문자열"}, ...]`;
          try {
            const patchRaw = stripCodeFence(
              await call(writerCall.p, writerCall.apiKey, writerCall.model, writerSystemBase, fixUser, 2048, false, true)
            );
            const patches = parsePatches(patchRaw);
            if (patches && patches.length > 0) {
              const { draft: patched, appliedCount } = applyPatches(draft, patches);
              if (appliedCount > 0) {
                draft = patched;
                console.log(`[engine] ${channel} · writer 기계적 규칙 수정 패치 ${appliedCount}/${patches.length}건 적용(시도 ${attempt}/${MAX_MECHANICAL_FIX_ATTEMPTS})`);
              }
            }
          } catch (e) {
            console.warn(`[engine] ${channel} · writer 기계적 규칙 수정 호출 실패(시도 ${attempt}/${MAX_MECHANICAL_FIX_ATTEMPTS}): ${e instanceof Error ? e.message : e}`);
            break;
          }
        }
        if (checkMechanicalRules(draft)) {
          console.warn(`[engine] ${channel} · writer 기계적 규칙 여전히 미해결 — content-review에서 다시 걸러짐(기존 백스톱)`);
        }
      }

    } else if (kind === "reviewer") {
      if (!draft.trim()) { console.warn(`[engine] ${channel}/${stage.id}: 검수할 초안 없음 → 건너뜀`); continue; }
      // maxRetries 미지정(기본 1)이면 기존과 완전히 동일한 동작: 반려 시 재작성 1회 후 재검수 없이 진행.
      // maxRetries > 1인 채널(예: naver-blog)만 "재작성 → 같은 검수기로 재검수"를 반복한다.
      const maxRewrites = Math.max(1, stage.maxRetries ?? 1);
      // naver-blog는 재시도가 최대 3회×2단계라 매번 전체 재작성이면 25분 넘게 걸릴 수 있다(실측).
      // 부분 패치로 전환해 응답 길이를 줄인다 — 다른 채널은 재시도가 1회뿐이라(위 주석 참고)
      // 기존 전체 재작성 방식을 그대로 둔다(동작 영향 없음).
      const usePatchRewrite = channel === "naver-blog";
      // 직전 라운드 지적사항 — 다음 라운드 검수 프롬프트에 "실제로 해소됐는지 최우선 확인"으로 넘겨준다.
      // 매 라운드가 백지에서 다시 훑다 보니 새로 발견한 문제에 집중하느라, 다른 라운드의 패치가 실수로
      // 되살린 과거 문제의 재발을 놓치는 경향이 실측 확인됐다(2026-07-13, 괄호 병기가 1라운드에 고쳐졌다가
      // 3라운드에 재발). maxRewrites=1인 채널은 review()가 한 번만 불려서 이 변수가 실질적으로 안 쓰인다
      // (동작 영향 없음).
      let previousReviewReason: string | null = null;
      for (let rewriteCount = 0; ; rewriteCount++) {
        // 검수기도 자기에게 할당된 조각(예: tone-review ← 금지어 사전)을 받는다.
        const reviewUser = previousReviewReason
          ? `[직전 라운드 지적사항 — 아래 문제가 실제로 해소됐는지 최우선으로 확인하고, 다른 문제도 계속 점검하십시오]\n${previousReviewReason}\n\n[검수 대상]\n${draft}`
          : `[검수 대상]\n${draft}`;
        const review = stripCodeFence(await call(sp, sk, sm, persona + stageGuides, reviewUser, maxTok, false, false, undefined, stage.thinking?.budgetTokens));
        if (!isRejected(review)) {
          console.log(rewriteCount > 0
            ? `[engine] ${channel} · ${stage.id} 재작성 ${rewriteCount}회 후 통과`
            : `[engine] ${channel} · ${stage.id} 통과`);
          break;
        }
        previousReviewReason = review.replace(/\s+/g, " ").slice(0, 500);
        if (statusCallback) await statusCallback(`${stage.id} 반영 재작성`);
        console.log(`[engine] ${channel} · ${stage.id} 반려(${rewriteCount + 1}/${maxRewrites}차) → 재작성 | 사유: ${review.replace(/\s+/g, " ").slice(0, 300)}`);
        // 기각 사례 자동 저장(회피 학습용) — 초안 통째가 아니라 "검수 피드백(사유+문제 문장)"만 저장. fire-and-forget
        void addBadExample(channel, review.replace(/\s+/g, " ").slice(0, 700), stage.id);
        const rewriteSystem = writerSystemBase || ((await loadPersona(channel, "writer", token)) ?? "");
        // 마지막 라운드는 부분 패치 대신 전체 재작성으로 폴백(naver-blog 한정) — 재시도 횟수는 그대로 두고
        // 마지막 기회의 해결 확률만 높인다. 2라운드 연속 패치로도 해결 안 됐다면 부분 패치 자체의 한계일
        // 가능성이 높다(실측: 2026-07-13 content-review 3/3 반려 후 미해결 발행 사례).
        const isLastRound = rewriteCount + 1 >= maxRewrites;

        if (usePatchRewrite && !isLastRound) {
          const patchUser =
            `[주제]\n${topic}\n\n` +
            `[현재 원고]\n${draft}\n\n` +
            `[검수 피드백 — 아래 문제를 해결하기 위한 부분 수정만 제시]\n${review}\n\n` +
            `[출력 형식 — 반드시 이 형식만 출력, 다른 설명·마크다운·코드펜스 금지]\n` +
            `전체 원고를 다시 쓰지 마십시오. 지적된 문제를 고치는 데 필요한 부분만 정확히 짚어 아래 ` +
            `JSON 배열로만 출력하십시오. "find"는 [현재 원고]에 등장하는 문자열과 공백·줄바꿈까지 ` +
            `정확히 일치해야 하며, "replace"는 그 자리를 대체할 새 문자열입니다. 문제와 무관한 부분은 ` +
            `절대 건드리지 마십시오.\n` +
            `[{"find": "원고에 실제로 있는 문장 그대로", "replace": "수정된 문장"}, ...]`;
          // 재작성은 writer 모델로 (검수기 모델이 아니라). 패치는 출력이 짧으므로 사고모드를 끄고
          // 토큰 예산도 작게 잡아 속도를 최대화한다.
          let patchRaw = stripCodeFence(
            await call(writerCall.p, writerCall.apiKey, writerCall.model, rewriteSystem, patchUser, 4096, false, true)
          );
          let patches = parsePatches(patchRaw);
          // 파싱 실패 시 같은 라운드 안에서 1회 즉시 재시도 — 예전엔 여기서 그냥 포기하고 다음 반려
          // 사이클로 넘어가 라운드 하나를 통째로 날렸다(실측 확인, 2026-07-13 content-review 1라운드).
          if (!patches) {
            const retryUser = `${patchUser}\n\n[이전 응답이 유효한 JSON 배열이 아니었습니다. 다른 설명 없이 지정된 JSON 배열만 다시 출력하세요.]`;
            try {
              patchRaw = stripCodeFence(
                await call(writerCall.p, writerCall.apiKey, writerCall.model, rewriteSystem, retryUser, 4096, false, true)
              );
              patches = parsePatches(patchRaw);
            } catch { /* 재시도도 실패 — 아래서 그대로 처리 */ }
          }
          if (patches && patches.length > 0) {
            const { draft: patched, appliedCount } = applyPatches(draft, patches);
            if (appliedCount > 0) {
              draft = patched;
              console.log(`[engine] ${channel} · ${stage.id} 부분 패치 ${appliedCount}/${patches.length}건 적용`);
              // 기계적 회귀 스캔 — 방금 패치가 금칙어·괄호병기 등 다른 규칙을 실수로 되살렸는지 즉시
              // 확인한다. 다음 라운드의 비싼 LLM 리뷰를 기다리지 않고 그 자리에서 싼 패치로 고친다.
              const regressed = checkMechanicalRules(draft);
              if (regressed) {
                console.log(`[engine] ${channel} · ${stage.id} 패치 후 기계적 규칙 회귀 ${regressed.length}건 감지 — 즉시 재패치: ${regressed.join(" / ")}`);
                const fixUser =
                  `[현재 원고]\n${draft}\n\n` +
                  `[고쳐야 할 문제 — 아래 항목만 정확히 고치는 부분 수정만 제시, 다른 내용은 절대 건드리지 마십시오]\n` +
                  regressed.map(i => `- ${i}`).join("\n") + "\n\n" +
                  `[출력 형식 — 반드시 이 형식만, 다른 설명 금지]\n` +
                  `[{"find": "원고에 실제로 있는 문자열 그대로", "replace": "수정된 문자열"}, ...]`;
                try {
                  const fixRaw = stripCodeFence(
                    await call(writerCall.p, writerCall.apiKey, writerCall.model, rewriteSystem, fixUser, 2048, false, true)
                  );
                  const fixPatches = parsePatches(fixRaw);
                  if (fixPatches && fixPatches.length > 0) {
                    const { draft: refixed, appliedCount: fixApplied } = applyPatches(draft, fixPatches);
                    if (fixApplied > 0) {
                      draft = refixed;
                      console.log(`[engine] ${channel} · ${stage.id} 회귀 재패치 ${fixApplied}/${fixPatches.length}건 적용`);
                    }
                  }
                } catch (e) {
                  console.warn(`[engine] ${channel} · ${stage.id} 회귀 재패치 실패: ${e instanceof Error ? e.message : e}`);
                }
              }
            } else {
              console.warn(`[engine] ${channel} · ${stage.id} 패치 ${patches.length}건 모두 원고에서 못 찾음 — 원고 변경 없이 진행`);
            }
          } else {
            console.warn(`[engine] ${channel} · ${stage.id} 패치 응답 파싱 실패(재시도 포함) — 원고 변경 없이 진행`);
          }
        } else {
          const rewriteUser =
            `[주제]\n${topic}\n\n` +
            (contextParts.length ? `[참고 자료]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
            `[이전 원고]\n${draft}\n\n` +
            `[검수 피드백 — 아래 문제를 모두 해결해 전체를 다시 작성]\n${review}`;
          // 재작성은 writer 모델로 (검수기 모델이 아니라)
          const revised = stripCodeFence(await call(writerCall.p, writerCall.apiKey, writerCall.model, rewriteSystem, rewriteUser, meta.maxTokens ?? 24000, false, meta.disableThinking ?? false));
          if (revised.trim()) draft = revised;
        }

        if (isLastRound) {
          if (maxRewrites > 1) {
            // 예전엔 여기서 바로 break해서 "마지막 라운드 패치가 실제로 문제를 고쳤는지"를 아무도
            // 확인 안 했다(직전 라운드들은 "다음 반복의 review 호출"이 사실상 재검수 역할을 했지만,
            // 정의상 마지막 라운드만은 그 다음 반복이 없어 재검수를 못 받았다 — 실측 확인된 문제,
            // 2026-07-12 naver-blog 생성에서 제목 글자수·경쟁사 인용 위반이 재검수 없이 그대로
            // 발행됨). 최소 한 번은 재검수해서, 그래도 안 고쳐졌으면 최소한 흔적이라도 남긴다.
            const finalReview = stripCodeFence(await call(sp, sk, sm, persona + stageGuides, `[검수 대상]\n${draft}`, maxTok, false, false, undefined, stage.thinking?.budgetTokens));
            if (isRejected(finalReview)) {
              const summary = finalReview.replace(/\s+/g, " ").slice(0, 200);
              console.error(`[engine] ${channel} · ${stage.id} 최대 재작성(${maxRewrites}회) 소진 — 마지막 패치도 미해결: ${summary}`);
              unresolvedReviewIssues.push(`${stage.id}: ${summary}`);
            } else {
              console.log(`[engine] ${channel} · ${stage.id} 최대 재작성(${maxRewrites}회) 후 마지막 패치로 통과 확인`);
            }
          }
          break;
        }
      }

    } else if (kind === "image") {
      const allImageMarkers = [...draft.matchAll(/\[IMAGE:\s*([^\]]+)\]/g)];
      // naver-blog(html) 최종 조립은 <!-- PUBLISH:START/END --> 블록 안쪽만 채택하고 나머지는
      // 버린다(assembleNaverBlogHtml). 그런데 여기서 마커를 draft 전체에서 세면, PUBLISH 블록
      // 밖(NOTES 등)에 우연히 섞인 마커까지 카드로 만들어버려 "카드는 8장 만들었는데 실제 글엔
      // 6장만 들어감" 같은 개수 불일치가 실측 확인됐다 — cardAssets 개수와 본문 <figure> 개수가
      // 어긋나면 SVG 다운로드 버튼이 숨겨지고 PNG도 저화질 폴백으로 떨어진다. PUBLISH 블록이
      // 있으면 그 범위 안의 마커만, 없으면(다른 채널·형식) 기존대로 draft 전체를 그대로 쓴다.
      const publishBlock = draft.match(/<!-- PUBLISH:START -->([\s\S]*?)<!-- PUBLISH:END -->/);
      const imageMarkers = publishBlock
        ? allImageMarkers.filter(m =>
            m.index! >= publishBlock.index! && m.index! < publishBlock.index! + publishBlock[0].length)
        : allImageMarkers;
      if (imageMarkers.length === 0) {
        console.log(`[engine] ${channel} · ${stage.id}: [IMAGE:...] 마커 없음 → 건너뜀`);
        continue;
      }

      // 대표 썸네일(마커 인덱스 0)은 LLM이 손으로 그리지 않는다 — 매번 색상·레이아웃·마커
      // 문법이 조금씩 달라지며 같은 계열 버그가 반복 재발했기 때문. cardTemplateBuilder.ts의
      // buildThumbnailSvg()가 제목·부제·마스코트 세 값만으로 결정적으로 SVG를 조립한다
      // (디자인 값 자체가 그 함수 안에 있다 — 이전처럼 별도 템플릿 파일을 읽지 않는다).
      let mascotDataUri: string | null = null;
      try {
        const mascotB64 = await readChannelFileBase64(channel, "assets/mascot.png", token);
        mascotDataUri = `data:image/png;base64,${mascotB64}`;
      } catch (e) {
        console.warn(`[engine] ${channel} · ${stage.id} 마스코트 로드 실패(마스코트 없이 썸네일 진행): ${e instanceof Error ? e.message : e}`);
      }
      // 실패해도 빈 문자열이 아니라 항상 유효한 SVG를 반환한다 — 마커 인덱스 정렬 유지를 위해
      // 아래에서 이 값을 걸러내지(filter) 않고 그대로 배열에 포함시킨다.
      const thumbnailSvg = buildThumbnailSvg(
        extractDraftTitle(draft),
        extractThumbnailSubtitle(draft),
        mascotDataUri
      );

      const bodyMarkerCount = imageMarkers.length - 1;
      const system = persona + stageGuides;
      // svg 외에 user/fallbackText도 들고 있는 이유: image-review 단계(있으면)가 REJECT한 카드를
      // 재생성할 때 이 프롬프트를 그대로(피드백만 덧붙여) 재사용한다 — 처음부터 다시 조립할
      // 필요 없게.
      let bodyResults: { svg: string; user: string; fallbackText: string }[] = [];

      if (bodyMarkerCount > 0) {
        // 카드 1개당 호출 1개로 병렬 실행(이전엔 N개 카드를 호출 1번에 순서대로 다 쓰게 시켜서,
        // 응답이 잘리면 뒤쪽 카드가 통째로 사라져 ImageCardCountMismatchError로 단계 전체가
        // 실패했다 — 카드별로 나누면 그 카드 슬롯만 buildFallbackCardSvg로 채워 개수가 항상
        // 마커 수와 일치하고, 응답도 병렬이라 더 빠르다).
        // 채널 하나 안에서의 카드 동시 호출 상한. 채널 자체가 이미 최대 5개까지 동시에 돌 수
        // 있으므로(위 주석 참고) 이 값 × 5가 provider에 실제로 튀는 최악의 동시 요청 수가 된다.
        const CARD_CONCURRENCY = 3;
        const bodyMarkers = imageMarkers.slice(1); // 인덱스 0(썸네일) 제외 — 본문 카드에 대응하는 마커들
        const cardIndexes = Array.from({ length: bodyMarkerCount }, (_, i) => i);
        // 예전엔 카드 콘텐츠를 자유 텍스트로 받아 <!-- CARD_START/END --> 마커를 정규식으로 찾고
        // JSON.parse로 되받았다 — 모델이 코드펜스를 덧씌우거나 잡담을 곁들이거나 필드를 빠뜨리면
        // 그 카드가 통째로 밋밋한 대체 카드(buildFallbackCardSvg)로 떨어졌다(실측 확인, 흔한 실패
        // 경로였다). callProviderForObject(스키마 강제 구조화 출력)로 바꿔 이 파싱 실패 경로 자체를
        // 없앤다 — provider가 cardContentSchema를 만족하는 응답만 반환하도록 AI SDK가 보장한다.
        bodyResults = await mapWithConcurrency(cardIndexes, CARD_CONCURRENCY, async (i) => {
          // 각 카드가 담당할 구간(이전 마커 끝~이 마커 끝)을 미리 잘라 명시한다. draft 전문을
          // 그대로 다 주고 "몇 번째 카드"라고만 알려주면, 카드끼리 서로 뭘 다뤘는지 모른 채
          // 독립적으로 훑다가 같은 대목(예: 가장 눈에 띄는 통계 하나)을 중복으로 고르는 사례가
          // 실측 확인됐다 — 담당 구간을 명시하면 이 문제가 구조적으로 없어진다. draft 전문도
          // 함께 줘서 문맥 이해(품질)는 그대로 유지한다.
          const marker = bodyMarkers[i];
          // 첫 번째 본문 카드(i=0)의 "이전 마커"는 썸네일 마커(imageMarkers[0])다 — bodyMarkers[-1]로
          // undefined를 만들어 draft 맨 앞(0)으로 폴백하면 <!-- PUBLISH:START --> 같은 조립용
          // 내부 마커·NOTES 블록까지 구간에 섞여 들어간다(실측 확인: 카드에 원본 마커 텍스트가
          // 그대로 노출되는 버그로 이어짐). 항상 "바로 앞 마커" 기준으로 잘라야 안전하다.
          const prevMarker = i === 0 ? imageMarkers[0] : bodyMarkers[i - 1];
          const sectionStart = prevMarker.index! + prevMarker[0].length;
          const sectionEnd = marker.index! + marker[0].length;
          const section = draft.slice(sectionStart, sectionEnd).trim();
          const markerDesc = marker[1]?.trim() ?? ""; // "[IMAGE: 설명]"의 설명 — writer가 카드마다 다르게 쓰므로 항상 카드별로 구분되는 텍스트다.

          const user =
            `[주제]\n${topic}\n\n` +
            `[전체 draft — 문맥 이해용]\n${draft}\n\n` +
            `지금 작성할 카드는 두 번째 마커부터 세어 ${i + 1}번째 카드(전체 마커 중 ${i + 2}번째)입니다. ` +
            `**이 카드는 반드시 아래 [담당 구간]에 있는 내용만 다루십시오.** 다른 카드가 이미 다루는 ` +
            `구간과 겹치지 않도록, 이 구간 밖의 내용(다른 소제목 등)은 가져오지 마십시오.\n\n` +
            `[담당 구간]\n${section}\n\n` +
            `그 카드 1개의 콘텐츠만 작성하세요.\n\n` +
            `[작성 규칙]\n` +
            `- 담당 구간 밖의 내용(다른 소제목 등)은 절대 참고하지 마십시오.\n` +
            `- 레이아웃 타입 선택과 필드별 글자수 제한은 함께 제공되는 이미지 가이드를 그대로 따르십시오.`;
          // 동시에 3개가 정확히 같은 타이밍에 발사되면 provider가 그 순간만 유독 부하를 크게
          // 느껴 한꺼번에 이상 응답을 내는 사례가 실측 확인됐다(첫 웨이브 카드 3개가 전부 동일한
          // 대체 카드로 떨어짐) — 정확한 서버 측 원인은 알 수 없지만, 시작 시점을 살짝 흩뿌리는
          // 것만으로 값싸게 완화할 수 있어 넣는다(워커 슬롯당 최대 250ms, 속도엔 영향 거의 없음).
          const stagger = (i % CARD_CONCURRENCY) * 250;
          await new Promise<void>((resolve) => setTimeout(resolve, stagger));

          // <!-- PUBLISH:START/END -->·[IMAGE: ...] 같은 조립용 내부 마커가 구간 텍스트에 섞여
          // 들어와도 화면에 그대로 노출되지 않도록 한 번 더 걸러낸다(안전장치 — 근본 원인은
          // 구간 경계 계산에서 고쳤지만, 다른 경로로 마커가 섞일 가능성까지 방어). 폴백 텍스트는
          // 생성 실패 시에도 image-review REJECT 후 재생성에도 재사용하므로 미리 계산해 둔다.
          const cleanSection = section
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/\[IMAGE:[^\]]*\]/g, " ")
            .replace(/\s+/g, " ").trim();
          const fallbackText = cleanSection.slice(0, 60) || markerDesc || extractDraftTitle(draft) || topic;

          // provider 오류(레이트리밋·네트워크·스키마를 재시도 후에도 못 만족)는 여전히 카드 1개
          // 단위 문제일 뿐이라 전체를 실패시키지 않는다 — 그 카드만 안전한 요약형 폴백 카드로
          // 대체하고 나머지는 정상 진행한다. 폴백도 draft 제목 대신 그 카드의 담당 구간 텍스트를
          // 쓴다 — 여러 카드가 동시에 실패해도 전부 똑같은 문구가 뜨는 대신(실측 확인된 문제)
          // 최소한 서로 달라진다.
          try {
            const { card } = await callProviderForObject(
              sp, sk, sm, system, user, Math.min(maxTok, 4000), cardGenerationSchema
            );
            return { svg: buildCardSvg(card), user, fallbackText };
          } catch (e) {
            console.warn(`[engine] ${channel} · ${stage.id} 카드 ${i + 1} 구조화 생성 실패 — 대체 카드로 진행: ${e instanceof Error ? e.message : e}`);
            return { svg: buildFallbackCardSvg(fallbackText), user, fallbackText };
          }
        });
      }

      const finalSvgs = [thumbnailSvg, ...bodyResults.map(r => r.svg)];
      // finalSvgs는 imageMarkers(PUBLISH 블록 안쪽만, 위 355-359행)를 기준으로 만들어졌는데,
      // spliceImageCardsFromArray는 draft "전체"에서 다시 [IMAGE: ...] 마커를 센다 — PUBLISH
      // 블록 밖(NOTES 등)에 마커 모양 텍스트가 하나라도 더 있으면 "마커 N개 중 M개만 생성됨"으로
      // 개수가 어긋나 이 단계가 실패 처리된다(실측 확인: 2026-07-12 naver-blog 생성 실패 사례).
      // imageMarkers를 스코프한 이유(위 주석)와 똑같은 이유로 스플라이스도 PUBLISH 블록 부분
      // 문자열에만 적용하고 나머지는 그대로 붙여, 두 마커 집계가 항상 같은 기준을 쓰게 맞춘다.
      let draftAfterSplice: string;
      let finalCards: string[];
      if (publishBlock) {
        const splicedPub = spliceImageCardsFromArray(publishBlock[0], finalSvgs);
        draftAfterSplice =
          draft.slice(0, publishBlock.index!) + splicedPub.draft +
          draft.slice(publishBlock.index! + publishBlock[0].length);
        finalCards = splicedPub.cards;
      } else {
        const spliced = spliceImageCardsFromArray(draft, finalSvgs);
        draftAfterSplice = spliced.draft;
        finalCards = spliced.cards;
      }
      draft = draftAfterSplice;
      // finalCards: SVG 문자열 배열(이전엔 HTML 문자열이었음)
      console.log(`[engine] ${channel} · ${stage.id} 완료 — 카드 ${finalCards.length}/${imageMarkers.length}개 생성`);

      // SVG → PNG 래스터화. 결정적으로 조립한 SVG(임의 LLM CSS 없음)라 브라우저 캡처보다
      // 실패 가능성이 낮다 — 여기서 실패하면 폴백으로 감추지 않고 그대로 실패를 전파해
      // (render-worker의 상위 catch가 task를 failed 처리) 배포 문제를 바로 드러낸다.
      const { captureCards, renderSvgToPng } = await import("./cardCapture");
      const captured = captureCards(finalCards).cards;

      // ── 시각 검수(image-review, 채널 오버라이드로만 켜짐) ──────────
      // 지금까지는 카드 JSON이 스키마만 만족하면 무조건 통과였다 — 실제로 렌더링된 이미지를
      // 아무도 보지 않았다. 카피가 밋밋하거나 레이아웃 타입이 내용과 안 맞아도 잡을 방법이
      // 없었다는 뜻이다(로컬 image-maker.md 5단계가 매번 하던 "Read로 열어서 눈으로 확인"에
      // 해당하는 안전망이 여기엔 없었음). 카드 PNG들을 한 번에 묶어 vision 모델에 첨부해
      // 검수하고, REJECT된 카드만 피드백을 덧붙여 최대 1회 재생성한다(로컬의 "재캡처 1회"
      // 원칙과 동일 — 완벽함보다 상한을 두는 게 우선). 본문 카드(썸네일 제외)만 대상이다:
      // 썸네일은 LLM이 카피를 새로 쓰지 않는 결정적 조립이라 검수 대상이 아니다.
      if (meta.pipeline?.["image-review"]?.enabled && bodyResults.length > 0) {
        try {
          const reviewPersona = await loadPersona(channel, "image-reviewer", token);
          if (!reviewPersona) throw new Error("image-reviewer.md 페르소나 파일을 찾을 수 없습니다.");
          const reviewAuth = await resolveModelFor({ stageId: "image-review" });
          const reviewCfg = loadPipelineConfig().stages.find(s => s.id === "image-review");
          const bodyCaptured = captured.slice(1); // index 0 = 썸네일
          const reviewText =
            `아래 카드 이미지 ${bodyCaptured.length}장을 첨부 순서(0부터) 그대로 검수하세요. ` +
            `각 이미지마다 반드시 하나의 결과를 반환하세요.`;
          const { results } = await callProviderForObjectWithImages(
            reviewAuth.p, reviewAuth.apiKey, reviewAuth.model,
            reviewPersona, reviewText, bodyCaptured.map(c => c.png),
            reviewCfg?.maxTokens ?? 4096, imageReviewSchema
          );
          const rejected = results.filter(r => r.verdict === "reject" && r.index >= 0 && r.index < bodyResults.length);
          if (rejected.length > 0) {
            console.log(`[engine] ${channel} · image-review — ${rejected.length}/${bodyCaptured.length}장 반려, 재생성 시도`);
            await mapWithConcurrency(rejected, 3, async ({ index, issue }) => {
              const original = bodyResults[index];
              const revisedUser = `${original.user}\n\n[검수 피드백 — 반드시 반영해 다시 작성]\n${issue ?? "카피 품질을 개선하세요."}`;
              let newSvg: string;
              try {
                const { card } = await callProviderForObject(
                  sp, sk, sm, system, revisedUser, Math.min(maxTok, 4000), cardGenerationSchema
                );
                newSvg = buildCardSvg(card);
              } catch (e) {
                console.warn(`[engine] ${channel} · image-review 재생성 실패(카드 ${index + 1}) — 폴백 유지: ${e instanceof Error ? e.message : e}`);
                newSvg = buildFallbackCardSvg(original.fallbackText);
              }
              // 재검수는 하지 않는다(1회 재생성이 최종) — captured만 갱신, finalCards는 이 시점
              // 이후 다시 참조되지 않아 갱신 불필요.
              const rendered = renderSvgToPng(newSvg);
              captured[index + 1] = { svg: newSvg, png: rendered.png, heightPx: rendered.heightPx };
            });
          } else {
            console.log(`[engine] ${channel} · image-review — 전부 승인`);
          }
        } catch (e) {
          console.warn(`[engine] ${channel} · image-review 실패(원본 카드 그대로 진행): ${e instanceof Error ? e.message : e}`);
        }
      }

      // Supabase 업로드(SVG/PNG 다운로드 기능용) — 순수 부가 기능이라 실패해도 본문 임베딩엔
      // 영향 없다(best-effort). 실패하면 사용자는 그냥 SVG 다운로드 옵션만 못 받는다.
      if (onCardAssets) {
        try {
          const { uploadCards } = await import("./cardStorage");
          const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const assets = await uploadCards(channel, jobId, captured);
          onCardAssets(assets);
        } catch (e) {
          console.warn(`[engine] ${channel} · ${stage.id} 카드 업로드 실패(다운로드용 링크만 없음, 본문엔 영향 없음): ${e instanceof Error ? e.message : e}`);
        }
      }

      // 본문에는 래스터화된 PNG를 <figure>로 감싸 삽입한다(네이버 에디터엔 SVG를 직접 붙여넣기
      // 어려움). <figure> 래핑은 resultDownload.ts의 extractCards()가 다른 채널과 동일한 방식으로
      // naver-blog 카드 경계도 찾을 수 있게 하기 위함 — 예전엔 맨 <div>만 들어가 있어
      // naver-blog 카드가 항상 0개로 잡히던 문제가 있었다.
      replacedCards.push(...captured.map((c) =>
        `<figure style="margin:24px 0;text-align:center;">` +
        `<img src="data:image/png;base64,${c.png.toString("base64")}" style="max-width:100%;height:auto;" alt=""/>` +
        `</figure>`
      ));
    }
  }

  if (!draft.trim()) {
    throw new Error(`[engine] ${channel}: writer 단계가 실행되지 않아 결과물이 없습니다.`);
  }

  // ── 최종 조립 (outputFormat별) ──
  const fmt = meta.outputFormat ?? "text";
  if (fmt === "html") {
    // 검수 재시도를 다 쓰고도 안 고쳐진 문제가 있으면(위 unresolvedReviewIssues), 눈에 보이는
    // 본문 어디에도 표시가 안 남으면 아무도 모른 채 그대로 발행된다(실측 확인된 문제) — HTML
    // 주석은 렌더링에 영향 없이 결과물(DB의 tasks.result)에 그대로 남으므로, 최소한 "이 글은
    // 검수를 다 통과하지 못했다"는 흔적은 남긴다. text/json 포맷 채널에는 안 붙인다 — 그쪽은
    // writer 출력이 그대로 최종 콘텐츠라(예: json이면 파싱 가능한 값이어야 함) 주석을 못 붙인다.
    const qualityNote = unresolvedReviewIssues.length > 0
      ? `<!-- QUALITY_REVIEW_UNRESOLVED: ${unresolvedReviewIssues.length}건 — ${unresolvedReviewIssues.join(" | ").replace(/-->/g, "→")} -->\n`
      : "";
    const shell = await readChannelFile(channel, "templates/blog-shell.html", token).catch(() => undefined);
    const assembled = assembleNaverBlogHtml(draft, shell);
    if (assembled === null) {
      console.warn(`[engine] ${channel}: HTML 조립 불가(마커 누락/품질 게이트 FAIL) — draft 원문 반환`);
      return qualityNote + draft;
    }
    let finalHtml = assembled;
    replacedCards.forEach((cardHtml, idx) => {
      finalHtml = finalHtml.replace(new RegExp(`<!--\\s*HTML_CARD_${idx}\\s*-->`, "g"), cardHtml);
    });
    return qualityNote + finalHtml;
  }
  // json / text: writer가 이미 형식대로 출력 → 그대로 반환
  return draft;
}
