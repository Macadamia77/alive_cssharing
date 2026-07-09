// provider별로 갈라졌던 fetch 호출을 AI SDK(generateText)로 통합.
// 기본 호출(Claude/OpenAI/Gemini)은 아래 3함수로, 웹검색은 하단의 전용 함수(스트리밍/툴)로 유지.
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Provider } from "./aiConfig";

export async function callClaude(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192,
  // 판단·논리 무거운 단계에서만 네이티브 extended thinking을 켠다. reasoning은 결과의 별도
  // 필드로 반환되고 text에는 최종 답만 담기므로, 다운스트림 PASS/FAIL·JSON 파싱을 깨뜨리지 않는다.
  thinking?: { budgetTokens: number }
): Promise<string> {
  const anthropic = createAnthropic({ apiKey });
  // extended thinking은 thinking 예산이 max_tokens 안에 포함되므로, 최종 답변용 여유를 더한다.
  const maxOut = thinking ? Math.max(maxTokens, thinking.budgetTokens + 4000) : maxTokens;
  const { text, finishReason } = await generateText({
    model: anthropic(model),
    system: systemPrompt,
    prompt: userMessage,
    maxOutputTokens: maxOut,
    ...(thinking
      ? { providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: thinking.budgetTokens } } } }
      : {}),
  });
  if (finishReason === "length") {
    console.warn(`[apiClients] callClaude: 최대 토큰(${maxOut}) 도달 — 응답이 잘렸습니다.`);
  }
  if (!text) throw new Error("Claude API 응답이 비어 있습니다.");
  return text;
}

// ─── 웹검색 공용 헬퍼 ──────────────────────────────────────────
// generateText 결과의 sources(구조화 출처)에서 URL 소스만 추려 중복 제거.
// AI SDK가 provider별 citation/groundingMetadata를 sources로 정규화해주므로,
// 예전처럼 스트림을 손으로 파싱하다 출처를 통째로 흘리는 일이 없다.
interface SearchSource { url: string; title?: string }
function extractUrlSources(
  sources: ReadonlyArray<{ sourceType?: string; url?: string; title?: string }> | undefined
): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const s of sources ?? []) {
    if (s?.sourceType === "url" && s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push({ url: s.url, title: s.title });
    }
  }
  return out;
}
// 출처 목록을 본문 끝에 명시적으로 덧붙인다 → 아카이브·하류 컨텍스트에 출처가 살아남는다.
function appendSources(text: string, sources: SearchSource[]): string {
  if (sources.length === 0) return text.trim();
  const list = sources.map((s, i) => `${i + 1}. ${s.title ? `${s.title} — ` : ""}${s.url}`).join("\n");
  return `${text.trim()}\n\n---\n[출처]\n${list}`;
}

/**
 * Claude 웹검색 툴(AI SDK provider-executed)로 실제 검색 기반 응답을 생성한다.
 * - sources(구조화 출처)를 추출해 본문 끝에 [출처] 목록으로 덧붙인다.
 * - 검색 소스 수를 로그로 남긴다(관측성). onSearchStart로 상태 콜백도 호출.
 * - 실패 시 조용히 검색 없는 응답으로 폴백하지 않는다: 1회 재시도 후 명시적 에러.
 *   (검색 실패를 근거 없는 "가짜 리서치"로 덮지 않기 위함.)
 */
export async function callClaudeWithNativeSearch(
  apiKey: string, model: string, systemPrompt: string, userMessage: string,
  maxTokens = 8192, onSearchStart?: (queryCountSoFar: number) => void
): Promise<string> {
  const anthropic = createAnthropic({ apiKey });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, sources, finishReason } = await generateText({
        model: anthropic(model),
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: maxTokens,
        tools: { web_search: anthropic.tools.webSearch_20260209({ maxUses: 5 }) },
      });
      const urls = extractUrlSources(sources);
      onSearchStart?.(urls.length);
      console.log(
        `[apiClients] Claude 웹검색 완료 — 소스 ${urls.length}개` +
        (urls.length === 0 ? " (⚠ 검색 결과 0건 — 근거 없는 응답일 수 있음)" : "")
      );
      if (finishReason === "length") {
        console.warn(`[apiClients] callClaudeWithNativeSearch: 최대 토큰(${maxTokens}) 도달 — 응답이 잘렸습니다.`);
      }
      if (!text.trim()) throw new Error("Claude 웹검색 응답이 비어 있습니다.");
      return appendSources(text, urls);
    } catch (e) {
      lastErr = e;
      console.warn(`[apiClients] Claude 웹검색 실패(시도 ${attempt}/2): ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`Claude 웹검색이 2회 모두 실패했습니다: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function callOpenAI(
  apiKey: string, model: string, systemPrompt: string, userMessage: string
): Promise<string> {
  const openai = createOpenAI({ apiKey });
  const { text } = await generateText({
    model: openai(model),
    system: systemPrompt,
    prompt: userMessage,
  });
  if (!text) throw new Error("OpenAI API 응답이 비어 있습니다.");
  return text;
}

export async function callGemini(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192, disableThinking = false
): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey });
  const providerOptions =
    disableThinking && model.includes("2.5-flash")
      ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
      : undefined;
  const { text, finishReason } = await generateText({
    model: google(model),
    system: systemPrompt,
    prompt: userMessage,
    maxOutputTokens: maxTokens,
    providerOptions,
  });
  if (finishReason === "length") {
    console.warn(`[apiClients] callGemini: 최대 토큰(${maxTokens}) 도달 — 응답이 잘렸습니다.`);
  }
  if (!text) throw new Error("Gemini API 응답이 비어 있습니다.");
  return text;
}

/**
 * Gemini Google Search 그라운딩(AI SDK provider-executed 툴)로 검색 기반 응답 생성.
 * Claude 버전과 동일하게 sources를 추출해 [출처]로 덧붙이고, 소스 수를 로그로 남기며,
 * 실패 시 조용한 no-search 폴백 대신 1회 재시도 후 명시적 에러를 던진다.
 * (예전 구현은 groundingMetadata를 안 읽어 출처를 통째로 버렸음.)
 */
export async function callGeminiWithSearch(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, disableThinking = false
): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey });
  const providerOptions =
    disableThinking && model.includes("2.5-flash")
      ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
      : undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, sources, finishReason } = await generateText({
        model: google(model),
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: 8192,
        providerOptions,
        // 툴 키는 "google_search"여야 한다(@ai-sdk/google 계약).
        tools: { google_search: google.tools.googleSearch({}) },
      });
      const urls = extractUrlSources(sources);
      console.log(
        `[apiClients] Gemini 웹검색 완료 — 소스 ${urls.length}개` +
        (urls.length === 0 ? " (⚠ 검색 결과 0건 — 근거 없는 응답일 수 있음)" : "")
      );
      if (finishReason === "length") {
        console.warn(`[apiClients] callGeminiWithSearch: 최대 토큰(8192) 도달 — 응답이 잘렸습니다.`);
      }
      if (!text.trim()) throw new Error("Gemini 웹검색 응답이 비어 있습니다.");
      return appendSources(text, urls);
    } catch (e) {
      lastErr = e;
      console.warn(`[apiClients] Gemini 웹검색 실패(시도 ${attempt}/2): ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`Gemini 웹검색이 2회 모두 실패했습니다: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/**
 * provider·model을 인자로 받는 공용 LLM 호출 디스패처(runPipeline.ts의 내부 call() 헬퍼와
 * 동일 로직을 공용 모듈로 추출 — 채널에 묶이지 않은 워커 잡(브레인스토밍 등)도 동일하게 재사용).
 */
export async function callProvider(
  p: Provider, apiKey: string, model: string,
  system: string, user: string, maxTokens: number,
  opts?: {
    useSearch?: boolean;
    disableThinking?: boolean;
    onSearchSource?: (n: number) => void;
    // config-driven: 단계에 thinking 예산이 설정된 경우에만 Claude 네이티브 thinking 활성화.
    thinkingBudget?: number;
  }
): Promise<string> {
  if (p === "gemini") {
    return opts?.useSearch
      ? callGeminiWithSearch(apiKey, model, system, user, opts?.disableThinking)
      : callGemini(apiKey, model, system, user, maxTokens, opts?.disableThinking);
  }
  if (p === "claude") {
    return opts?.useSearch
      ? callClaudeWithNativeSearch(apiKey, model, system, user, maxTokens, opts?.onSearchSource)
      : callClaude(apiKey, model, system, user, maxTokens, opts?.thinkingBudget ? { budgetTokens: opts.thinkingBudget } : undefined);
  }
  if (p === "openai") return callOpenAI(apiKey, model, system, user);
  return "";
}
