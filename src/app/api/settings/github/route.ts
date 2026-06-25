import { NextRequest, NextResponse } from "next/server";

/** GET — 토큰 설정 여부 확인 */
export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get("gh_token")?.value;
  const envToken = process.env.GITHUB_TOKEN;
  const hasToken = !!(cookieToken || envToken);
  const source = envToken ? "env" : cookieToken ? "cookie" : null;
  return NextResponse.json({ ok: hasToken, source });
}

/** POST — GitHub 토큰 쿠키에 저장 */
export async function POST(req: NextRequest) {
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

  const response = NextResponse.json({ ok: true });
  response.cookies.set("gh_token", token.trim(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    path: "/",
  });
  return response;
}

/** DELETE — 저장된 토큰 삭제 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("gh_token");
  return response;
}
