// provider별로 갈라졌던 fetch 호출을 AI SDK(generateText)로 통합.
// 기본 호출(Claude/OpenAI/Gemini)은 아래 3함수로, 웹검색은 하단의 전용 함수(스트리밍/툴)로 유지.
import { generateText, generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { z } from "zod";
import type { Provider } from "./aiConfig";

// 검색이 아닌 일반 생성 호출(브레인스토밍·리뷰어 등)은 그동안 timeout이 전혀 없었다 — 검색
// 호출(SEARCH_TIMEOUT_MS)만 2026-07-11경 타임아웃이 들어갔고, 일반 생성은 provider가 느려지거나
// 응답이 멈추면 상한 없이 계속 기다렸다. 브레인스토밍이 25분을 넘겨 클라이언트 폴링 타임아웃에
// 걸린 실제 사례(2026-07-12)의 원인 중 하나로 확인됨 — brainstorm 단계 호출 1건이 무기한 걸릴 수
// 있었고, 그 위에 JSON 파싱 실패 시 재시도까지 겹치면 쉽게 20분을 넘는다. AbortController로
// 상한을 두되, 지정 안 하면(기존 호출부는 전부 undefined) 동작이 그대로라 회귀는 없다.
async function withTimeout<T>(timeoutMs: number | undefined, run: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
  if (!timeoutMs) return run(undefined);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`요청이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 중단했습니다.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function callClaude(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192,
  // 판단·논리 무거운 단계에서만 네이티브 extended thinking을 켠다. reasoning은 결과의 별도
  // 필드로 반환되고 text에는 최종 답만 담기므로, 다운스트림 PASS/FAIL·JSON 파싱을 깨뜨리지 않는다.
  thinking?: { budgetTokens: number },
  timeoutMs?: number
): Promise<string> {
  const anthropic = createAnthropic({ apiKey });
  // extended thinking은 thinking 예산이 max_tokens 안에 포함되므로, 최종 답변용 여유를 더한다.
  const maxOut = thinking ? Math.max(maxTokens, thinking.budgetTokens + 4000) : maxTokens;
  const { text, finishReason } = await withTimeout(timeoutMs, (abortSignal) => generateText({
    model: anthropic(model),
    system: systemPrompt,
    prompt: userMessage,
    maxOutputTokens: maxOut,
    abortSignal,
    ...(thinking
      ? { providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: thinking.budgetTokens } } } }
      : {}),
  }));
  if (finishReason === "length") {
    console.warn(`[apiClients] callClaude: 최대 토큰(${maxOut}) 도달 — 응답이 잘렸습니다.`);
  }
  if (!text) throw new Error("Claude API 응답이 비어 있습니다.");
  return text;
}

// 검색 단계(research/research-voice/research-deep)가 이 시간을 넘기면 (주로 provider 웹검색
// 도구 자체의 rate limit 때문) 더 기다리지 않고 포기해 빈 결과를 반환한다 — 상위 로직(누적
// 리서치 폴백)이 이미 있어 조용히 이어서 진행되고, 파이프라인 전체가 덩달아 늘어지는 걸 막는다.
const SEARCH_TIMEOUT_MS = 4 * 60 * 1000;

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
  maxTokens = 8192, onSearchStart?: (queryCountSoFar: number) => void,
  // research-deep처럼 결과가 어차피 실패 시 누적 데이터로 폴백되는 단계는, 4분을 다 채워
  // 타임아웃나도 얻는 게 없다 — 실측 확인(2026-07-12): 4분 꽉 채우고 실패해 그대로 폐기됨.
  // 호출부가 더 짧은 상한을 지정할 수 있게 하되, 지정 안 하면 기존 4분 그대로(회귀 없음).
  searchTimeoutMs = SEARCH_TIMEOUT_MS
): Promise<string> {
  const anthropic = createAnthropic({ apiKey });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), searchTimeoutMs);
    try {
      const { text, sources, finishReason } = await generateText({
        model: anthropic(model),
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: maxTokens,
        tools: { web_search: anthropic.tools.webSearch_20260209({ maxUses: 5 }) },
        abortSignal: controller.signal,
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
      if (controller.signal.aborted) {
        console.warn(`[apiClients] Claude 웹검색이 ${searchTimeoutMs / 1000}초 안에 안 끝나 중단 — 검색 없이 진행합니다(상위 로직이 누적 데이터로 폴백).`);
        return "";
      }
      lastErr = e;
      console.warn(`[apiClients] Claude 웹검색 실패(시도 ${attempt}/2): ${e instanceof Error ? e.message : e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Claude 웹검색이 2회 모두 실패했습니다: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function callOpenAI(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, timeoutMs?: number
): Promise<string> {
  const openai = createOpenAI({ apiKey });
  const { text } = await withTimeout(timeoutMs, (abortSignal) => generateText({
    model: openai(model),
    system: systemPrompt,
    prompt: userMessage,
    abortSignal,
  }));
  if (!text) throw new Error("OpenAI API 응답이 비어 있습니다.");
  return text;
}

export async function callGemini(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192,
  disableThinking = false, timeoutMs?: number
): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey });
  const providerOptions =
    disableThinking && model.includes("2.5-flash")
      ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
      : undefined;
  const { text, finishReason } = await withTimeout(timeoutMs, (abortSignal) => generateText({
    model: google(model),
    system: systemPrompt,
    prompt: userMessage,
    maxOutputTokens: maxTokens,
    providerOptions,
    abortSignal,
  }));
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
  apiKey: string, model: string, systemPrompt: string, userMessage: string, disableThinking = false,
  searchTimeoutMs = SEARCH_TIMEOUT_MS
): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey });
  const providerOptions =
    disableThinking && model.includes("2.5-flash")
      ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
      : undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), searchTimeoutMs);
    try {
      const { text, sources, finishReason } = await generateText({
        model: google(model),
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: 8192,
        providerOptions,
        // 툴 키는 "google_search"여야 한다(@ai-sdk/google 계약).
        tools: { google_search: google.tools.googleSearch({}) },
        abortSignal: controller.signal,
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
      if (controller.signal.aborted) {
        console.warn(`[apiClients] Gemini 웹검색이 ${searchTimeoutMs / 1000}초 안에 안 끝나 중단 — 검색 없이 진행합니다(상위 로직이 누적 데이터로 폴백).`);
        return "";
      }
      lastErr = e;
      console.warn(`[apiClients] Gemini 웹검색 실패(시도 ${attempt}/2): ${e instanceof Error ? e.message : e}`);
    } finally {
      clearTimeout(timer);
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
    // 검색 단계 전용이 아닌 일반 생성 호출에 상한을 두고 싶을 때만 지정(기본은 무제한 — 기존
    // 동작 유지). useSearch=true면 이 값 대신 아래 searchTimeoutMs가 적용된다.
    timeoutMs?: number;
    // useSearch=true 전용 타임아웃 — 지정 안 하면 검색 함수 자체의 기본값(4분)을 그대로 쓴다.
    // research-deep처럼 실패해도 어차피 누적 데이터로 폴백되는 단계는 더 짧게 잡아 낭비를
    // 줄일 수 있다(호출부 예: render-worker/index.ts의 research-deep 호출).
    searchTimeoutMs?: number;
  }
): Promise<string> {
  if (p === "gemini") {
    return opts?.useSearch
      ? callGeminiWithSearch(apiKey, model, system, user, opts?.disableThinking, opts?.searchTimeoutMs)
      : callGemini(apiKey, model, system, user, maxTokens, opts?.disableThinking, opts?.timeoutMs);
  }
  if (p === "claude") {
    return opts?.useSearch
      ? callClaudeWithNativeSearch(apiKey, model, system, user, maxTokens, opts?.onSearchSource, opts?.searchTimeoutMs)
      : callClaude(apiKey, model, system, user, maxTokens, opts?.thinkingBudget ? { budgetTokens: opts.thinkingBudget } : undefined, opts?.timeoutMs);
  }
  if (p === "openai") return callOpenAI(apiKey, model, system, user, opts?.timeoutMs);
  return "";
}

/**
 * generateObject 기반 구조화 출력 호출. 텍스트로 "JSON만 출력해" 라고 프롬프트로만 지시하고
 * JSON.parse로 되받던 방식(카드 생성에서 쓰던 예전 방식) 대신, provider가 스키마를 만족하는
 * 응답만 반환하도록 강제한다(Claude/OpenAI는 tool-calling, Gemini는 네이티브 JSON 스키마 모드로
 * AI SDK가 내부적으로 처리) — 코드펜스 덧씌우기·잡담 섞임·필드 누락 같은 파싱 실패 경로 자체가
 * 없어진다. 스키마를 못 만족하면(재시도 후에도) NoObjectGeneratedError를 던지므로 호출자가
 * 명시적으로 처리한다.
 */
export async function callProviderForObject<S extends z.ZodType>(
  p: Provider, apiKey: string, model: string,
  system: string, user: string, maxTokens: number, schema: S
): Promise<z.infer<S>> {
  const languageModel =
    p === "gemini" ? createGoogleGenerativeAI({ apiKey })(model) :
    p === "claude" ? createAnthropic({ apiKey })(model) :
    createOpenAI({ apiKey })(model);
  // prompt(문자열)와 messages(배열) 중 하나만 써야 하는 유니언인데(AI SDK Prompt 타입), root
  // tsconfig(moduleResolution:"bundler")에서는 prompt만 써도 통과하지만 render-worker(자체
  // tsconfig, moduleResolution 기본값)에서는 같은 유니언이 다르게 해석돼 "messages 없음" 에러가
  // 났다(실측 확인 — render-worker는 Railway에 별도 배포되는 워커라 root의 tsc 통과만으론
  // 안심할 수 없다). messages로 명시하면 유니언의 한쪽 분기를 애매함 없이 직접 만족시켜 두
  // 환경 모두에서 안정적으로 통과한다.
  const { object } = await generateObject({
    model: languageModel,
    schema,
    system,
    messages: [{ role: "user", content: user }],
    maxOutputTokens: maxTokens,
  });
  // generateObject의 반환 타입은 (배열/enum/no-schema 출력 모드까지 아우르는) 조건부 타입이라
  // "항상 object 모드로 쓴다"는 이 함수의 전제를 TS가 알 길이 없어 캐스팅이 필요하다 — 런타임
  // 값 자체는 스키마로 이미 검증된 상태다.
  return object as z.infer<S>;
}

/**
 * callProviderForObject의 멀티모달 버전 — 이미지(들)를 첨부해 vision 모델에게 구조화 출력을
 * 요청한다(image-review 단계 전용). Claude/OpenAI/Gemini 모두 이 세 provider의 최신 모델은
 * 기본적으로 vision을 지원하므로, 텍스트 전용 호출과 동일한 모델 해석 경로를 그대로 쓴다 —
 * 별도의 "vision 모델" 선택 로직이 필요 없다.
 */
export async function callProviderForObjectWithImages<S extends z.ZodType>(
  p: Provider, apiKey: string, model: string,
  system: string, text: string, images: Buffer[], maxTokens: number, schema: S
): Promise<z.infer<S>> {
  const languageModel =
    p === "gemini" ? createGoogleGenerativeAI({ apiKey })(model) :
    p === "claude" ? createAnthropic({ apiKey })(model) :
    createOpenAI({ apiKey })(model);
  const { object } = await generateObject({
    model: languageModel,
    schema,
    system,
    messages: [{
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((data) => ({ type: "file" as const, data, mediaType: "image/png" })),
      ],
    }],
    maxOutputTokens: maxTokens,
  });
  return object as z.infer<S>;
}
