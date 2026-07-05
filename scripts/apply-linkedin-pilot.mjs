// linkedin 파이프라인 엔진 파일럿을 Supabase에 반영 (안전 · 타겟 업서트).
//
// 전체 마이그레이션(migrate-channels-to-supabase.mjs)은 웹 실시간 편집을 덮어쓸 위험이 있어
// 이 스크립트는 linkedin의 (1) 새 에이전트 파일 (2) _meta.json 만 건드린다.
// _meta.json은 Supabase 현재 값을 읽어 engine/outputFormat 필드만 병합해 되돌려쓴다(기존 편집 보존).
//
// 실행 (레포 루트에서):
//   node scripts/apply-linkedin-pilot.mjs           # 미리보기(dry-run)
//   node scripts/apply-linkedin-pilot.mjs --apply    # 실제 반영
import { createClient } from "@supabase/supabase-js";
import { readFile, readFileSync, existsSync } from "fs";
import { readFile as readFileP } from "fs/promises";
import { join } from "path";

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
const APPLY = process.argv.includes("--apply");
const sb = createClient(URL, KEY);
const CHANNEL = "linkedin";

// 업로드할 새 파일(신규 경로 — 충돌 없음)
const NEW_FILES = ["agents/writer.md", "agents/reviewer.md"];

async function main() {
  // ── 1. _meta.json: Supabase 현재값 읽어 병합 ──
  const { data: metaRow, error: mErr } = await sb
    .from("channel_files").select("content")
    .eq("channel", CHANNEL).eq("path", "_meta.json").maybeSingle();
  if (mErr) { console.error("❌ _meta 읽기 실패:", mErr.message); process.exit(1); }

  let meta = {};
  if (metaRow?.content) {
    try { meta = JSON.parse(metaRow.content.replace(/^﻿/, "")); }
    catch (e) { console.error("❌ Supabase _meta.json 파싱 실패:", e.message); process.exit(1); }
  } else {
    console.warn("⚠️  Supabase에 linkedin/_meta.json 없음 → 로컬 값으로 생성");
    meta = JSON.parse(await readFileP(join(process.cwd(), "data/channels/linkedin/_meta.json"), "utf-8"));
  }
  console.log("현재 Supabase _meta.json:\n", JSON.stringify(meta, null, 2));

  const before = JSON.stringify(meta);
  meta.engine = "pipeline";
  if (!meta.outputFormat) meta.outputFormat = "text";
  const changed = JSON.stringify(meta) !== before;
  console.log(`\n병합 후 _meta.json (변경: ${changed}):\n`, JSON.stringify(meta, null, 2));

  // ── 2. 새 에이전트 파일 로드 ──
  const rows = [];
  for (const p of NEW_FILES) {
    const content = await readFileP(join(process.cwd(), "data/channels", CHANNEL, p), "utf-8");
    rows.push({ channel: CHANNEL, path: p, content, is_binary: false, updated_at: new Date().toISOString() });
    console.log(`\n[새 파일] ${p} (${content.length}자)`);
  }
  rows.push({ channel: CHANNEL, path: "_meta.json", content: JSON.stringify(meta, null, 2), is_binary: false, updated_at: new Date().toISOString() });

  if (!APPLY) {
    console.log(`\n💡 미리보기(dry-run). 실제 반영하려면: node scripts/apply-linkedin-pilot.mjs --apply`);
    console.log(`   반영 대상: ${rows.map(r => r.path).join(", ")}`);
    return;
  }

  const { error } = await sb.from("channel_files").upsert(rows, { onConflict: "channel,path" });
  if (error) { console.error("❌ 업서트 실패:", error.message); process.exit(1); }
  console.log(`\n✅ 반영 완료 — linkedin: ${rows.map(r => r.path).join(", ")}`);
}
main();
