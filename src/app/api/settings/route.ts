import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { isVercelProd, githubWrite } from "@/lib/githubStorage";

const CONFIG_PATH = path.join(process.cwd(), "data", "ai-config.json");

export interface AIConfig {
  provider: "mock" | "claude" | "openai";
  apiKey: string;
  model: string;
}

async function readConfig(): Promise<AIConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    return { provider: "mock", apiKey: "", model: "" };
  }
}

async function writeConfig(config: AIConfig) {
  if (isVercelProd()) {
    await githubWrite("app/data/ai-config.json", JSON.stringify(config, null, 2));
    return;
  }
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** GET — 현재 설정 반환 (API 키는 마스킹) */
export async function GET() {
  const config = await readConfig();
  return NextResponse.json({
    provider: config.provider,
    model: config.model,
    apiKeySet: config.apiKey.length > 0,
    apiKeyMasked: config.apiKey ? `${"*".repeat(Math.max(0, config.apiKey.length - 4))}${config.apiKey.slice(-4)}` : "",
  });
}

/** PUT — 설정 저장 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const current = await readConfig();

    const updated: AIConfig = {
      provider: body.provider ?? current.provider,
      model: body.model ?? current.model,
      // 빈 문자열로 보내면 기존 키 유지, 새 키면 업데이트
      apiKey: body.apiKey !== undefined && body.apiKey !== "" ? body.apiKey : current.apiKey,
    };

    await writeConfig(updated);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/settings/test — API 연결 테스트 */
export async function POST() {
  const config = await readConfig();

  if (config.provider === "mock") {
    return NextResponse.json({ ok: true, message: "Mock 모드 — AI API 없이 테스트 콘텐츠를 생성합니다." });
  }

  if (!config.apiKey) {
    return NextResponse.json({ ok: false, message: "API 키가 설정되지 않았습니다." }, { status: 400 });
  }

  try {
    if (config.provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model || "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? `HTTP ${res.status}`);
      }
      return NextResponse.json({ ok: true, message: "Claude API 연결 성공!" });
    }

    if (config.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${config.apiKey}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? `HTTP ${res.status}`);
      }
      return NextResponse.json({ ok: true, message: "OpenAI API 연결 성공!" });
    }

    return NextResponse.json({ ok: false, message: "알 수 없는 provider" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
