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
import { callProvider } from "../apiClients";
import { resolveStages } from "./loadConfig";
import { getRecentFeedback, getRecentExamples, getRecentBadExamples, getRecentResearch, addBadExample, addResearch, contextBudget } from "../pipelineMemory";
import { assembleNaverBlogHtml } from "../htmlAssembler";
import { spliceImageCardsFromArray, extractCards } from "./imageCards";
import { buildThumbnailCard, extractDraftTitle, extractThumbnailSubtitle } from "./thumbnailBuilder";
import type { CardAsset } from "./cardStorage";
// 페르소나·가이드 로딩/코드펜스 제거는 promptAssembly로 추출(M0 리팩터, 동작 무변화).
import { stripCodeFence, loadPersona, loadAllGuides, selectGuides, guidesText } from "./promptAssembly";
// provider 인증 해석 + 검색-불가 provider 자동 폴백은 auth.ts로 추출(M5 리팩터, 동작 무변화).
import { createAuthResolver } from "./auth";
// captureCards/uploadCards는 Playwright(네이티브 브라우저 바이너리 필요)를 정적 최상단에서
// import하면, 실제로 호출하지 않는 Vercel(Next.js API route) 쪽에서도 모듈 로드 시점에
// 번들링/로딩이 실패한다 — 이 파일이 render-worker와 Next.js API route 양쪽에서 import되기
// 때문에, 아래 image 단계 안에서만 동적 import(await import)로 지연 로드한다.
import type { ResolvedStage } from "./types";

// ─── 단계 종류 추론 (config의 id로부터 엔진 동작 결정) ──────────
type StageKind = "producer" | "writer" | "reviewer" | "image";
function stageKind(id: string): StageKind {
  if (id === "writer") return "writer";
  if (id.includes("image")) return "image";
  if (id.includes("review")) return "reviewer";
  return "producer"; // research / brainstorm / research-deep / skeleton 등
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
  const feedback = await getRecentFeedback(channel, bud.feedback).catch(() => []);
  const exampleTexts = await getRecentExamples(channel, bud.examples).catch(() => []);
  if (feedback.length) {
    contextParts.push(`[누적 피드백 — 아래 지적을 반드시 반영]\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`);
    console.log(`[engine] ${channel}: 누적 피드백 ${feedback.length}개 주입`);
  }
  const exampleBlock = exampleTexts.length
    ? `[우수 참고작 — 이 톤·구조·품질을 따르되 내용은 주제에 맞게 새로 작성]\n${exampleTexts.map((e, i) => `─ 참고작 ${i + 1} ─\n${e}`).join("\n\n")}`
    : "";
  if (exampleTexts.length) console.log(`[engine] ${channel}: 우수 참고작 ${exampleTexts.length}개 주입`);

  const badExamples = await getRecentBadExamples(channel, bud.bad).catch(() => []);
  const badBlock = badExamples.length
    ? `[과거 기각 사례 — 검수에서 지적된 문제. 아래 같은 표현·패턴을 반드시 피할 것]\n${badExamples.map((b, i) => `${i + 1}. (${b.reason ?? ""}) ${b.content.slice(0, bud.cap)}`).join("\n")}`
    : "";
  if (badExamples.length) console.log(`[engine] ${channel}: 기각 사례 ${badExamples.length}개 주입(회피용)`);

  let draft = "";
  let writerSystemBase = ""; // 검수 반려 시 재작성에 재사용
  let writerCall: { p: Provider; apiKey: string; model: string } =
    { p: provider, apiKey: baseAuth.apiKey, model: baseAuth.model }; // 재작성은 writer 모델로
  let replacedCards: string[] = []; // image 단계에서 만든 카드 HTML (플레이스홀더 → 최종 치환용)

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

    } else if (kind === "reviewer") {
      if (!draft.trim()) { console.warn(`[engine] ${channel}/${stage.id}: 검수할 초안 없음 → 건너뜀`); continue; }
      // maxRetries 미지정(기본 1)이면 기존과 완전히 동일한 동작: 반려 시 재작성 1회 후 재검수 없이 진행.
      // maxRetries > 1인 채널(예: naver-blog)만 "재작성 → 같은 검수기로 재검수"를 반복한다.
      const maxRewrites = Math.max(1, stage.maxRetries ?? 1);
      // naver-blog는 재시도가 최대 3회×2단계라 매번 전체 재작성이면 25분 넘게 걸릴 수 있다(실측).
      // 부분 패치로 전환해 응답 길이를 줄인다 — 다른 채널은 재시도가 1회뿐이라(위 주석 참고)
      // 기존 전체 재작성 방식을 그대로 둔다(동작 영향 없음).
      const usePatchRewrite = channel === "naver-blog";
      for (let rewriteCount = 0; ; rewriteCount++) {
        // 검수기도 자기에게 할당된 조각(예: tone-review ← 금지어 사전)을 받는다.
        const review = stripCodeFence(await call(sp, sk, sm, persona + stageGuides, `[검수 대상]\n${draft}`, maxTok, false, false, undefined, stage.thinking?.budgetTokens));
        if (!isRejected(review)) {
          console.log(rewriteCount > 0
            ? `[engine] ${channel} · ${stage.id} 재작성 ${rewriteCount}회 후 통과`
            : `[engine] ${channel} · ${stage.id} 통과`);
          break;
        }
        if (statusCallback) await statusCallback(`${stage.id} 반영 재작성`);
        console.log(`[engine] ${channel} · ${stage.id} 반려(${rewriteCount + 1}/${maxRewrites}차) → 재작성 | 사유: ${review.replace(/\s+/g, " ").slice(0, 300)}`);
        // 기각 사례 자동 저장(회피 학습용) — 초안 통째가 아니라 "검수 피드백(사유+문제 문장)"만 저장. fire-and-forget
        void addBadExample(channel, review.replace(/\s+/g, " ").slice(0, 700), stage.id);
        const rewriteSystem = writerSystemBase || ((await loadPersona(channel, "writer", token)) ?? "");

        if (usePatchRewrite) {
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
          const patchRaw = stripCodeFence(
            await call(writerCall.p, writerCall.apiKey, writerCall.model, rewriteSystem, patchUser, 4096, false, true)
          );
          const patches = parsePatches(patchRaw);
          if (patches && patches.length > 0) {
            const { draft: patched, appliedCount } = applyPatches(draft, patches);
            if (appliedCount > 0) {
              draft = patched;
              console.log(`[engine] ${channel} · ${stage.id} 부분 패치 ${appliedCount}/${patches.length}건 적용`);
            } else {
              console.warn(`[engine] ${channel} · ${stage.id} 패치 ${patches.length}건 모두 원고에서 못 찾음 — 원고 변경 없이 진행`);
            }
          } else {
            console.warn(`[engine] ${channel} · ${stage.id} 패치 응답 파싱 실패 — 원고 변경 없이 진행`);
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

        if (rewriteCount + 1 >= maxRewrites) {
          if (maxRewrites > 1) console.warn(`[engine] ${channel} · ${stage.id} 최대 재작성(${maxRewrites}회) 소진 — 마지막 원고로 진행`);
          break;
        }
      }

    } else if (kind === "image") {
      const imageMarkers = [...draft.matchAll(/\[IMAGE:\s*([^\]]+)\]/g)];
      if (imageMarkers.length === 0) {
        console.log(`[engine] ${channel} · ${stage.id}: [IMAGE:...] 마커 없음 → 건너뜀`);
        continue;
      }

      // 대표 썸네일(마커 인덱스 0)은 더 이상 LLM이 손으로 그리지 않는다 — 매번 색상·레이아웃·
      // 마커 문법이 조금씩 달라지며 같은 계열 버그(디자인 어설픔·정체불명 토큰 유출·최상단
      // 배치 실패)가 반복 재발했기 때문. templates/thumbnail-template.html에 고정된 마크업을
      // 그대로 불러와 제목·부제·마스코트 세 값만 결정적으로 치환한다(thumbnailBuilder.ts).
      let thumbnailCard: string;
      try {
        const [template, mascotB64] = await Promise.all([
          readChannelFile(channel, "templates/thumbnail-template.html", token),
          readChannelFileBase64(channel, "assets/mascot.png", token),
        ]);
        thumbnailCard = buildThumbnailCard(
          template,
          extractDraftTitle(draft),
          extractThumbnailSubtitle(draft),
          `data:image/png;base64,${mascotB64}`
        );
      } catch (e) {
        console.warn(`[engine] ${channel} · ${stage.id} 썸네일 템플릿/마스코트 로드 실패: ${e instanceof Error ? e.message : e}`);
        thumbnailCard = "";
      }

      const bodyMarkerCount = imageMarkers.length - 1;
      const system = persona + stageGuides;
      let bodyCards: string[] = [];

      if (bodyMarkerCount > 0) {
        const user =
          `[주제]\n${topic}\n\n` +
          `아래 draft 전문에는 [IMAGE: ...] 마커가 총 ${imageMarkers.length}개 있습니다. ` +
          `**첫 번째 마커(대표 썸네일)는 별도 로직이 이미 처리했으므로 작성하지 마십시오.** ` +
          `두 번째 마커부터 마지막 마커까지, 순서대로 총 ${bodyMarkerCount}개 카드의 HTML+CSS 코드만 작성하세요.\n\n` +
          `[작성 규칙]\n` +
          `- 본문의 나머지 텍스트는 절대로 출력하지 마십시오.\n` +
          `- 오직 각 마커에 들어갈 HTML 카드 코드블록만 순서대로 작성하십시오 (총 ${bodyMarkerCount}개, 첫 번째 마커분 제외).\n` +
          `- 각 카드 코드블록은 반드시 \`<!-- CARD_START -->\` 와 \`<!-- CARD_END -->\` 마커로 감싸주십시오.\n` +
          `- 800px 너비에 옅은 회색 계열 그라디언트 배경(guide 2-1절 템플릿 고정값)을 가진 본문 이미지 브랜드 카드 프레임을 사용하십시오 (순백 #ffffff 금지 — 네이버 블로그 본문 배경도 흰색이라 카드 경계가 사라집니다). 이 카드들에는 \`{{MASCOT}}\`를 쓰지 마십시오(마스코트는 대표 썸네일 전용).\n\n` +
          `[입력 draft 전문]\n${draft}`;
        const cardsRaw = stripCodeFence(await call(sp, sk, sm, system, user, maxTok, false, true));
        bodyCards = extractCards(cardsRaw);
      }

      const spliced = spliceImageCardsFromArray(draft, [thumbnailCard, ...bodyCards]);
      draft = spliced.draft;
      let finalCards = spliced.cards;
      console.log(`[engine] ${channel} · ${stage.id} 완료 — 카드 ${finalCards.length}/${imageMarkers.length}개 생성`);

      // 서버사이드 캡처(품질 확인·높이 게이트 + 실제 PNG 업로드). Chromium 미설치나 업로드 실패
      // 등 어떤 이유로든 실패해도 기존 inline HTML 카드 흐름은 그대로 유지된다(폴백) —
      // 이 블록은 draft를 건드리지 않는다.
      try {
        const { captureCards } = await import("./cardCapture");
        let { cards: captured, warnings } = await captureCards(finalCards);

        // 높이 편차 게이트: 예전엔 경고만 남기고 그대로 발행했다 — 실제로 한 번 다시
        // 만들어보게 해서 편차를 줄인다(최대 1회, 비용 통제 목적). 개선이 없으면 원본 유지.
        if (warnings.length > 0) {
          console.warn(`[engine] ${channel} · ${stage.id} 카드 높이 게이트 경고 → 재조정 1회 시도:\n  ${warnings.join("\n  ")}`);
          try {
            // 대표 썸네일(finalCards[0])은 결정적 템플릿이라 높이 변동이 없으므로 재조정
            // 대상에서 제외한다 — 본문 카드(인덱스 1+)만 다시 쓰게 한다.
            const bodyOnly = finalCards.slice(1);
            const heightReport = captured.slice(1)
              .map((c, i) => `본문 카드 ${i + 1}: ${c.heightPx}px`).join(", ");
            const retryUser =
              `[주제]\n${topic}\n\n` +
              `방금 만든 본문 카드들을 실제로 캡처한 높이입니다 — ${heightReport}\n` +
              `이 중 편차(최댓값-최솟값)가 기준(200px)을 넘었습니다. 아래 원본 카드들을 참고해 ` +
              `콘텐츠 분량(문장 길이·리스트 항목 수)만 조정해서 카드끼리 높이가 비슷해지도록 다시 ` +
              `작성하세요. 카드 개수(${bodyOnly.length}개)·순서·CARD_START/END 형식은 그대로 유지하세요.\n\n` +
              `[원본 카드 전체]\n${bodyOnly.map(c => `<!-- CARD_START -->\n${c}\n<!-- CARD_END -->`).join("\n\n")}`;
            const retryRaw = stripCodeFence(await call(sp, sk, sm, system, retryUser, maxTok, false, true));
            const retryBodyCards = extractCards(retryRaw);
            if (retryBodyCards.length === bodyOnly.length) {
              const retryCards = [finalCards[0], ...retryBodyCards];
              const { cards: recaptured, warnings: warnings2 } = await captureCards(retryCards);
              if (warnings2.length < warnings.length) {
                console.log(`[engine] ${channel} · ${stage.id} 재조정 성공 — 높이 게이트 통과`);
                finalCards = retryCards;
                captured = recaptured;
                warnings = warnings2;
              } else {
                console.warn(`[engine] ${channel} · ${stage.id} 재조정해도 개선 없음 — 원본 카드 유지`);
              }
            } else {
              console.warn(`[engine] ${channel} · ${stage.id} 재조정 응답 카드 개수 불일치(${retryBodyCards.length}/${bodyOnly.length}) — 원본 카드 유지`);
            }
          } catch (e) {
            console.warn(`[engine] ${channel} · ${stage.id} 높이 재조정 시도 실패 — 원본 카드 유지: ${e instanceof Error ? e.message : e}`);
          }
        } else {
          console.log(`[engine] ${channel} · ${stage.id} 카드 높이 게이트 통과`);
        }

        if (onCardAssets) {
          const { uploadCards } = await import("./cardStorage");
          const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const assets = await uploadCards(channel, jobId, captured);
          onCardAssets(assets);
        }
      } catch (e) {
        console.warn(`[engine] ${channel} · ${stage.id} 서버사이드 캡처/업로드 실패(폴백: inline HTML 유지) — ${e instanceof Error ? e.message : e}`);
      }

      replacedCards.push(...finalCards);
    }
  }

  if (!draft.trim()) {
    throw new Error(`[engine] ${channel}: writer 단계가 실행되지 않아 결과물이 없습니다.`);
  }

  // ── 최종 조립 (outputFormat별) ──
  const fmt = meta.outputFormat ?? "text";
  if (fmt === "html") {
    const shell = await readChannelFile(channel, "templates/blog-shell.html", token).catch(() => undefined);
    const assembled = assembleNaverBlogHtml(draft, shell);
    if (assembled === null) {
      console.warn(`[engine] ${channel}: HTML 조립 불가(마커 누락/품질 게이트 FAIL) — draft 원문 반환`);
      return draft;
    }
    let finalHtml = assembled;
    replacedCards.forEach((cardHtml, idx) => {
      finalHtml = finalHtml.replace(new RegExp(`<!--\\s*HTML_CARD_${idx}\\s*-->`, "g"), cardHtml);
    });
    return finalHtml;
  }
  // json / text: writer가 이미 형식대로 출력 → 그대로 반환
  return draft;
}
