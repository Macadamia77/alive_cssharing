// 한 채널의 로컬 data/channels/<채널>/** 를 Supabase channel_files와 동기화한다.
// - 로컬 텍스트/바이너리 파일을 모두 업서트
// - 로컬에 없는데 Supabase에만 있는 파일은 삭제 (예: 쪼개져 사라진 guide.md)
//
// 실행: node scripts/sync-channel.mjs <채널>            # 미리보기(dry-run)
//       node scripts/sync-channel.mjs <채널> --apply     # 실제 반영
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { join, relative, sep } from "path";

function loadEnvFrom(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFrom(join(process.cwd(), "render-worker", ".env"));
loadEnvFrom(join(process.cwd(), ".env.local"));

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY || URL.includes("placeholder") || KEY.includes("placeholder")) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (실제 값) 필요.");
  process.exit(1);
}

const channel = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!channel || channel.startsWith("--")) {
  console.error("❌ 사용법: node scripts/sync-channel.mjs <채널> [--apply]");
  process.exit(1);
}

const sb = createClient(URL, KEY);
const TEXT_EXT = new Set(["md", "txt", "json", "csv", "html", "xml", "js", "ts", "css"]);
const isText = (name) => TEXT_EXT.has((name.split(".").pop() || "").toLowerCase());

const root = join(process.cwd(), "data", "channels", channel);
if (!existsSync(root)) { console.error(`❌ ${root} 없음`); process.exit(1); }

async function walk(dir, out) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { await walk(full, out); continue; }
    const relPath = relative(root, full).split(sep).join("/");
    if (isText(e.name)) out.push({ path: relPath, content: await readFile(full, "utf-8"), is_binary: false });
    else out.push({ path: relPath, content: (await readFile(full)).toString("base64"), is_binary: true });
  }
}

async function main() {
  const local = [];
  await walk(root, local);
  const localPaths = new Set(local.map(f => f.path));

  const { data: remoteRows, error: listErr } = await sb
    .from("channel_files").select("path").eq("channel", channel);
  if (listErr) { console.error("❌ 조회 실패:", listErr.message); process.exit(1); }
  const remotePaths = (remoteRows ?? []).map(r => r.path);
  const toDelete = remotePaths.filter(p => !localPaths.has(p));

  console.log(`[${channel}] 로컬 ${local.length}개, Supabase ${remotePaths.length}개`);
  console.log(`업서트 대상: ${local.map(f => f.path).join(", ")}`);
  console.log(`삭제 대상(로컬에 없음): ${toDelete.length ? toDelete.join(", ") : "(없음)"}`);

  if (!APPLY) { console.log(`\n💡 dry-run. 반영: node scripts/sync-channel.mjs ${channel} --apply`); return; }

  const rows = local.map(f => ({ channel, path: f.path, content: f.content, is_binary: f.is_binary, updated_at: new Date().toISOString() }));
  const { error: upErr } = await sb.from("channel_files").upsert(rows, { onConflict: "channel,path" });
  if (upErr) { console.error("❌ 업서트 실패:", upErr.message); process.exit(1); }
  for (const p of toDelete) {
    const { error: delErr } = await sb.from("channel_files").delete().eq("channel", channel).eq("path", p);
    if (delErr) console.error(`⚠️ 삭제 실패 ${p}: ${delErr.message}`);
  }
  console.log(`\n✅ [${channel}] 동기화 완료 (업서트 ${rows.length}, 삭제 ${toDelete.length})`);
}
main();
