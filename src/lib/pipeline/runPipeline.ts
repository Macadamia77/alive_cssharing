// 통합 파이프라인 엔진.
// 흐름(단계 순서·scope·토글·조각할당)은 config(pipeline.json + _meta.pipeline)로,
// 프롬프트·역할은 data 파일(frontmatter 태그 매칭)로 결정한다. — 하드코딩 금지 원칙.
//
// 기존 generateContent(단일 호출)·runAgentPipeline(네이버 전용)을 대체하는 3번째 경로.
// _meta.json에 "engine": "pipeline"이 있는 채널만 이 엔진을 탄다(점진적 도입).

import fs from "fs/promises";
import { join } from "path";
import { dataRoot } from "../dataRoot";
import { type ChannelKey } from "../channels";
import {
  getChannelMeta,
  readChannelFile,
  readChannelFileBase64,
  collectGuideFiles,
  isTextFile,
  type ChannelMeta,
} from "../channelFiles";
import { loadAIConfig, type Provider, type ProviderKey } from "../aiConfig";
import { DEFAULT_MODELS } from "../resolveProvider";
import {
  callClaude, callOpenAI, callGemini, callGeminiWithSearch, callClaudeWithNativeSearch,
} from "../apiClients";
import { parseFrontmatter } from "./frontmatter";
import { resolveStages } from "./loadConfig";
import { getRecentFeedback, getRecentExamples, getRecentBadExamples, addBadExample, addResearch } from "../pipelineMemory";
import { assembleNaverBlogHtml } from "../htmlAssembler";
import { spliceImageCards, extractCards } from "./imageCards";
import type { CardAsset } from "./cardStorage";
// captureCards/uploadCards는 Playwright(네이티브 브라우저 바이너리 필요)를 정적 최상단에서
// import하면, 실제로 호출하지 않는 Vercel(Next.js API route) 쪽에서도 모듈 로드 시점에
// 번들링/로딩이 실패한다 — 이 파일이 render-worker와 Next.js API route 양쪽에서 import되기
// 때문에, 아래 image 단계 안에서만 동적 import(await import)로 지연 로드한다.
import type { ResolvedStage } from "./types";

// ─── 코드펜스 제거 (LLM이 감싸는 ```html 등) ────────────────────
function stripCodeFence(text: string): string {
  let s = text.trim();
  const m = s.match(/^(?:```|~~~)[\w-]*\n?([\s\S]*?)\n?(?:```|~~~)\s*$/);
  if (m) return m[1].trim();
  s = s.replace(/^(?:```|~~~)[\w-]*[ \t]*\r?\n/, "");
  s = s.replace(/\r?\n(?:```|~~~)[ \t]*$/, "");
  return s.trim();
}

// ─── 단계 종류 추론 (config의 id로부터 엔진 동작 결정) ──────────
type StageKind = "producer" | "writer" | "reviewer" | "image";
function stageKind(id: string): StageKind {
  if (id === "writer") return "writer";
  if (id.includes("image")) return "image";
  if (id.includes("review")) return "reviewer";
  return "producer"; // research / brainstorm / research-deep / skeleton 등
}

// ─── 페르소나 파일 로딩 (채널 우선 → 공통 폴백) ────────────────
// 1) data/channels/<채널>/agents/<persona>.md  (Supabase→GitHub→로컬)
// 2) data/agents/<persona>.md                  (공통 — 로컬 번들/dataRoot)
async function loadPersona(
  channel: ChannelKey,
  persona: string,
  token?: string
): Promise<string | null> {
  try {
    const txt = await readChannelFile(channel, `agents/${persona}.md`, token);
    if (txt && txt.trim()) return parseFrontmatter(txt).body.trim();
  } catch { /* 채널 전용 없음 → 공통으로 */ }
  try {
    const txt = await fs.readFile(join(dataRoot(), "data", "agents", `${persona}.md`), "utf-8");
    if (txt && txt.trim()) return parseFrontmatter(txt).body.trim();
  } catch { /* 공통도 없음 */ }
  return null;
}

// ─── 채널 조각(가이드) 파일 전체 로딩 (frontmatter stages 태그 포함) ──
interface GuideFile { path: string; body: string; stages: string[]; }

async function loadAllGuides(channel: ChannelKey, token?: string): Promise<GuideFile[]> {
  let keys: string[];
  try {
    keys = await collectGuideFiles(channel, token);
  } catch {
    return [];
  }
  const guideKeys = keys.filter(
    k => isTextFile(k.split("/").pop() ?? "")
      && !k.startsWith("agents/")
      && !k.startsWith("templates/")
  );
  const out: GuideFile[] = [];
  for (const k of guideKeys) {
    try {
      const raw = await readChannelFile(channel, k, token);
      if (!raw.trim()) continue;
      const parsed = parseFrontmatter(raw);
      out.push({
        path: k,
        body: (parsed.body.trim() || raw.trim()),
        stages: parsed.meta.stages ?? [],
      });
    } catch { /* skip */ }
  }
  // 회사 서비스 관련 검증된 사실 정보(지어낸 서비스·수치 방지)는 인스타그램/페이스북 채널에만 포함한다.
  // legacy 엔진(channelFiles.ts::buildSystemPrompt)과 동일한 특례 — 파일 위치가 채널 폴더 밖(data/company-facts.md)이라 collectGuideFiles로는 못 잡는다.
  if (channel === "instagram") {
    try {
      const facts = await fs.readFile(join(dataRoot(), "data", "company-facts.md"), "utf-8");
      if (facts.trim()) out.push({ path: "company-facts.md", body: facts.trim(), stages: ["writer", "content-review"] });
    } catch { /* 없으면 스킵 */ }
  }
  return out;
}

// 한 단계에 주입할 조각 텍스트를 조립한다.
// 우선순위: ① _meta.pipeline[단계].guides(명시 할당) → ② frontmatter stages 태그
//          → ③ (writer 한정) 태그 없는 파일 전부 (기존 호환)
function selectGuides(all: GuideFile[], stage: ResolvedStage): GuideFile[] {
  if (stage.guides !== undefined) {
    // 명시 할당(빈 배열이면 "아무것도 안 붙임"을 의미)
    return all.filter(g => stage.guides!.includes(g.path));
  }
  return all.filter(g =>
    g.stages.includes(stage.id) || (stage.id === "writer" && g.stages.length === 0)
  );
}

function guidesText(selected: GuideFile[]): string {
  if (selected.length === 0) return "";
  return selected
    .map(g => `\n\n${"=".repeat(60)}\n# ${g.path}\n${"=".repeat(60)}\n\n${g.body}`)
    .join("");
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
  onCardAssets?: (assets: CardAsset[]) => void
): Promise<string> {
  const meta: ChannelMeta = await getChannelMeta(channel, token);
  const draftProvided = !!(userDraft && userDraft.trim());
  const stages = resolveStages(channel, meta, { draftProvided });

  console.log(`[engine] ${channel}: 활성 단계 ${stages.length}개 → ${stages.map(s => s.id).join(", ")}`);

  if (stages.length === 0) {
    throw new Error(`[engine] ${channel}: 활성화된 파이프라인 단계가 없습니다. pipeline.json / _meta.pipeline을 확인하세요.`);
  }

  if (provider === "mock") {
    return `[engine mock] ${channel} · ${topic} · 단계: ${stages.map(s => s.id).join(">")}`;
  }

  // ── Provider 인증 (단계별 모델 티어링: provider별 키/모델을 캐시) ──
  const authCache = new Map<string, { apiKey: string; model: string } | null>();
  const resolveAuth = async (p: Provider): Promise<{ apiKey: string; model: string } | null> => {
    if (authCache.has(p)) return authCache.get(p)!;
    const eKey = process.env[`${p.toUpperCase()}_API_KEY`]?.trim();
    const eModel = process.env[`${p.toUpperCase()}_MODEL`]?.trim();
    let pc = eKey ? { apiKey: eKey, model: eModel || DEFAULT_MODELS[p as ProviderKey] } : null;
    if (!pc) pc = await loadAIConfig(token).then(c => c.providers[p as ProviderKey]).catch(() => null);
    // apiKeyOverride는 사용자가 선택한 기본 provider에만 적용
    if (p === provider && apiKeyOverride) pc = { apiKey: apiKeyOverride, model: pc?.model || eModel || DEFAULT_MODELS[p as ProviderKey] };
    const result = pc?.apiKey ? { apiKey: pc.apiKey, model: pc.model || DEFAULT_MODELS[p as ProviderKey] } : null;
    authCache.set(p, result);
    return result;
  };

  const baseAuth = await resolveAuth(provider);
  if (!baseAuth) {
    throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
  }

  // 단계의 provider/model 해석. 명시 지정한 provider 키가 워커에 없으면 명확한 에러(조용한 폴백 금지).
  const resolveStageModel = async (s: ResolvedStage): Promise<{ p: Provider; apiKey: string; model: string }> => {
    const requested = (s.model as Provider) || provider;
    const a = await resolveAuth(requested);
    if (a) return { p: requested, apiKey: a.apiKey, model: s.modelId || a.model };
    // requested는 base가 아닌 오버라이드 provider(base는 위에서 이미 보장됨)인데 키가 없음.
    // 예전엔 base로 폴백하며 modelId(예: claude-opus-4-8)를 유지 → Gemini에 claude 모델 요청 크래시.
    throw new Error(
      `이 단계는 '${requested}' 모델로 설정됐지만 워커에 ${requested.toUpperCase()}_API_KEY가 없습니다. ` +
      `Railway(및 Vercel) 환경변수에 ${requested.toUpperCase()}_API_KEY를 추가하거나, ` +
      `파이프라인 카드에서 이 단계/채널 모델을 '기본'으로 되돌리세요.`
    );
  };

  // ── LLM 호출 헬퍼 (provider·model을 인자로 받음) ──
  const call = async (
    p: Provider, apiKey: string, model: string,
    system: string, user: string, maxTokens: number,
    useSearch: boolean, disableThinking: boolean,
    onSource?: (n: number) => void
  ): Promise<string> => {
    if (p === "gemini") {
      return useSearch
        ? callGeminiWithSearch(apiKey, model, system, user, disableThinking)
        : callGemini(apiKey, model, system, user, maxTokens, disableThinking);
    }
    if (p === "claude") {
      return useSearch
        ? callClaudeWithNativeSearch(apiKey, model, system, user, maxTokens, onSource)
        : callClaude(apiKey, model, system, user, maxTokens);
    }
    if (p === "openai") return callOpenAI(apiKey, model, system, user);
    return "";
  };

  const allGuides = await loadAllGuides(channel, token);

  // 누적 컨텍스트(producer 산출물) + 현재 초안
  const contextParts: string[] = [];
  if (draftProvided) contextParts.push(`[작성자 초안]\n${userDraft}`);

  // 동적 컨텍스트(Phase 4): 누적 피드백(전 단계) + 우수작 퓨샷(writer 전용)
  const feedback = await getRecentFeedback(channel).catch(() => []);
  const exampleTexts = await getRecentExamples(channel).catch(() => []);
  if (feedback.length) {
    contextParts.push(`[누적 피드백 — 아래 지적을 반드시 반영]\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`);
    console.log(`[engine] ${channel}: 누적 피드백 ${feedback.length}개 주입`);
  }
  const exampleBlock = exampleTexts.length
    ? `[우수 참고작 — 이 톤·구조·품질을 따르되 내용은 주제에 맞게 새로 작성]\n${exampleTexts.map((e, i) => `─ 참고작 ${i + 1} ─\n${e}`).join("\n\n")}`
    : "";
  if (exampleTexts.length) console.log(`[engine] ${channel}: 우수 참고작 ${exampleTexts.length}개 주입`);

  const badExamples = await getRecentBadExamples(channel).catch(() => []);
  const badBlock = badExamples.length
    ? `[과거 기각 사례 — 검수에서 지적된 문제. 아래 같은 표현·패턴을 반드시 피할 것]\n${badExamples.map((b, i) => `${i + 1}. (${b.reason ?? ""}) ${b.content.slice(0, 500)}`).join("\n")}`
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
        (n) => { if (statusCallback) void statusCallback(`소스 ${n}개 검색 중`); }));
      if (out.trim()) {
        contextParts.push(`[${stage.id} 산출물]\n${out}`);
        // 웹서치 단계 산출물은 자료실용으로 아카이브(자동 저장) — fire-and-forget
        if (stage.useSearch) void addResearch(channel, stage.id, topic, out);
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
      for (let rewriteCount = 0; ; rewriteCount++) {
        // 검수기도 자기에게 할당된 조각(예: tone-review ← 금지어 사전)을 받는다.
        const review = stripCodeFence(await call(sp, sk, sm, persona + stageGuides, `[검수 대상]\n${draft}`, maxTok, false, false));
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
        const rewriteUser =
          `[주제]\n${topic}\n\n` +
          (contextParts.length ? `[참고 자료]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
          `[이전 원고]\n${draft}\n\n` +
          `[검수 피드백 — 아래 문제를 모두 해결해 전체를 다시 작성]\n${review}`;
        // 재작성은 writer 모델로 (검수기 모델이 아니라)
        const revised = stripCodeFence(await call(writerCall.p, writerCall.apiKey, writerCall.model, rewriteSystem, rewriteUser, meta.maxTokens ?? 24000, false, meta.disableThinking ?? false));
        if (revised.trim()) draft = revised;
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
      const system = persona + stageGuides;
      const user =
        `[주제]\n${topic}\n\n` +
        `아래 draft 전문에서 [IMAGE: ...] 마커(${imageMarkers.length}개)들의 설명에 부합하는 브랜드 카드 HTML+CSS 코드를 작성하세요.\n\n` +
        `[작성 규칙]\n` +
        `- 본문의 나머지 텍스트는 절대로 출력하지 마십시오.\n` +
        `- 오직 각 마커에 들어갈 HTML 카드 코드블록들만 순서대로 작성하십시오.\n` +
        `- 각 카드 코드블록은 반드시 \`<!-- CARD_START -->\` 와 \`<!-- CARD_END -->\` 마커로 감싸주십시오.\n` +
        `- **첫 번째 마커 (인덱스 0)**는 블로그 대표 썸네일이므로, 720x720px 크기에 파란색/하늘색 배경(#18A0E8)을 가진 대표 이미지 프레임을 사용하십시오. ` +
        `프레임 좌하단에 실제 브랜드 마스코트를 반드시 배치하십시오: ` +
        `\`<img src="{{MASCOT}}" style="position:absolute; left:32px; bottom:28px; width:150px; height:auto;">\` ` +
        `— src 값은 반드시 문자열 \`{{MASCOT}}\`를 그대로(따옴표 안에 다른 경로·설명으로 바꾸지 말고) 남겨두십시오. 이 토큰은 나중에 코드가 실제 이미지로 치환합니다. 카드 최상위 요소에는 \`position:relative;\`를 지정해 이 절대좌표 배치가 카드 안에서만 적용되게 하십시오.\n` +
        `- **두 번째 마커 이후 (인덱스 1 이상)**는 본문 요약 및 자료 카드들이므로, 800px 너비에 옅은 회색 계열 그라디언트 배경(guide 2-1절 템플릿 고정값)을 가진 본문 이미지 브랜드 카드 프레임을 사용하십시오 (순백 #ffffff 금지 — 네이버 블로그 본문 배경도 흰색이라 카드 경계가 사라집니다). 이 카드들에는 \`{{MASCOT}}\`를 쓰지 마십시오(마스코트는 대표 썸네일 전용).\n\n` +
        `[입력 draft 전문]\n${draft}`;
      const cardsRaw = stripCodeFence(await call(sp, sk, sm, system, user, maxTok, false, true));

      const spliced = spliceImageCards(draft, cardsRaw);
      draft = spliced.draft;
      let finalCards = spliced.cards;
      console.log(`[engine] ${channel} · ${stage.id} 완료 — 카드 ${finalCards.length}/${imageMarkers.length}개 생성`);

      // 대표 썸네일(카드 인덱스 0)의 {{MASCOT}} 토큰을 실제 브랜드 마스코트 이미지(base64 데이터
      // URI)로 치환한다. 모델에게 거대한 base64 문자열을 그대로 베껴쓰게 하는 대신 짧은 토큰만
      // 쓰게 하고 여기서 실제 값으로 바꿔 넣는 방식 — 재현성이 높고 토큰 낭비가 없다.
      if (finalCards[0]?.includes("{{MASCOT}}")) {
        try {
          const mascotB64 = await readChannelFileBase64(channel, "assets/mascot.png", token);
          finalCards[0] = finalCards[0].replace(/\{\{MASCOT\}\}/g, `data:image/png;base64,${mascotB64}`);
        } catch (e) {
          console.warn(`[engine] ${channel} · ${stage.id} 마스코트 자산 로드 실패, 플레이스홀더 제거: ${e instanceof Error ? e.message : e}`);
          finalCards[0] = finalCards[0].replace(/<img[^>]*\{\{MASCOT\}\}[^>]*>/g, "").replace(/\{\{MASCOT\}\}/g, "");
        }
      }

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
            const heightReport = captured.slice(1)
              .map((c, i) => `본문 카드 ${i + 1}: ${c.heightPx}px`).join(", ");
            const retryUser =
              `[주제]\n${topic}\n\n` +
              `방금 만든 본문 카드들을 실제로 캡처한 높이입니다 — ${heightReport}\n` +
              `이 중 편차(최댓값-최솟값)가 기준(200px)을 넘었습니다. 아래 원본 카드들을 참고해 ` +
              `콘텐츠 분량(문장 길이·리스트 항목 수)만 조정해서 카드끼리 높이가 비슷해지도록 다시 ` +
              `작성하세요. 카드 개수(${finalCards.length}개)·순서·CARD_START/END 형식은 그대로 유지하세요.\n\n` +
              `[원본 카드 전체]\n${finalCards.map(c => `<!-- CARD_START -->\n${c}\n<!-- CARD_END -->`).join("\n\n")}`;
            const retryRaw = stripCodeFence(await call(sp, sk, sm, system, retryUser, maxTok, false, true));
            const retryCards = extractCards(retryRaw);
            if (retryCards.length === finalCards.length) {
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
              console.warn(`[engine] ${channel} · ${stage.id} 재조정 응답 카드 개수 불일치(${retryCards.length}/${finalCards.length}) — 원본 카드 유지`);
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
