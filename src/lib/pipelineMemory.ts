// 파이프라인 피드백/메모리 (Phase 4)
// - pipeline_feedback: 채널별 누적 피드백 → 매 생성 시 최근 N개를 프롬프트에 주입
// - pipeline_examples: 채널별 우수작 → 매 생성 시 최근 N개를 퓨샷(참고작)으로 주입
// 테이블이 없거나 접근 실패해도 파이프라인을 막지 않는다(빈 배열 반환 = fail-soft).
import { supabase } from "./supabaseClient";
import type { ChannelKey } from "./channels";

export interface FeedbackRow { id: string; channel: string; text: string; active: boolean; created_at: string; }
export interface ExampleRow { id: string; channel: string; content: string; note: string | null; created_at: string; }

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

// ── 관리(API용) ──
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
export async function addExample(channel: ChannelKey, content: string, note?: string): Promise<void> {
  const { error } = await supabase.from("pipeline_examples").insert({ channel, content, note: note ?? null });
  if (error) throw new Error(error.message);
}
export async function deleteExample(id: string): Promise<void> {
  const { error } = await supabase.from("pipeline_examples").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
