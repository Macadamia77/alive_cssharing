// 브라우저(클라이언트 컴포넌트, 예: 로그인 페이지)용 Supabase 클라이언트.
// 공개 키(publishable/anon)만 사용 — 이 키는 브라우저 노출이 설계상 안전하다.
import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ""
  );
}
