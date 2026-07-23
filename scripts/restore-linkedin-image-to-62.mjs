// 링크드인 이미지 설정을 "#62(image guide fixed)" 상태로 Supabase에 복원한다.
//   UPSERT: _meta.json, composition.json, guide/image-card-guide.md, guide/05-image-preserve.md
//           (작업트리 = 이미 #62로 되돌려둔 상태에서 읽는다)
//   DELETE: agents/image-maker.md, agents/image-reviewer.md, assets/mascot.png (채널 전용본)
//           → 삭제하면 image-maker/image-reviewer는 공용(_shared/로컬) 폴백을 쓴다(#62와 동일).
// 다른 링크드인 파일(writer·researcher·guide 00~04 등)은 건드리지 않는다.
//
// 사용 (레포 루트): node scripts/restore-linkedin-image-to-62.mjs           # dry-run
//                   node scripts/restore-linkedin-image-to-62.mjs --write    # 실제 반영
// 자격증명: render-worker/.env · .env.local 또는 process.env의 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   ⚠️ 프리뷰용이면 프리뷰 Supabase의 URL·service_role 키를 env로 넣어 실행.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnvFrom(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFrom(join(process.cwd(), "render-worker", ".env"));
loadEnvFrom(join(process.cwd(), ".env.local"));

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요"); process.exit(1); }

const WRITE = process.argv.includes("--write");
const channel = "linkedin";
const base = join(process.cwd(), "data", "channels", channel);

const upserts = [
  "_meta.json",
  "composition.json",
  "guide/image-card-guide.md",
  "guide/05-image-preserve.md",
].map(p => ({ path: p, content: readFileSync(join(base, p), "utf-8"), is_binary: false }));

const deletes = ["agents/image-maker.md", "agents/image-reviewer.md", "assets/mascot.png"];

console.log(`[${channel}] 복원 계획 (다른 파일 무변경):`);
console.log("  UPSERT:");
for (const u of upserts) console.log(`    - ${u.path} (${u.content.length} chars)`);
console.log("  DELETE(채널본 → 공용 폴백):");
for (const d of deletes) console.log(`    - ${d}`);

if (!WRITE) {
  console.log("\n💡 dry-run. 실제 반영: node scripts/restore-linkedin-image-to-62.mjs --write");
  process.exit(0);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const rows = upserts.map(u => ({
  channel, path: u.path, content: u.content, is_binary: u.is_binary, updated_at: new Date().toISOString(),
}));
const { error: upErr } = await sb.from("channel_files").upsert(rows, { onConflict: "channel,path" });
if (upErr) { console.error("❌ upsert 실패:", upErr.message); process.exit(1); }
console.log(`✅ upsert ${rows.length}개 완료`);

for (const p of deletes) {
  const { error: delErr } = await sb.from("channel_files").delete().eq("channel", channel).eq("path", p);
  if (delErr) console.error(`⚠️ 삭제 실패 ${p}: ${delErr.message}`);
  else console.log(`✅ delete: ${p}`);
}
console.log("\n완료. 프리뷰 워커를 Redeploy 해 캐시를 비우세요.");
