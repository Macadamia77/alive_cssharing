// 매직링크 클릭 후 도착점. 링크의 code를 세션으로 교환하고(쿠키 설정) 앱으로 돌려보낸다.
// 이 경로는 proxy matcher에서 제외돼 있어 인증 없이 접근 가능해야 한다(로그인 완료 지점).
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
