// 리포/Export JSON의 채널 파일을 Supabase channel_files 테이블로 업로드(upsert)한다.
// pull-supabase-files.mjs의 역방향 — "Supabase가 정본"인 환경(예: 프로덕션 웹앱)에 파일을 올린다.
//
// ⚠️ 프로덕션 DB를 직접 바꾸는 도구다. 기본은 dry(미리보기)이고, 실제 기록은 --write를 줘야 한다.
// ⚠️ 올리면 앱이 Supabase-first로 읽으므로 그 채널은 이제 Supabase가 정본이 된다(리포/GitHub는
//     더 이상 안 읽힘 → 이후 리포 커밋이 그 채널엔 반영 안 됨. divergent 주의).
//
// 자격증명: render-worker/.env의 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY를 읽는다(process.env 우선).
//
// 사용법:
//   node scripts/push-supabase-files.mjs channel_files_rows.json --channel=linkedin          # dry(미리보기)
//   node scripts/push-supabase-files.mjs channel_files_rows.json --channel=linkedin --write   # 실제 upsert
//   (--channel 생략 시 JSON의 모든 채널. --write 없으면 절대 쓰지 않음.)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith("--")) ?? "channel_files_rows.json";
const write = args.includes("--write");
const channelFilter = (args.find(a => a.startsWith("--channel=")) ?? "").split("=")[1] || null;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// render-worker/.env에서 자격증명 로드(process.env가 있으면 그걸 우선).
function loadCreds() {
  let txt = "";
  try { txt = readFileSync(join(ROOT, "render-worker", ".env"), "utf-8"); } catch { /* 없으면 process.env만 */ }
  const get = (k) => (txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  return {
    url: process.env.SUPABASE_URL || get("SUPABASE_URL"),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || get("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
const allRows = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : null;
if (!allRows) { console.error(`[push] ${jsonPath}에서 행 배열을 찾지 못했습니다.`); process.exit(1); }

const rows = allRows.filter(r => r.channel && r.path && (!channelFilter || r.channel === channelFilter));
const { url, key } = loadCreds();
if (!url || !key) { console.error("[push] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 찾지 못했습니다(render-worker/.env 또는 환경변수)."); process.exit(1); }

const host = url.replace(/^https?:\/\//, "").split(".")[0];
console.log(`[push] 대상 Supabase: ${host}  |  대상 채널: ${channelFilter ?? "(전체)"}  |  ${write ? "★ 실제 기록(--write)" : "dry(미리보기 — 쓰지 않음)"}`);
console.log(`[push] 업로드 대상 ${rows.length}개:`);
for (const r of rows) console.log(`  ${r.channel}/${r.path}${r.is_binary ? " [bin]" : ""}`);

if (!write) { console.log("\n→ 미리보기입니다. 실제로 올리려면 끝에 --write 를 붙이세요."); process.exit(0); }

const supabase = createClient(url, key, { auth: { persistSession: false } });
let ok = 0, fail = 0;
for (const r of rows) {
  const isBinary = r.is_binary === true || r.is_binary === "true" || r.is_binary === "TRUE";
  const { error } = await supabase.from("channel_files").upsert(
    { channel: r.channel, path: r.path, content: String(r.content ?? ""), is_binary: isBinary, updated_at: new Date().toISOString() },
    { onConflict: "channel,path" }
  );
  if (error) { console.error(`✗ ${r.channel}/${r.path}: ${error.message}`); fail++; }
  else { console.log(`✓ ${r.channel}/${r.path}`); ok++; }
}
console.log(`\n완료 — 성공 ${ok} / 실패 ${fail}`);
