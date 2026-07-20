import { NextRequest, NextResponse } from "next/server";
import { loadAIConfig, saveAIConfig } from "@/lib/aiConfig";
import { guard } from "@/lib/authGate";

/** GET — 토큰 설정 여부 확인 */
export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const cookieToken = req.cookies.get("gh_token")?.value;
  const envToken = process.env.GITHUB_TOKEN;
  const hasToken = !!(cookieToken || envToken);
  const source = envToken ? "env" : cookieToken ? "cookie" : null;
  return NextResponse.json({ ok: hasToken, source });
}

/** POST — GitHub 토큰 쿠키에 저장 */
export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const { token } = await req.json();
  if (!token?.trim()) {
    return NextResponse.json({ error: "토큰을 입력해주세요." }, { status: 400 });
  }

  // 유효한 토큰인지 GitHub API로 확인
  const testRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token.trim()}`, "User-Agent": "cs-ai-web" },
  });
  if (!testRes.ok) {
    return NextResponse.json({ error: "유효하지 않은 GitHub 토큰입니다. repo 권한이 있는지 확인해주세요." }, { status: 400 });
  }

  const trimmedToken = token.trim();
  const response = NextResponse.json({ ok: true });
  response.cookies.set("gh_token", trimmedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    path: "/",
  });

  // 현재 쿠키에 저장된 AI API 키를 GitHub로 동기화
  // 팀원이 GH 토큰만 입력해도 관리자가 설정한 AI 키를 공유받을 수 있도록
  try {
    const current = await loadAIConfig(trimmedToken);
    const updated = {
      ...current,
      providers: {
        claude: { ...current.providers.claude },
        openai: { ...current.providers.openai },
        gemini: { ...current.providers.gemini },
      },
    };
    let changed = false;
    for (const p of ["claude", "openai", "gemini"] as const) {
      const cookieKey = req.cookies.get(`${p}_api_key`)?.value?.trim();
      const cookieModel = req.cookies.get(`${p}_model`)?.value?.trim();
      if (cookieKey) {
        updated.providers[p].apiKey = cookieKey;
        if (cookieModel) updated.providers[p].model = cookieModel;
        changed = true;
      }
    }
    const cookieActive = req.cookies.get("ai_active_provider")?.value;
    if (cookieActive && cookieActive !== "mock" && updated.activeProvider === "mock") {
      updated.activeProvider = cookieActive as typeof updated.activeProvider;
      changed = true;
    }
    if (changed) {
      await saveAIConfig(updated, trimmedToken);
    }
  } catch { /* 동기화 실패는 무시 */ }

  return response;
}

/** DELETE — 저장된 토큰 삭제 */
export async function DELETE() {
  const denied = await guard();
  if (denied) return denied;
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("gh_token");
  return response;
}
