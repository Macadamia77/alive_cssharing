// 로컬 data/channels/** 파일들을 Supabase channel_files 테이블로 업로드 (1회용).
//
// 실행 (레포 루트에서):
//   node scripts/migrate-channels-to-supabase.mjs
//
// 환경변수 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 필요.
//   - render-worker/.env 또는 .env.local 에 있으면 자동으로 읽음.
//   - 없으면 직접 지정: (PowerShell) $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/...
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { join, relative, sep } from "path";

// ── env 로드: render-worker/.env, .env.local 에서 SUPABASE_* 자동 추출 ──
function loadEnvFrom(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFrom(join(process.cwd(), "render-worker", ".env"));
loadEnvFrom(join(process.cwd(), ".env.local"));

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  console.error("   (render-worker/.env 에 있거나, 실행 시 직접 지정하세요)");
  process.exit(1);
}
if (URL.includes("placeholder") || KEY.includes("placeholder")) {
  console.error("❌ placeholder 값입니다. 실제 Supabase URL/service_role key가 필요합니다.");
  process.exit(1);
}

const sb = createClient(URL, KEY);

const TEXT_EXT = new Set(["md", "txt", "json", "csv", "html", "xml", "js", "ts", "css"]);
const isText = (name) => TEXT_EXT.has((name.split(".").pop() || "").toLowerCase());

const CHANNELS_DIR = join(process.cwd(), "data", "channels");
if (!existsSync(CHANNELS_DIR)) {
  console.error(`❌ ${CHANNELS_DIR} 없음. 레포 루트에서 실행하세요.`);
  process.exit(1);
}

async function walk(dir, channelRoot, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, channelRoot, out);
      continue;
    }
    const relPath = relative(channelRoot, full).split(sep).join("/");
    if (isText(e.name)) {
      out.push({ path: relPath, content: await readFile(full, "utf-8"), is_binary: false });
    } else {
      const buf = await readFile(full);
      out.push({ path: relPath, content: buf.toString("base64"), is_binary: true });
    }
  }
}

const channelDirs = (await readdir(CHANNELS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
let total = 0;
for (const ch of channelDirs) {
  const channel = ch.name;
  const channelRoot = join(CHANNELS_DIR, channel);
  const files = [];
  await walk(channelRoot, channelRoot, files);
  if (files.length === 0) continue;

  const rows = files.map((f) => ({
    channel,
    path: f.path,
    content: f.content,
    is_binary: f.is_binary,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await sb.from("channel_files").upsert(rows, { onConflict: "channel,path" });
  if (error) {
    console.error(`❌ ${channel} 업로드 실패: ${error.message}`);
    process.exit(1);
  }
  total += rows.length;
  console.log(`✅ ${channel}: ${rows.length}개 업로드`);
}
console.log(`\n🎉 완료 — 총 ${total}개 파일을 channel_files에 업로드했습니다.`);
