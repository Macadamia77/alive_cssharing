import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { dataRoot } from "@/lib/dataRoot";

const FALLBACK: Record<string, string[]> = {
  claude: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-3.5-flash", "gemini-2.5-pro"],
};

/** GET /api/models — provider별 모델 ID 목록(자동완성용) */
export async function GET() {
  try {
    const raw = readFileSync(join(dataRoot(), "data/models.json"), "utf-8");
    const parsed = JSON.parse(raw.replace(/^﻿/, "")) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith("_")) continue; // _comment 제외
      if (Array.isArray(v)) out[k] = v.filter(x => typeof x === "string");
    }
    return NextResponse.json({ models: Object.keys(out).length ? out : FALLBACK });
  } catch {
    return NextResponse.json({ models: FALLBACK });
  }
}
