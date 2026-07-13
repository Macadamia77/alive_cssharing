// 파이프라인 피드백/메모리 (Phase 4)
// - pipeline_feedback: 채널별 누적 피드백 → 매 생성 시 최근 N개를 프롬프트에 주입
// - pipeline_examples: 채널별 우수작 → 매 생성 시 최근 N개를 퓨샷(참고작)으로 주입
// 테이블이 없거나 접근 실패해도 파이프라인을 막지 않는다(빈 배열 반환 = fail-soft).
import { supabase } from "./supabaseClient";
import type { ChannelKey } from "./channels";
import type { Provider } from "./aiConfig";
import { callClaude, callOpenAI, callGemini } from "./apiClients";
import { loadPersona } from "./pipeline/promptAssembly";

// [M8 ④] 컨텍스트 참조 예산 — 카테고리별 주입 건수 + 리서치 최신성(일) + 항목 길이 캡. 토큰 조절용.
export interface ContextBudget { feedback: number; examples: number; bad: number; research: number; researchDays: number; cap: number; }
const BUDGET_DEFAULT: ContextBudget = { feedback: 10, examples: 3, bad: 3, research: 5, researchDays: 30, cap: 600 };
/** 저장값(카테고리별 JSON 문자열, 또는 구버전 프리셋 문자열)을 ContextBudget로 정규화. 누락은 기본값. */
export function contextBudget(b?: string | null): ContextBudget {
  // 구버전 프리셋 호환
  if (b === "light") return { feedback: 3, examples: 1, bad: 1, research: 2, researchDays: 30, cap: 300 };
  if (b === "heavy") return { feedback: 20, examples: 6, bad: 6, research: 10, researchDays: 90, cap: 1500 };
  if (b === "normal" || !b) return { ...BUDGET_DEFAULT };
  try {
    const o = JSON.parse(b) as Partial<ContextBudget>;
    return {
      feedback: num(o.feedback, BUDGET_DEFAULT.feedback),
      examples: num(o.examples, BUDGET_DEFAULT.examples),
      bad: num(o.bad, BUDGET_DEFAULT.bad),
      research: num(o.research, BUDGET_DEFAULT.research),
      researchDays: num(o.researchDays, BUDGET_DEFAULT.researchDays),
      cap: num(o.cap, BUDGET_DEFAULT.cap),
    };
  } catch { return { ...BUDGET_DEFAULT }; }
}
function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; }

export interface FeedbackRow { id: string; channel: string; text: string; active: boolean; created_at: string; }
export interface ExampleRow { id: string; channel: string; content: string; note: string | null; created_at: string; }
export interface BadExampleRow { id: string; channel: string; content: string; reason: string | null; created_at: string; }
export interface ResearchRow { id: string; channel: string | null; stage: string; topic: string | null; content: string; created_at: string; run_id?: string | null; }

/** 생성 시 주입할: 활성 피드백 최근 N개 (텍스트만) */
export async function getRecentFeedback(channel: ChannelKey, limit = 10): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("pipeline_feedback")
      .select("text")
      .eq("channel", channel).eq("active", true)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map(r => r.text).filter(Boolean);
  } catch { return []; }
}

/** 브레인스토밍(채널 배정 이전)용: 채널 무관 최근 활성 피드백. */
export async function getRecentFeedbackAny(limit = 10): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("pipeline_feedback")
      .select("text")
      .eq("active", true)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map(r => r.text).filter(Boolean);
  } catch { return []; }
}

/** 생성 시 주입할: 우수작 최근 N개 (본문만) */
export async function getRecentExamples(channel: ChannelKey, limit = 3): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("pipeline_examples")
      .select("content")
      .eq("channel", channel)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map(r => r.content).filter(Boolean);
  } catch { return []; }
}

/** 생성 시 주입할: 기각 사례 최근 N개 (본문 + 사유) */
export async function getRecentBadExamples(channel: ChannelKey, limit = 3): Promise<{ content: string; reason: string | null }[]> {
  try {
    const { data, error } = await supabase
      .from("pipeline_bad_examples")
      .select("content, reason")
      .eq("channel", channel)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map(r => ({ content: r.content, reason: r.reason ?? null })).filter(r => r.content);
  } catch { return []; }
}

/** 검수 반려 시 기각 사례 저장 (엔진에서 fire-and-forget) */
export async function addBadExample(channel: ChannelKey, content: string, reason?: string): Promise<void> {
  try {
    await supabase.from("pipeline_bad_examples").insert({ channel, content, reason: reason ?? null });
  } catch { /* 학습 저장 실패는 무시 */ }
}

// ── 관리(API용) ──
export async function listBadExamples(channel: ChannelKey): Promise<BadExampleRow[]> {
  const { data, error } = await supabase.from("pipeline_bad_examples")
    .select("*").eq("channel", channel).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BadExampleRow[];
}
export async function deleteBadExample(id: string): Promise<void> {
  const { error } = await supabase.from("pipeline_bad_examples").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** 웹서치(리서치) 단계 산출물 저장 (엔진에서 fire-and-forget).
 *  channel=null은 채널 배정 이전의 공유 리서치(브레인스토밍 런). runId로 런에 연결. */
export async function addResearch(
  channel: ChannelKey | null, stage: string, topic: string, content: string, runId?: string
): Promise<void> {
  try {
    await supabase.from("pipeline_research").insert({ channel, stage, topic: topic || null, content, run_id: runId ?? null });
  } catch { /* 저장 실패 무시 */ }
}

/** 생성 시 주입할: 최근 누적 리서치(research/research-voice)를 최신성 필터로 N개.
 *  브레인스토밍이 "지식 베이스 보강 + 주제 중복 회피"에 참고. 오래된 통계는 배제(maxAgeDays). */
export async function getRecentResearch(limit = 5, maxAgeDays = 30): Promise<ResearchRow[]> {
  try {
    const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
    const { data, error } = await supabase.from("pipeline_research")
      .select("*")
      .in("stage", ["research", "research-voice"])
      .gte("created_at", since)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data as ResearchRow[];
  } catch { return []; }
}
export async function listResearch(channel: ChannelKey): Promise<ResearchRow[]> {
  const { data, error } = await supabase.from("pipeline_research")
    .select("*").eq("channel", channel).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ResearchRow[];
}
// [작업 5] 공유(브레인스토밍) 리서치는 채널 무관하게 channel=null로 저장된다. 자료실 "공용" 탭이
// 이걸 조회한다. NULL 비교는 .eq가 아니라 .is를 써야 한다(.eq("channel", null)은 아무것도 안 잡음).
export async function listSharedResearch(): Promise<ResearchRow[]> {
  const { data, error } = await supabase.from("pipeline_research")
    .select("*").is("channel", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ResearchRow[];
}
export async function deleteResearch(id: string): Promise<void> {
  const { error } = await supabase.from("pipeline_research").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listFeedback(channel: ChannelKey): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.from("pipeline_feedback")
    .select("*").eq("channel", channel).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FeedbackRow[];
}
export async function addFeedback(channel: ChannelKey, text: string): Promise<void> {
  const { error } = await supabase.from("pipeline_feedback").insert({ channel, text });
  if (error) throw new Error(error.message);
}
export async function deleteFeedback(id: string): Promise<void> {
  const { error } = await supabase.from("pipeline_feedback").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listExamples(channel: ChannelKey): Promise<ExampleRow[]> {
  const { data, error } = await supabase.from("pipeline_examples")
    .select("*").eq("channel", channel).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExampleRow[];
}
export interface ExampleSummary { subject: string; angle: string; expansion: string }

// 우수작에서 "소재/앵글/확장전략"만 추출(문체 재현 금지). 브레인스토밍이 문체 오염 없이
// 참고할 요약. 실패(키 없음·LLM 오류·파싱 실패)해도 null 반환 → 원문 저장은 항상 진행(fail-soft).
async function extractExampleSummary(
  content: string,
  auth: { provider: Provider; apiKey: string; model: string }
): Promise<ExampleSummary | null> {
  try {
    const persona = await loadPersona(null, "example-summarizer");
    if (!persona) return null;
    const user = `[콘텐츠]\n${content.slice(0, 8000)}`;
    let raw: string;
    if (auth.provider === "claude") raw = await callClaude(auth.apiKey, auth.model, persona, user, 1024);
    else if (auth.provider === "openai") raw = await callOpenAI(auth.apiKey, auth.model, persona, user);
    else if (auth.provider === "gemini") raw = await callGemini(auth.apiKey, auth.model, persona, user, 1024);
    else return null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Partial<ExampleSummary>;
    if (!p.subject && !p.angle && !p.expansion) return null;
    return { subject: String(p.subject ?? ""), angle: String(p.angle ?? ""), expansion: String(p.expansion ?? "") };
  } catch { return null; }
}

// naver-blog 결과물은 카드 이미지가 base64 데이터 URI로 <img> 태그 안에 통째로 박혀 있다. "우수
// 참고작"의 목적은 톤·구조 참고(이미지 데이터는 전혀 안 씀)인데, 이미지 데이터가 건당 수백 KB~
// 수 MB를 차지해 저장을 부풀리고, 이후 생성마다 그대로 재주입되면서 프롬프트를 함께 부풀린다.
// 실측 사고(2026-07-13): 저장된 우수작 2건(각 701KB)이 재주입되며 writer 프롬프트가 129만
// 토큰까지 불어나 Claude 컨텍스트 한도(100만 토큰)를 넘겨 생성 자체가 실패했다. 저장 전에 제거한다.
function stripEmbeddedImages(content: string): string {
  return content.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "data:image/png;base64,[생략]");
}

export async function addExample(
  channel: ChannelKey, content: string, note?: string,
  // auth가 있으면 저장 시점에 요약을 함께 뽑아 summary_json에 넣는다(원문은 항상 그대로 보존).
  auth?: { provider: Provider; apiKey: string; model: string }
): Promise<void> {
  const cleaned = stripEmbeddedImages(content);
  const row: Record<string, unknown> = { channel, content: cleaned, note: note ?? null };
  if (auth) {
    const summary = await extractExampleSummary(cleaned, auth);
    if (summary) row.summary_json = summary; // 실패 시 필드 자체를 생략 → 원문 저장은 무조건 성공
  }
  const { error } = await supabase.from("pipeline_examples").insert(row);
  if (error) throw new Error(error.message);
}

// 브레인스토밍 단계용: 최근 우수작의 "소재/앵글/확장전략" 요약만(원문 문체는 제외).
export async function getRecentExampleSummaries(channel: ChannelKey, limit = 5): Promise<ExampleSummary[]> {
  try {
    const { data, error } = await supabase.from("pipeline_examples")
      .select("summary_json").eq("channel", channel)
      .not("summary_json", "is", null)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map(r => r.summary_json).filter(Boolean) as ExampleSummary[];
  } catch { return []; }
}

/** 브레인스토밍(채널 배정 이전)용: 채널 무관 최근 우수작 요약. 주제 이념 단계는 아직 채널이
 *  안 정해졌으므로, 특정 채널로 좁히지 않고 전 채널 우수작에서 소재·전략 패턴을 참고한다. */
export async function getRecentExampleSummariesAny(limit = 5): Promise<ExampleSummary[]> {
  try {
    const { data, error } = await supabase.from("pipeline_examples")
      .select("summary_json")
      .not("summary_json", "is", null)
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map(r => r.summary_json).filter(Boolean) as ExampleSummary[];
  } catch { return []; }
}
export async function deleteExample(id: string): Promise<void> {
  const { error } = await supabase.from("pipeline_examples").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
