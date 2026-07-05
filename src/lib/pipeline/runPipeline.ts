// 통합 파이프라인 엔진.
// 흐름(단계 순서·scope·토글)은 config(pipeline.json + _meta.pipeline)로,
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

// ─── 채널 가이드 텍스트 수집 (agents/·템플릿 제외, writer용) ────
async function gatherGuides(channel: ChannelKey, token?: string): Promise<string> {
  let keys: string[];
  try {
    keys = await collectGuideFiles(channel, token);
  } catch {
    return "";
  }
  const guideKeys = keys.filter(
    k => isTextFile(k.split("/").pop() ?? "")
      && !k.startsWith("agents/")
      && !k.startsWith("templates/")
  );
  const parts: string[] = [];
  for (const k of guideKeys) {
    try {
      const c = await readChannelFile(channel, k, token);
      if (c.trim()) parts.push(`\n\n${"=".repeat(60)}\n# ${k}\n${"=".repeat(60)}\n\n${c}`);
    } catch { /* skip */ }
  }
  return parts.join("");
}

// ─── 검수 결과 판정 (JSON verdict 또는 텍스트 PASS/FAIL/REJECT) ─
function isRejected(reviewOutput: string): boolean {
  const s = reviewOutput.trim();
  // JSON verdict
  const vm = s.match(/"verdict"\s*:\s*"([^"]+)"/i);
  if (vm) return /reject|fail/i.test(vm[1]);
  const nm = s.match(/"is_natural"\s*:\s*(true|false)/i);
  if (nm) return nm[1].toLowerCase() === "false";
  // 텍스트 첫 줄
  const first = s.split("\n")[0]?.trim().toUpperCase() ?? "";
  if (first.startsWith("REJECT") || first.startsWith("FAIL")) return true;
  if (first.startsWith("APPROVE") || first.startsWith("PASS")) return false;
  // 본문에 REJECT/반려가 뚜렷하면 반려로 간주
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

  // Mock 모드
  if (provider === "mock") {
    return `[engine mock] ${channel} · ${topic} · 단계: ${stages.map(s => s.id).join(">")}`;
  }

  // ── Provider 인증 (기존 경로와 동일) ──
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  const envModel = process.env[`${provider.toUpperCase()}_MODEL`]?.trim();
  let pc = envKey ? { apiKey: envKey, model: envModel || DEFAULT_MODELS[provider] } : null;
  if (!pc) {
    pc = await loadAIConfig(token).then(c => c.providers[provider as ProviderKey]).catch(() => null);
  }
  if (apiKeyOverride) {
    pc = { apiKey: apiKeyOverride, model: pc?.model || envModel || DEFAULT_MODELS[provider] };
  }
  if (!pc?.apiKey) {
    throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
  }
  const auth = pc;

  // ── 단계별 LLM 호출 헬퍼 ──
  const call = async (
    system: string,
    user: string,
    maxTokens: number,
    useSearch: boolean,
    disableThinking: boolean,
    onSource?: (n: number) => void
  ): Promise<string> => {
    if (provider === "gemini") {
      return useSearch
        ? callGeminiWithSearch(auth.apiKey, auth.model, system, user, disableThinking)
        : callGemini(auth.apiKey, auth.model, system, user, maxTokens, disableThinking);
    }
    if (provider === "claude") {
      return useSearch
        ? callClaudeWithNativeSearch(auth.apiKey, auth.model, system, user, maxTokens, onSource)
        : callClaude(auth.apiKey, auth.model, system, user, maxTokens);
    }
    if (provider === "openai") return callOpenAI(auth.apiKey, auth.model, system, user);
    return "";
  };

  const guides = await gatherGuides(channel, token);

  // 누적 컨텍스트(producer 산출물) + 현재 초안
  const contextParts: string[] = [];
  if (draftProvided) contextParts.push(`[작성자 초안]\n${userDraft}`);
  let draft = "";

  for (const stage of stages) {
    const kind = stageKind(stage.id);
    const persona = await loadPersona(channel, stage.persona ?? stage.id, token);
    if (!persona) {
      console.warn(`[engine] ${channel}/${stage.id}: 페르소나 '${stage.persona ?? stage.id}' 파일 없음 → 단계 건너뜀`);
      continue;
    }
    const maxTok = stage.maxTokens ?? 4096;
    if (statusCallback) await statusCallback(stage.id);
    console.log(`[engine] ${channel} · ${stage.id}(${kind}) 시작`);

    if (kind === "producer") {
      const system = persona;
      const user =
        `[주제]\n${topic}\n\n` +
        (contextParts.length ? `[이전 단계 산출물]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
        `위 정보를 바탕으로 이 단계의 역할을 수행해 결과를 직접 출력하세요.`;
      const out = stripCodeFence(await call(system, user, maxTok, stage.useSearch, stage.disableThinking,
        (n) => { if (statusCallback) void statusCallback(`소스 ${n}개 검색 중`); }));
      if (out.trim()) contextParts.push(`[${stage.id} 산출물]\n${out}`);
      console.log(`[engine] ${channel} · ${stage.id} 완료 (${out.length}자)`);

    } else if (kind === "writer") {
      const system = persona + guides;
      const user =
        `[주제]\n${topic}\n\n` +
        (contextParts.length ? `[참고 자료 — 이전 단계 산출물]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
        `위 자료와 시스템 프롬프트의 가이드 규칙을 철저히 적용해 ${channel} 채널 콘텐츠를 완성하세요.`;
      draft = stripCodeFence(await call(system, user, maxTok, false, meta.disableThinking ?? false));
      if (!draft.trim()) throw new Error(`[engine] ${channel} writer 단계 결과가 비어 있습니다.`);
      console.log(`[engine] ${channel} · writer 완료 (${draft.length}자)`);

    } else if (kind === "reviewer") {
      if (!draft.trim()) { console.warn(`[engine] ${channel}/${stage.id}: 검수할 초안 없음 → 건너뜀`); continue; }
      const review = stripCodeFence(await call(persona, `[검수 대상]\n${draft}`, maxTok, false, false));
      if (isRejected(review)) {
        if (statusCallback) await statusCallback(`${stage.id} 반영 재작성`);
        console.log(`[engine] ${channel} · ${stage.id} 반려 → 재작성`);
        // 재작성: writer 페르소나 + 가이드로 피드백 반영 (writer 페르소나 재로딩)
        const writerPersona = await loadPersona(channel, "writer", token);
        const rewriteSystem = (writerPersona ?? "") + guides;
        const rewriteUser =
          `[주제]\n${topic}\n\n` +
          (contextParts.length ? `[참고 자료]\n${contextParts.join("\n\n---\n\n")}\n\n` : "") +
          `[이전 원고]\n${draft}\n\n` +
          `[검수 피드백 — 아래 문제를 모두 해결해 전체를 다시 작성]\n${review}`;
        const revised = stripCodeFence(await call(rewriteSystem, rewriteUser, meta.maxTokens ?? 24000, false, meta.disableThinking ?? false));
        if (revised.trim()) draft = revised;
      } else {
        console.log(`[engine] ${channel} · ${stage.id} 통과`);
      }

    } else if (kind === "image") {
      // 이미지 단계(html 카드 조립 등)는 후속 구현 — 현재는 no-op로 통과
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
