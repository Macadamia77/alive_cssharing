// 서버(라우트 핸들러·서버 컴포넌트)용 Supabase 클라이언트.
// @supabase/ssr가 쿠키 기반 세션을 안전하게 읽고 쓰도록 getAll/setAll 핸들러를 넘긴다.
// next/headers의 cookies()는 Next 16에서 async이므로 await 한다.
//
// 인증 전용 클라이언트다 — 기존 src/lib/supabaseClient.ts(service_role, 데이터 접근용)와
// 별개다. 여기선 공개 키(publishable/anon)만 쓰고, 브라우저 세션 쿠키를 다룬다.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // 서버 컴포넌트에서 호출되면 set이 던질 수 있다(응답이 없는 렌더 컨텍스트).
        // 세션 갱신은 proxy가 담당하므로 그 경우 조용히 무시해도 안전하다.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          /* Server Component 렌더 컨텍스트 — 무시 */
        }
      },
    },
  });
}
