import { NextRequest, NextResponse } from "next/server";
import { resolveGithubToken } from "@/lib/resolveToken";
import { loadAIConfig, saveAIConfig, type AIConfig, type ProviderKey } from "@/lib/aiConfig";

export type { AIConfig };

function maskKey(key: string): string {
  if (!key) return "";
  return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

/** GET — 현재 설정 반환 (API 키는 마스킹) */
export async function GET() {
  const config = await loadAIConfig();
  return NextResponse.json({
    activeProvider: config.activeProvider,
    providers: {
      claude: {
        apiKeySet: !!config.providers.claude.apiKey,
        apiKeyMasked: maskKey(config.providers.claude.apiKey),
        model: config.providers.claude.model,
      },
      openai: {
        apiKeySet: !!config.providers.openai.apiKey,
        apiKeyMasked: maskKey(config.providers.openai.apiKey),
        model: config.providers.openai.model,
      },
      gemini: {
        apiKeySet: !!config.providers.gemini.apiKey,
        apiKeyMasked: maskKey(config.providers.gemini.apiKey),
        model: config.providers.gemini.model,
      },
    },
  });
}

/** PUT — 설정 저장
 *  body: { provider: "claude"|"openai"|"gemini", apiKey?: string, model?: string, activeProvider?: string }
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      provider?: string;
      apiKey?: string;
      model?: string;
      activeProvider?: string;
    };
    const current = await loadAIConfig();
    const token = resolveGithubToken(req);

    const updated: AIConfig = {
      activeProvider: (body.activeProvider ?? current.activeProvider) as AIConfig["activeProvider"],
      providers: {
        claude: { ...current.providers.claude },
        openai: { ...current.providers.openai },
        gemini: { ...current.providers.gemini },
      },
    };

    const p = body.provider as ProviderKey | undefined;
    if (p && p in updated.providers) {
      if (body.apiKey !== undefined && body.apiKey !== "") {
        updated.providers[p].apiKey = body.apiKey;
      }
      if (body.model !== undefined && body.model !== "") {
        updated.providers[p].model = body.model;
      }
    }

    await saveAIConfig(updated, token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST — API 연결 테스트
 *  body: { provider: "claude" | "openai" | "gemini" }
 */
export async function POST(req: NextRequest) {
  const config = await loadAIConfig();
  const body = await req.json().catch(() => ({})) as { provider?: string };
  const provider = (body.provider ?? config.activeProvider) as AIConfig["activeProvider"];

  if (provider === "mock") {
    return NextResponse.json({ ok: true, message: "Mock 모드 — AI API 없이 테스트 콘텐츠를 생성합니다." });
  }

  const pc = config.providers[provider as ProviderKey];
  if (!pc?.apiKey) {
    return NextResponse.json({ ok: false, message: `${provider} API 키가 설정되지 않았습니다.` }, { status: 400 });
  }

  try {
    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": pc.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: pc.model || "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? `HTTP ${res.status}`); }
      return NextResponse.json({ ok: true, message: "Claude API 연결 성공!" });
    }

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${pc.apiKey}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? `HTTP ${res.status}`); }
      return NextResponse.json({ ok: true, message: "OpenAI API 연결 성공!" });
    }

    if (provider === "gemini") {
      const model = pc.model || "gemini-2.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pc.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        }
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? `HTTP ${res.status}`); }
      return NextResponse.json({ ok: true, message: "Gemini API 연결 성공!" });
    }

    return NextResponse.json({ ok: false, message: "알 수 없는 provider" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
