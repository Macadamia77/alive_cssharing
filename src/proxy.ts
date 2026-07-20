// 브라우저↔Vercel API 인증의 1차 경계 게이트.
// Next 16에서 middleware가 proxy로 개명됨(파일명 proxy.ts, 함수명 proxy, 기본 Node.js 런타임).
//
// AUTH_ENABLED가 "true"가 아니면 즉시 통과 → 인계 전(플래그 OFF)엔 무영향(팀원·프리뷰 무영향).
// 세션이 없으면: /api/*는 401 JSON, 그 외 페이지는 /login으로 리다이렉트.
// 세션이 있으면 @supabase/ssr로 세션 쿠키를 갱신(getClaims)해 응답에 실어 보낸다.
//
// 주의(proxy.md 경고): proxy 단독에 의존하지 말 것 — 민감 라우트는 authGate.guard()로도 검증한다.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const config = {
  // 정적 자산·로그인·콜백·헬스체크는 검문에서 제외한다.
  //  - _next/static, _next/image, favicon: 제외 안 하면 CSS/JS/이미지가 막혀 화면이 깨진다.
  //  - login, auth/callback: 제외 안 하면 로그인 페이지 자체가 막혀 무한 리다이렉트가 난다.
  //  - api/health: 헬스체크는 인증 없이 응답해야 한다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|auth/callback|api/health).*)"],
};

export async function proxy(request: NextRequest) {
  if (process.env.AUTH_ENABLED !== "true") return NextResponse.next();

  const response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getSession()은 인가용으로 신뢰 금지(Supabase 권고). getClaims()는 JWT 서명을 로컬 검증한다.
  const { data } = await supabase.auth.getClaims();
  const authed = !!data?.claims;

  if (!authed) {
    if (request.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}
