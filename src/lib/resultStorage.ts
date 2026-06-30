import { supabase } from "./supabaseClient";
import { resolveGithubToken } from "./resolveToken";
import { type NextRequest } from "next/server";

export interface ResultEntry {
  id: string;
  topic: string;
  createdAt: string;
  channels: Partial<Record<string, string>>;
}

export function newResultId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

// 호출부 호환을 위해 유지. Supabase 저장은 GitHub 토큰이 필요 없어 값은 사용되지 않는다.
export function resolveToken(req?: NextRequest): string | undefined {
  if (req) return resolveGithubToken(req);
  return process.env.GITHUB_TOKEN;
}

type ResultRow = {
  id: string;
  topic: string;
  channels: Partial<Record<string, string>>;
  created_at: string;
};

function rowToEntry(row: ResultRow): ResultEntry {
  return {
    id: row.id,
    topic: row.topic,
    createdAt: row.created_at,
    channels: row.channels ?? {},
  };
}

export async function saveResult(result: ResultEntry, _token?: string): Promise<void> {
  const { error } = await supabase.from("results").upsert({
    id: result.id,
    topic: result.topic,
    channels: result.channels,
    created_at: result.createdAt,
  });
  if (error) throw new Error(`결과 저장 실패: ${error.message}`);
}

export async function listResults(_token?: string): Promise<ResultEntry[]> {
  const { data, error } = await supabase
    .from("results")
    .select("id, topic, channels, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`결과 조회 실패: ${error.message}`);
  return ((data as ResultRow[]) ?? []).map(rowToEntry);
}

export async function getResult(id: string, _token?: string): Promise<ResultEntry | null> {
  const { data, error } = await supabase
    .from("results")
    .select("id, topic, channels, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return rowToEntry(data as ResultRow);
}

export async function updateResult(id: string, patch: Partial<ResultEntry>, _token?: string): Promise<void> {
  const existing = await getResult(id);
  if (!existing) throw new Error("결과물을 찾을 수 없습니다.");
  await saveResult({
    ...existing,
    ...patch,
    channels: { ...existing.channels, ...(patch.channels ?? {}) },
  });
}

export async function deleteResult(id: string, _token?: string): Promise<void> {
  const { error } = await supabase.from("results").delete().eq("id", id);
  if (error) throw new Error(`삭제 실패: ${error.message}`);
}
