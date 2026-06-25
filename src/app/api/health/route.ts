import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const isVercel = process.env.VERCEL === "1";
  if (!isVercel) return NextResponse.json({ ok: true, env: "local" });

  const hasEnvToken = !!process.env.GITHUB_TOKEN;
  const hasCookieToken = !!req.cookies.get("gh_token")?.value;
  const ok = hasEnvToken || hasCookieToken;
  return NextResponse.json({ ok, env: "vercel" });
}
