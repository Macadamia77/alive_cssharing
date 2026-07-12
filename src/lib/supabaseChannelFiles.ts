// Supabase `channel_files` 테이블 접근 헬퍼.
// channelFiles.ts가 이 함수들을 통해 Supabase를 "최우선 소스"로 쓰고,
// 실패/미설정 시 기존 GitHub → 로컬 번들 폴백으로 넘어간다 (비파괴적).
import { supabase } from "./supabaseClient";

export interface SbFile {
  content: string;   // 텍스트 원문 (is_binary면 base64 문자열)
  isBinary: boolean;
}

/**
 * Supabase channel_files 경로를 쓸 수 있는지.
 * channel_files는 RLS로 service_role만 접근 가능하므로, **service_role key가 있을 때만** true.
 * (로컬에서 anon key만 있으면 false → 기존 GitHub/로컬 폴백 사용)
 */
export function sbConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return !!url && !!key && !url.includes("placeholder") && !key.includes("placeholder");
}

/** 단일 파일 읽기. 행이 없으면 null. */
export async function sbReadFile(channel: string, path: string): Promise<SbFile | null> {
  const { data, error } = await supabase
    .from("channel_files")
    .select("content, is_binary")
    .eq("channel", channel)
    .eq("path", path)
    .maybeSingle();
  if (error) throw new Error(`[sbReadFile] ${channel}/${path}: ${error.message}`);
  if (!data) return null;
  return { content: data.content ?? "", isBinary: data.is_binary ?? false };
}

/** 채널의 모든 파일 경로 목록. */
export async function sbListPaths(channel: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("channel_files")
    .select("path")
    .eq("channel", channel);
  if (error) throw new Error(`[sbListPaths] ${channel}: ${error.message}`);
  return (data ?? []).map((r) => r.path as string);
}

/** 채널의 모든 파일(path→content/is_binary)을 한 번의 쿼리로 읽는다.
 *  가이드·페르소나 로딩처럼 한 채널의 파일을 여러 개 순차로 읽던 호출부(readChannelFile 반복)를
 *  이 단일 조회 결과 캐시로 대체해 요청당 Supabase 왕복 횟수를 줄이는 데 쓴다. */
export async function sbReadAllFiles(channel: string): Promise<Map<string, SbFile>> {
  const { data, error } = await supabase
    .from("channel_files")
    .select("path, content, is_binary")
    .eq("channel", channel);
  if (error) throw new Error(`[sbReadAllFiles] ${channel}: ${error.message}`);
  const map = new Map<string, SbFile>();
  for (const row of data ?? []) {
    map.set(row.path as string, { content: row.content ?? "", isBinary: row.is_binary ?? false });
  }
  return map;
}

/** 파일 업서트(있으면 갱신, 없으면 삽입). */
export async function sbWriteFile(
  channel: string,
  path: string,
  content: string,
  isBinary = false
): Promise<void> {
  const { error } = await supabase.from("channel_files").upsert(
    { channel, path, content, is_binary: isBinary, updated_at: new Date().toISOString() },
    { onConflict: "channel,path" }
  );
  if (error) throw new Error(`[sbWriteFile] ${channel}/${path}: ${error.message}`);
}

/** 단일 파일 삭제. */
export async function sbDeleteFile(channel: string, path: string): Promise<void> {
  const { error } = await supabase
    .from("channel_files")
    .delete()
    .eq("channel", channel)
    .eq("path", path);
  if (error) throw new Error(`[sbDeleteFile] ${channel}/${path}: ${error.message}`);
}

/** 경로 접두사(폴더) 아래 전체 삭제. 예: prefix="guide/" */
export async function sbDeletePrefix(channel: string, prefix: string): Promise<void> {
  const { error } = await supabase
    .from("channel_files")
    .delete()
    .eq("channel", channel)
    .like("path", `${prefix}%`);
  if (error) throw new Error(`[sbDeletePrefix] ${channel}/${prefix}: ${error.message}`);
}
