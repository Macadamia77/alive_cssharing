// 이메일 발송 없이 매직링크 URL을 직접 생성한다(내장 이메일 일일한도 우회).
// 사용: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/gen-magic-link.mjs <email> [redirectTo]
// service_role 키는 서버 전용 관리자 키다 — 절대 커밋/공유 금지.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const redirectTo =
  process.argv[3] || "https://alive-cs-sharing-number-one-workflo.vercel.app/auth/callback";

if (!url || !key || !email) {
  console.error("필요: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env + <email> 인자");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await sb.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo },
});

if (error) {
  console.error("에러:", error.message);
  process.exit(1);
}

// 콜백이 직접 소화하는 token_hash 링크를 만든다(GoTrue redirect·redirect 허용목록 우회).
// redirectTo 는 "<도메인>/auth/callback" 형태 → 여기에 쿼리만 붙인다.
const loginUrl = `${redirectTo}?token_hash=${data.properties.hashed_token}&type=magiclink`;

console.log("\n아래 링크를 브라우저에 붙여넣어 로그인:\n");
console.log(loginUrl);
console.log("");
