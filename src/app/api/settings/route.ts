import { NextRequest, NextResponse } from "next/server";
import { resolveGithubToken } from "@/lib/resolveToken";
import { loadAIConfig, saveAIConfig, type AIConfig, type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider, resolveResearchProvider, DEFAULT_MODELS, COOKIE_OPTS } from "@/lib/resolveProvider";
import { supabase } from "@/lib/supabaseClient";

export type { AIConfig };

const PROVIDERS: ProviderKey[] = ["claude", "openai", "gemini"];

function maskKey(key: string): string {
  if (!key || key.length < 4) return "";
  return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

/** GET — 현재 설정 반환 (쿠키/환경변수 우선, GitHub 폴백) */
export async function GET(req: NextRequest) {
  // GH 토큰을 사용해 프라이빗 레포에서도 설정 읽기
  const ghToken = resolveGithubToken(req);
  const ghConfig = await loadAIConfig(ghToken).catch(() => null);

  const getInfo = (p: ProviderKey) => {
    // 1순위: 쿠키 / 환경변수
    const pc = resolveProvider(req, p);
    if (pc) return { apiKeySet: true, apiKeyMasked: maskKey(pc.apiKey), model: pc.model };
    // 2순위: GitHub 설정 파일 폴백
    const ghPc = ghConfig?.providers[p];
    if (ghPc?.apiKey) return { apiKeySet: true, apiKeyMasked: maskKey(ghPc.apiKey), model: ghPc.model };
    return { apiKeySet: false, apiKeyMasked: "", model: DEFAULT_MODELS[p] };
  };

  const activeProvider = (() => {
    const cookie = resolveActiveProvider(req);
    if (cookie !== "mock") {
      const pc = resolveProvider(req, cookie as ProviderKey);
      if (pc) return cookie;
    }
    // 쿠키에 없으면 키가 설정된 첫 번째 provider (쿠키 → GitHub 순)
    const first = PROVIDERS.find(p => !!resolveProvider(req, p) || !!ghConfig?.providers[p]?.apiKey);
    // GitHub에서 activeProvider가 설정되어 있으면 우선 사용
    const ghActive = ghConfig?.activeProvider;
    if (ghActive && ghActive !== "mock" && PROVIDERS.includes(ghActive as ProviderKey)) {
      const ghPc = ghConfig?.providers[ghActive as ProviderKey];
      if (ghPc?.apiKey) return ghActive;
    }
    return first ?? "mock";
  })();

  // 리서치 전용 provider: 쿠키(1순위) → Supabase app_settings(내구성 백업, 쿠키 삭제 시 폴백) → "active" 기본값.
  const researchProvider = await (async () => {
    const cookieVal = resolveResearchProvider(req);
    if (cookieVal) return cookieVal;
    try {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "research_provider").maybeSingle();
      if (data?.value) return data.value;
    } catch { /* 테이블 미생성 등 — 기본값으로 폴백 */ }
    return "active";
  })();

  return NextResponse.json({
    activeProvider,
    researchProvider,
    providers: Object.fromEntries(PROVIDERS.map(p => [p, getInfo(p)])),
  });
}

/** PUT — 설정 저장 (쿠키에 직접 저장, GitHub는 선택적 백업) */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      provider?: string;
      apiKey?: string;
      model?: string;
      activeProvider?: string;
      researchProvider?: string;
    };

    const p = body.provider as ProviderKey | undefined;
    const response = NextResponse.json({ ok: true });

    if (body.researchProvider) {
      response.cookies.set("ai_research_provider", body.researchProvider, COOKIE_OPTS);
      // Supabase에도 백업 저장(best-effort) — 쿠키가 사라져도 다음 GET이 이 값을 폴백으로 씀.
      try {
        await supabase.from("app_settings").upsert({ key: "research_provider", value: body.researchProvider, updated_at: new Date().toISOString() });
      } catch { /* app_settings 미생성 등 — 저장 실패해도 쿠키는 이미 저장됐으니 무시 */ }
    }

    // ── 쿠키에 저장 (주 저장소) ──────────────────────────
    if (p && PROVIDERS.includes(p)) {
      if (body.apiKey?.trim()) {
        response.cookies.set(`${p}_api_key`, body.apiKey.trim(), COOKIE_OPTS);
        // 처음 저장되는 키면 activeProvider 자동 설정
        const currentActive = resolveActiveProvider(req);
        if (currentActive === "mock") {
          response.cookies.set("ai_active_provider", p, COOKIE_OPTS);
        }
      }
      if (body.model?.trim()) {
        response.cookies.set(`${p}_model`, body.model.trim(), COOKIE_OPTS);
      }
    }
    if (body.activeProvider) {
      response.cookies.set("ai_active_provider", body.activeProvider, COOKIE_OPTS);
    }

    // ── GitHub 백업 (실패해도 무시) ──────────────────────
    try {
      const token = resolveGithubToken(req);
      if (token && p) {
        const current = await loadAIConfig(token);
        const updated: AIConfig = {
          activeProvider: (body.activeProvider ?? current.activeProvider) as AIConfig["activeProvider"],
          providers: {
            claude: { ...current.providers.claude },
            openai: { ...current.providers.openai },
            gemini: { ...current.providers.gemini },
          },
        };
        if (body.apiKey?.trim()) updated.providers[p].apiKey = body.apiKey.trim();
        if (body.model?.trim()) updated.providers[p].model = body.model.trim();
        if (updated.providers[p].apiKey && updated.activeProvider === "mock") {
          updated.activeProvider = p;
        }
        await saveAIConfig(updated, token);
      }
    } catch { /* GitHub 백업 실패는 무시 */ }

    return response;
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE — API 키 삭제 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { provider?: string };
    const p = body.provider as ProviderKey | undefined;

    const response = NextResponse.json({ ok: true });

    if (p && PROVIDERS.includes(p)) {
      // 쿠키 만료로 삭제
      const expired = { ...COOKIE_OPTS, maxAge: 0 };
      response.cookies.set(`${p}_api_key`, "", expired);
      response.cookies.set(`${p}_model`, "", expired);

      // 이 provider가 activeProvider였으면 mock으로 초기화
      const currentActive = resolveActiveProvider(req);
      if (currentActive === p) {
        // 다른 provider에 키가 있으면 그걸로, 없으면 mock
        const next = PROVIDERS.find(other => other !== p && !!resolveProvider(req, other));
        response.cookies.set("ai_active_provider", next ?? "mock", COOKIE_OPTS);
      }
    }

    // GitHub 백업도 지우기 (best-effort)
    try {
      const token = resolveGithubToken(req);
      if (token && p) {
        const current = await loadAIConfig(token);
        const updated: AIConfig = {
          activeProvider: current.activeProvider === p ? "mock" : current.activeProvider,
          providers: {
            claude: { ...current.providers.claude },
            openai: { ...current.providers.openai },
            gemini: { ...current.providers.gemini },
          },
        };
        updated.providers[p].apiKey = "";
        await saveAIConfig(updated, token);
      }
    } catch { /* ignore */ }

    return response;
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST — API 연결 테스트 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { provider?: string; apiKey?: string };
  const provider = (body.provider ?? "mock") as string;

  if (provider === "mock") {
    return NextResponse.json({ ok: true, message: "Mock 모드 — AI API 없이 테스트 콘텐츠를 생성합니다." });
  }

  // apiKey 우선순위: body(입력 중) > 쿠키/env
  const apiKey = body.apiKey?.trim() || resolveProvider(req, provider as ProviderKey)?.apiKey;
  const model = resolveProvider(req, provider as ProviderKey)?.model || DEFAULT_MODELS[provider as ProviderKey];

  if (!apiKey) {
    return NextResponse.json({ ok: false, message: `${provider} API 키가 설정되지 않았습니다.` }, { status: 400 });
  }

  try {
    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: model || "claude-sonnet-4-6", max_tokens: 10, messages: [{ role: "user", content: "ping" }] }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? `HTTP ${res.status}`); }
      return NextResponse.json({ ok: true, message: "Claude API 연결 성공!" });
    }

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? `HTTP ${res.status}`); }
      return NextResponse.json({ ok: true, message: "OpenAI API 연결 성공!" });
    }

    if (provider === "gemini") {
      const fullModel = model || "gemini-2.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${fullModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 10 } }),
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
