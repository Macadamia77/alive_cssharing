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
  apiKeyOverride?: string
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

  // 단계의 provider/model 해석 (오버라이드 provider 키가 없으면 기본으로 폴백)
  const resolveStageModel = async (s: ResolvedStage): Promise<{ p: Provider; apiKey: string; model: string }> => {
    let p = (s.model as Provider) || provider;
    let a = await resolveAuth(p);
    if (!a) { p = provider; a = baseAuth; }
    return { p, apiKey: a.apiKey, model: s.modelId || a.model };
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
      // 검수기도 자기에게 할당된 조각(예: tone-review ← 금지어 사전)을 받는다.
      const review = stripCodeFence(await call(sp, sk, sm, persona + stageGuides, `[검수 대상]\n${draft}`, maxTok, false, false));
      if (isRejected(review)) {
        if (statusCallback) await statusCallback(`${stage.id} 반영 재작성`);
        console.log(`[engine] ${channel} · ${stage.id} 반려 → 재작성 | 사유: ${review.replace(/\s+/g, " ").slice(0, 300)}`);
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
      } else {
        console.log(`[engine] ${channel} · ${stage.id} 통과`);
      }

    } else if (kind === "image") {
      console.log(`[engine] ${channel} · ${stage.id} (이미지 단계 미구현, 통과)`);
    }
  }

  if (!draft.trim()) {
    throw new Error(`[engine] ${channel}: writer 단계가 실행되지 않아 결과물이 없습니다.`);
  }

  // ── 최종 조립 (outputFormat별) ──
  const fmt = meta.outputFormat ?? "text";
  if (fmt === "html") {
    // TODO: assembleNaverBlogHtml + 이미지 카드 (네이버는 아직 legacy runAgentPipeline 사용)
    return draft;
  }
  // json / text: writer가 이미 형식대로 출력 → 그대로 반환
  return draft;
}
