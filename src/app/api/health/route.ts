import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  // GitHub은 이제 선택적 읽기 폴백일 뿐이다(채널파일 저장은 Supabase). 따라서 health의 ok를
  // github 토큰 유무에 묶지 않고 실제 라이브니스만 반영한다. 폴백 토큰이 필요하면 GITHUB_TOKEN
  // env로 설정한다(UI 입력·gh_token 쿠키 경로는 제거됨).
  const isVercel = process.env.VERCEL === "1";
  return NextResponse.json({ ok: true, env: isVercel ? "vercel" : "local" });
}
