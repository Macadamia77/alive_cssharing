import { NextRequest, NextResponse } from "next/server";
import { readSharedDataFile, writeSharedDataFile } from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";
import { guard } from "@/lib/authGate";

const FALLBACK: Record<string, string[]> = {
  claude: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-3.5-flash", "gemini-2.5-pro"],
};

/** models.json 텍스트 → provider별 문자열 배열 맵으로 파싱(_ 키 제외). */
function parseModels(raw: string): Record<string, string[]> {
  const parsed = JSON.parse(raw.replace(/^﻿/, "")) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith("_")) continue; // _comment 제외
    if (Array.isArray(v)) out[k] = v.filter(x => typeof x === "string");
  }
  return out;
}

/** GET /api/models — provider별 모델 ID 목록. Supabase(_shared) → 로컬 → 폴백. */
export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const token = resolveGithubToken(req);
    const raw = await readSharedDataFile("models.json", token);
    const out = parseModels(raw);
    return NextResponse.json({ models: Object.keys(out).length ? out : FALLBACK });
  } catch {
    return NextResponse.json({ models: FALLBACK });
  }
}

/** PUT /api/models — 모델 목록 저장(구조화 검증 후 라이브 반영). */
export async function PUT(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const body = await req.json();
    const input = (body?.models ?? body) as unknown;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ error: "형식 오류: provider별 모델 배열 객체가 필요합니다." }, { status: 400 });
    }
    const clean: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k.startsWith("_")) continue;
      if (!Array.isArray(v)) {
        return NextResponse.json({ error: `형식 오류: "${k}"의 값이 배열이 아닙니다.` }, { status: 400 });
      }
      // 문자열만, trim, 공백 제거, 중복 제거, 순서 보존
      const seen = new Set<string>();
      const arr: string[] = [];
      for (const x of v) {
        if (typeof x !== "string") continue;
        const s = x.trim();
        if (!s || seen.has(s)) continue;
        seen.add(s); arr.push(s);
      }
      clean[k] = arr;
    }
    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: "저장할 provider가 없습니다." }, { status: 400 });
    }
    const withComment = {
      _comment: "모델 ID 목록. 설정 페이지의 '모델 목록 관리' 또는 이 파일에서 편집. 정확한 문자열은 각 provider API 문서 기준.",
      ...clean,
    };
    await writeSharedDataFile("models.json", JSON.stringify(withComment, null, 2));
    return NextResponse.json({ ok: true, models: clean });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
