// 매직링크 클릭 후 도착점. 세션으로 교환하고(쿠키 설정) 앱으로 돌려보낸다.
// 이 경로는 proxy matcher에서 제외돼 있어 인증 없이 접근 가능해야 한다(로그인 완료 지점).
//
// 두 가지 링크 방식을 모두 처리한다(순수 추가 — 기존 ?code 경로는 그대로):
//  1) ?code=...            : 브라우저에서 signInWithOtp로 요청한 PKCE 링크. code_verifier 쿠키로 교환.
//  2) ?token_hash=...&type : admin.generateLink(서버 발급)로 만든 토큰 링크. 브라우저 선요청 없이 검증.
//     (이메일 발송·rate limit·redirect 폴백과 무관하게 로그인 가능 — 테스트/관리자 발급용)
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createServerSupabase();

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && type) {
    await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  }

  return NextResponse.redirect(new URL(next, request.url));
}
