// Supabase channel_files 테이블(프리뷰 편집본)을 리포의 실제 파일로 내려받는 분해기.
//
// 왜: 프리뷰 Supabase의 채널 파일(가이드·페르소나·_meta·composition 등)은 웹에서 라이브 편집돼
//     리포보다 앞서 있다. 이걸 실제 .md/.json 파일로 data/ 아래에 써서 "원본 웹앱(리포/프로덕션)"이
//     쓰는 정본으로 삼는다. Supabase 기본 Export는 테이블을 한 덩어리로만 주므로 경로별로 쪼갠다.
//
// 사용법(자격증명 불필요):
//   1) Supabase → channel_files 테이블 → Export ▾ → "Export as JSON" → 파일 저장(예: channel_files.json)
//   2) node scripts/pull-supabase-files.mjs <그_json_경로>
//        옵션: --dry            (쓰지 않고 어디에 쓸지 목록만)
//              --channel=linkedin (그 채널만)
//              --md-only          (.md 파일만 — 가이드/페르소나만 원할 때)
//   3) git diff로 바뀐 파일 검토 후 커밋.
//
// 경로 매핑(src/lib/channelFiles.ts 읽기 로직과 동일):
//   _shared + *.md  → data/agents/<path>
//   _shared + 그 외 → data/<path>            (예: models.json)
//   <채널>          → data/channels/<채널>/<path>

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith("--")) ?? "channel_files.json";
const dry = args.includes("--dry");
const mdOnly = args.includes("--md-only");
const channelFilter = (args.find(a => a.startsWith("--channel=")) ?? "").split("=")[1] || null;

// 리포 루트(스크립트가 scripts/ 아래 있으므로 한 단계 위)
const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

function targetPath(channel, p) {
  if (channel === "_shared") {
    return p.toLowerCase().endsWith(".md") ? join(ROOT, "data", "agents", p) : join(ROOT, "data", p);
  }
  return join(ROOT, "data", "channels", channel, p);
}

// Supabase "Export as JSON"은 행 객체 배열. 혹시 {data:[...]}로 감싸져 오면 풀어준다.
const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : null;
if (!rows) { console.error(`[pull] ${jsonPath}에서 행 배열을 찾지 못했습니다.`); process.exit(1); }

let written = 0, skipped = 0;
const byChannel = {};
for (const r of rows) {
  const channel = r.channel;
  const p = r.path;
  if (!channel || !p) { skipped++; continue; }
  if (channelFilter && channel !== channelFilter) { skipped++; continue; }
  const isBinary = r.is_binary === true || r.is_binary === "true" || r.is_binary === "TRUE";
  if (mdOnly && !p.toLowerCase().endsWith(".md")) { skipped++; continue; }

  const dest = targetPath(channel, p);
  const rel = dest.slice(ROOT.length + 1).replace(/\\/g, "/");
  byChannel[channel] = (byChannel[channel] || 0) + 1;

  if (dry) { console.log(`${isBinary ? "[bin]" : "[txt]"} ${channel}/${p}  →  ${rel}`); written++; continue; }

  mkdirSync(dirname(dest), { recursive: true });
  if (isBinary) {
    writeFileSync(dest, Buffer.from(String(r.content ?? ""), "base64")); // base64 → 원본 바이너리
  } else {
    writeFileSync(dest, String(r.content ?? ""), "utf-8"); // .md/.json 텍스트 원문
  }
  console.log(`✓ ${rel}`);
  written++;
}

console.log(`\n${dry ? "[DRY] " : ""}처리 ${written}개 / 건너뜀 ${skipped}개`);
console.log("채널별:", Object.entries(byChannel).map(([c, n]) => `${c}=${n}`).join(", "));
if (!dry) console.log("→ git diff로 검토 후 커밋하세요(프리뷰 편집본이 리포 파일을 덮어씁니다).");
