// data/channels/naver-blog/agents/assembler-web.md 3~4단계 변환 규칙표를 그대로 코드로 이식.
// LLM에게 draft 전체를 다시 타이핑시키던 방식(출력 길이가 입력에 비례 → max_tokens에서 계속 잘림)을
// 대체하는 결정론적 마크다운→HTML 변환기.
//
// 변환 "로직"은 코드에 두되, "템플릿(HTML 셸)"과 "브랜드 상수(전화·URL·CTA 문구)"는
// data/ 에서 로드한다 (하드코딩 금지 원칙). 파일이 없으면 최소 폴백으로 동작이 끊기지 않게 한다.
import { readFileSync } from "fs";
import { join } from "path";
import { dataRoot } from "./dataRoot";

// ─── 브랜드 상수 (data/brand.json) ───────────────────────────
interface Brand {
  phone: string;
  url: string;
  phoneCtaLabel: string;
  mapLabel: string;
}

const FALLBACK_BRAND: Brand = {
  phone: "1522-5539",
  url: "https://cssharing.co.kr",
  phoneCtaLabel: "📞 1522-5539 무료 상담",
  mapLabel: "📍 CS쉐어링 위치 안내 (발행 시 지도 삽입)",
};

function loadBrand(): Brand {
  try {
    const raw = readFileSync(join(dataRoot(), "data/brand.json"), "utf-8");
    return { ...FALLBACK_BRAND, ...JSON.parse(raw) };
  } catch (e) {
    console.warn(`[htmlAssembler] data/brand.json 로드 실패, 폴백 상수 사용: ${e instanceof Error ? e.message : e}`);
    return FALLBACK_BRAND;
  }
}
const BRAND = loadBrand();

// ─── HTML 문서 셸 ────────────────────────────────────────────
// 셸 템플릿(data/channels/naver-blog/templates/blog-shell.html)은 호출부(agentRunner)가
// channelFiles(Supabase→GitHub→로컬) 경로로 읽어 assembleNaverBlogHtml(draft, shell)로 넘긴다.
// → 웹에서 셸을 수정하면 재배포 없이 실시간 반영된다.
// shell 인자가 없거나 비면 아래 최소 폴백 셸을 사용한다.
const FALLBACK_SHELL =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  "<title>{{TITLE}}</title></head><body>" +
  '<div class="container">{{THUMBNAIL}}<h1>{{TITLE}}</h1>{{BODY}}</div></body></html>';

const EMOJI_START = /^\p{Extended_Pictographic}️?/u;

function applyInline(text: string): string {
  let out = text;
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/'([^'\n]+)'/g, '<em class="highlight">$1</em>');
  out = out.replace(/\{\{hl:([^}]+)\}\}/g, "<mark>$1</mark>");
  out = out.replace(/\{\{center:([^}]+)\}\}/g, '<span style="display:block;text-align:center">$1</span>');
  out = out.replace(/\{\{hand:([^}]+)\}\}/g, '<span class="handwriting">$1</span>');
  return out;
}

function richBlockHtml(trimmed: string): string | null {
  if (trimmed === "[RICH:PHONE]") {
    return `<a href="tel:${BRAND.phone}" style="display:block;background:#1e90d6;color:#fff;text-align:center;padding:14px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0;">${BRAND.phoneCtaLabel}</a>`;
  }
  if (trimmed === "[RICH:MAP]") {
    return `<div style="background:#f5f5f5;border-radius:8px;padding:16px;text-align:center;margin:16px 0;color:#555;">${BRAND.mapLabel}</div>`;
  }
  const linkMatch = trimmed.match(/^\[RICH:LINK:(.+)\]$/);
  if (linkMatch) {
    return `<a href="${BRAND.url}" style="display:block;background:#f0f7ff;border:2px solid #1e90d6;color:#1e90d6;text-align:center;padding:14px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0;">${linkMatch[1]} →</a>`;
  }
  return null;
}

function isHashtagLine(trimmed: string): boolean {
  return /^#\S+(\s+#\S+)*$/.test(trimmed);
}

function hashtagHtml(trimmed: string): string {
  const tags = trimmed.split(/\s+/).map(tag => `<span class="tag">${tag}</span>`);
  return `<p>${tags.join(" ")}</p>`;
}

// 예전엔 "줄 전체가 정확히 이 코멘트여야만" 인식했다 — LLM이 같은 줄에 정체불명의
// `{{THUMBNAIL}}` 같은 토큰을 덧붙여 출력하면(hl/center/hand 마커 패턴을 오인해 지어낸 것으로
// 추정) 정확히 일치하지 않아 플레이스홀더를 못 찾고, 그 결과 (1) 대표 썸네일이 최상단으로
// 끌어올려지지 않고 원래 위치에 그대로 남고 (2) 지어낸 토큰 텍스트가 그대로 본문에 노출되는
// 두 가지 버그가 동시에 발생했다. 줄 안 어디에 있든 코멘트만 추출하고 나머지 텍스트는 버린다 —
// 이런 잡텍스트는 실제 콘텐츠가 아니라 마커 형식 혼동이므로 보존할 필요가 없다.
const CARD_PLACEHOLDER_RE = /<!--\s*HTML_CARD_(\d+)\s*-->/;

function extractCardPlaceholder(trimmed: string): { index: number; full: string } | null {
  const m = trimmed.match(CARD_PLACEHOLDER_RE);
  return m ? { index: parseInt(m[1], 10), full: m[0] } : null;
}

// LLM이 남긴 마크다운 코드펜스 줄(```html, ```, ~~~ 등). 본문에 그대로 노출되면 안 되므로 스킵한다.
function isCodeFence(trimmed: string): boolean {
  return /^(?:```|~~~)[a-zA-Z0-9]*$/.test(trimmed);
}

// 가이드 문구가 "🔍 📊 ⚡ 💬 📞 📦 🚚 🎯 📈 등"으로 예시만 들고 고정 목록이 아님을 명시하므로,
// 특정 이모지 목록을 하드코딩하지 않고 "이모지로 시작하는 짧은 단독 행"을 일반적으로 탐지한다.
// 단, "📩 도입 검토 단계라면...만듭니다." 같은 이모지로 시작하는 완결된 CTA 문장은 소제목이
// 아니다 — 가이드의 모든 소제목 예시는 짧은 명사구/의문형이며 마침표로 끝나는 평서문이 없으므로,
// 평서문 종결(~다./~요./~죠./~네요.)로 끝나는 행은 길이와 무관하게 소제목에서 제외한다.
const DECLARATIVE_ENDING = /(다|요|죠|네요)\.$/;
function isSubheading(trimmed: string): boolean {
  if (!trimmed || trimmed.length > 60) return false;
  if (trimmed.startsWith("✅") || trimmed.startsWith("-") || trimmed.startsWith("📑")) return false;
  if (DECLARATIVE_ENDING.test(trimmed)) return false;
  return EMOJI_START.test(trimmed);
}

// NOTES 블록의 "Step 0" 게이트 결과 확인. "PASS/FAIL" 같은 미기입 템플릿 문구를
// 실패로 오판하지 않도록, 같은 줄에 PASS가 없고 FAIL만 있을 때만 실패로 간주한다.
function isGateFailed(notes: string): boolean {
  const gateLine = notes.split(/\r?\n/).find(l => /step\s*0/i.test(l));
  if (!gateLine) return false;
  const hasFail = /\bFAIL\b/i.test(gateLine);
  const hasPass = /\bPASS\b/i.test(gateLine);
  return hasFail && !hasPass;
}

interface PendingList {
  type: "ul" | "ol";
  items: string[];
}

// 마크다운 표 행(`| a | b |`) 감지 및 셀 분리. 표는 헤더 행 + 구분선(`|---|---|`) + 데이터 행으로 구성된다.
function isTableRow(trimmed: string): boolean {
  return /^\|.*\|$/.test(trimmed);
}

function isTableSeparatorRow(trimmed: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(trimmed);
}

function splitTableCells(trimmed: string): string[] {
  let s = trimmed.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

/**
 * draft.md(PUBLISH/NOTES 블록 포함 원문)를 받아 네이버 블로그용 완성형 독립 HTML을 반환한다.
 * PUBLISH 마커가 없거나, 품질 게이트가 FAIL이거나, 변환 중 문제가 생기면 null을 반환한다
 * (호출부는 null일 때 원문 draftOutput을 그대로 사용하는 기존 폴백 동작을 유지해야 한다).
 */
export function assembleNaverBlogHtml(draftOutput: string, shell?: string): string | null {
  try {
    const publishMatch = draftOutput.match(/<!-- PUBLISH:START -->([\s\S]*?)<!-- PUBLISH:END -->/);
    if (!publishMatch) return null;

    const notesMatch = draftOutput.match(/<!-- NOTES:START -->([\s\S]*?)<!-- NOTES:END -->/);
    if (notesMatch && isGateFailed(notesMatch[1])) return null;

    const lines = publishMatch[1].replace(/^﻿/, "").split(/\r?\n/);

    const titleIdx = lines.findIndex(l => l.trim().length > 0 && !isCodeFence(l.trim()));
    if (titleIdx === -1) return null;
    const title = lines[titleIdx].trim().replace(/^#\s*/, "");

    const htmlParts: string[] = [];
    let pendingList: PendingList | null = null;
    let pendingTable: string[][] | null = null; // 누적 행(첫 행 = 헤더)
    let thumbnailPlaceholder: string | null = null; // HTML_CARD_0 (최초 1개만 채택)

    const flushList = () => {
      if (!pendingList) return;
      const itemsHtml = pendingList.items.map(i => `<li>${i}</li>`).join("");
      htmlParts.push(pendingList.type === "ul" ? `<ul>${itemsHtml}</ul>` : `<ol>${itemsHtml}</ol>`);
      pendingList = null;
    };

    const flushTable = () => {
      if (!pendingTable || pendingTable.length === 0) return;
      const [header, ...rows] = pendingTable;
      const thead = `<thead><tr>${header.map(c => `<th>${applyInline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${applyInline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
        : "";
      htmlParts.push(`<table>${thead}${tbody}</table>`);
      pendingTable = null;
    };

    for (const rawLine of lines.slice(titleIdx + 1)) {
      const trimmed = rawLine.trim();

      if (!trimmed) { flushList(); flushTable(); continue; }

      // 코드펜스 줄(```html, ``` 등)은 LLM 잔여물이므로 출력하지 않고 스킵
      if (isCodeFence(trimmed)) { continue; }

      // 표 구분선(`|---|---|`)은 이미 누적 중인 표의 헤더 아래 줄이므로 그대로 건너뛴다
      if (pendingTable && isTableSeparatorRow(trimmed)) { continue; }

      if (isTableRow(trimmed)) {
        flushList();
        if (!pendingTable) pendingTable = [];
        pendingTable.push(splitTableCells(trimmed));
        continue;
      }
      flushTable();

      const cardMatch = extractCardPlaceholder(trimmed);
      if (cardMatch) {
        flushList();
        if (cardMatch.index === 0 && thumbnailPlaceholder === null) {
          thumbnailPlaceholder = cardMatch.full;
        } else {
          htmlParts.push(cardMatch.full);
        }
        continue;
      }

      const rich = richBlockHtml(trimmed);
      if (rich) { flushList(); htmlParts.push(rich); continue; }

      if (trimmed === "📑 이 글의 순서") {
        flushList();
        htmlParts.push('<h3 class="toc-label">📑 이 글의 순서</h3>');
        continue;
      }

      if (isSubheading(trimmed)) {
        flushList();
        htmlParts.push(`<h2>${applyInline(trimmed)}</h2>`);
        continue;
      }

      if (trimmed.startsWith("✅") || trimmed === "-" || trimmed.startsWith("- ")) {
        // "- [ ] 항목"/"- [x] 항목" (마크다운 체크박스 문법)을 그대로 두면 대괄호가 텍스트로
        // 노출된다 — 자가 점검 체크리스트 등에서 writer가 종종 이 문법을 쓰므로 시각적
        // 체크박스 기호로 치환한다.
        const text = trimmed
          .replace(/^(✅|-)\s*/, "")
          .replace(/^\[[ xX]\]\s*/, (m) => (/x/i.test(m) ? "☑ " : "☐ "));
        if (!pendingList || pendingList.type !== "ul") { flushList(); pendingList = { type: "ul", items: [] }; }
        pendingList.items.push(applyInline(text));
        continue;
      }

      const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
      if (numbered) {
        if (!pendingList || pendingList.type !== "ol") { flushList(); pendingList = { type: "ol", items: [] }; }
        pendingList.items.push(applyInline(numbered[1]));
        continue;
      }

      if (trimmed.startsWith("> ")) {
        flushList();
        htmlParts.push(`<blockquote>${applyInline(trimmed.slice(2))}</blockquote>`);
        continue;
      }

      if (trimmed.startsWith("👉")) {
        flushList();
        htmlParts.push(`<p class="highlight-line">${applyInline(trimmed)}</p>`);
        continue;
      }

      if (isHashtagLine(trimmed)) {
        flushList();
        htmlParts.push(hashtagHtml(trimmed));
        continue;
      }

      flushList();
      htmlParts.push(`<p>${applyInline(trimmed)}</p>`);
    }
    flushList();
    flushTable();

    const bodyHtml = htmlParts.join("\n");
    if (!bodyHtml.trim()) return null;

    const thumbnailHtml = thumbnailPlaceholder
      ? `<div style="margin:0 0 32px 0;text-align:center;">${thumbnailPlaceholder}</div>`
      : "";
    return renderDocument(title, bodyHtml, thumbnailHtml, shell);
  } catch (e) {
    console.warn(`[htmlAssembler] 변환 실패, draft 원문으로 폴백: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

function renderDocument(title: string, bodyHtml: string, thumbnailHtml: string, shell?: string): string {
  // 셸 템플릿의 플레이스홀더를 치환한다. 치환값에 $ 등이 있어도 안전하도록 replacer 함수를 사용.
  const tpl = shell && shell.trim() ? shell : FALLBACK_SHELL;
  let out = tpl
    .replace(/\{\{TITLE\}\}/g, () => title)
    .replace(/\{\{BODY\}\}/g, () => bodyHtml);

  if (out.includes("{{THUMBNAIL}}")) {
    out = out.replace(/\{\{THUMBNAIL\}\}/g, () => thumbnailHtml);
  } else if (thumbnailHtml) {
    // 구버전 셸(Supabase/GitHub에 캐시된, {{THUMBNAIL}} 플레이스홀더가 없는 버전) 호환:
    // <h1> 태그 바로 앞에 직접 삽입해 최상단 노출을 보장한다.
    out = out.replace(/<h1[^>]*>/, (m) => `${thumbnailHtml}\n${m}`);
  }
  return out;
}
