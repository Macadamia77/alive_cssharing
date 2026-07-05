import { supabase } from "./supabaseClient";
import { resolveGithubToken } from "./resolveToken";
import { type NextRequest } from "next/server";
import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { join } from "path";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  return url.length > 0 && !url.includes("placeholder");
}

// Supabase 미설정(로컬 개발) 시 data/results/<id>.json 파일로 폴백.
// generate/route.ts의 로컬 생성 경로가 쓰는 파일과 같은 위치·스키마를 공유한다.
const LOCAL_RESULTS_DIR = join(process.cwd(), "data", "results");

async function localSaveResult(result: ResultEntry): Promise<void> {
  await mkdir(LOCAL_RESULTS_DIR, { recursive: true });
  await writeFile(join(LOCAL_RESULTS_DIR, `${result.id}.json`), JSON.stringify(result, null, 2), "utf-8");
}

async function localListResults(): Promise<ResultEntry[]> {
  let files: string[];
  try {
    files = (await readdir(LOCAL_RESULTS_DIR)).filter(f => f.endsWith(".json"));
  } catch {
    return [];
  }
  const entries = await Promise.all(files.map(async f => {
    try {
      return JSON.parse(await readFile(join(LOCAL_RESULTS_DIR, f), "utf-8")) as ResultEntry;
    } catch {
      return null;
    }
  }));
  return entries
    .filter((e): e is ResultEntry => !!e)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function localGetResult(id: string): Promise<ResultEntry | null> {
  try {
    return JSON.parse(await readFile(join(LOCAL_RESULTS_DIR, `${id}.json`), "utf-8")) as ResultEntry;
  } catch {
    return null;
  }
}

async function localDeleteResult(id: string): Promise<void> {
  try {
    await unlink(join(LOCAL_RESULTS_DIR, `${id}.json`));
  } catch {
    // 이미 없으면 무시
  }
}

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
  if (!isSupabaseConfigured()) return localSaveResult(result);
  const { error } = await supabase.from("results").upsert({
    id: result.id,
    topic: result.topic,
    channels: result.channels,
    created_at: result.createdAt,
  });
  if (error) throw new Error(`결과 저장 실패: ${error.message}`);
}

export async function listResults(_token?: string): Promise<ResultEntry[]> {
  if (!isSupabaseConfigured()) return localListResults();
  const { data, error } = await supabase
    .from("results")
    .select("id, topic, channels, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`결과 조회 실패: ${error.message}`);
  return ((data as ResultRow[]) ?? []).map(rowToEntry);
}

export async function getResult(id: string, _token?: string): Promise<ResultEntry | null> {
  if (!isSupabaseConfigured()) return localGetResult(id);
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
  if (!isSupabaseConfigured()) return localDeleteResult(id);
  const { error } = await supabase.from("results").delete().eq("id", id);
  if (error) throw new Error(`삭제 실패: ${error.message}`);
}
