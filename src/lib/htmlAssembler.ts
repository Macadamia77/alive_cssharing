// data/channels/naver-blog/agents/assembler-web.md 3~4단계 변환 규칙표를 그대로 코드로 이식.
// LLM에게 draft 전체를 다시 타이핑시키던 방식(출력 길이가 입력에 비례 → max_tokens에서 계속 잘림)을
// 대체하는 결정론적 마크다운→HTML 변환기.
//
// 변환 "로직"은 코드에 두되, "템플릿(HTML 셸)"과 "브랜드 상수(전화·URL·CTA 문구)"는
// data/ 에서 로드한다 (하드코딩 금지 원칙). 파일이 없으면 최소 폴백으로 동작이 끊기지 않게 한다.
import { readFileSync } from "fs";
import { join } from "path";

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
    const raw = readFileSync(join(process.cwd(), "data/brand.json"), "utf-8");
    return { ...FALLBACK_BRAND, ...JSON.parse(raw) };
  } catch (e) {
    console.warn(`[htmlAssembler] data/brand.json 로드 실패, 폴백 상수 사용: ${e instanceof Error ? e.message : e}`);
    return FALLBACK_BRAND;
  }
}
const BRAND = loadBrand();

// ─── HTML 문서 셸 (data/channels/naver-blog/templates/blog-shell.html) ──
// {{TITLE}}, {{BODY}} 플레이스홀더를 치환해 완성형 문서를 만든다.
const FALLBACK_SHELL =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  "<title>{{TITLE}}</title></head><body>" +
  '<div class="container"><h1>{{TITLE}}</h1>{{BODY}}</div></body></html>';

function loadShell(): string {
  try {
    return readFileSync(
      join(process.cwd(), "data/channels/naver-blog/templates/blog-shell.html"),
      "utf-8"
    );
  } catch (e) {
    console.warn(`[htmlAssembler] blog-shell.html 로드 실패, 폴백 셸 사용: ${e instanceof Error ? e.message : e}`);
    return FALLBACK_SHELL;
  }
}
const SHELL = loadShell();

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

function isCardPlaceholder(trimmed: string): boolean {
  return /^<!--\s*HTML_CARD_\d+\s*-->$/.test(trimmed);
}

// 가이드 문구가 "🔍 📊 ⚡ 💬 📞 📦 🚚 🎯 📈 등"으로 예시만 들고 고정 목록이 아님을 명시하므로,
// 특정 이모지 목록을 하드코딩하지 않고 "이모지로 시작하는 짧은 단독 행"을 일반적으로 탐지한다.
function isSubheading(trimmed: string): boolean {
  if (!trimmed || trimmed.length > 60) return false;
  if (trimmed.startsWith("✅") || trimmed.startsWith("-") || trimmed.startsWith("📑")) return false;
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

/**
 * draft.md(PUBLISH/NOTES 블록 포함 원문)를 받아 네이버 블로그용 완성형 독립 HTML을 반환한다.
 * PUBLISH 마커가 없거나, 품질 게이트가 FAIL이거나, 변환 중 문제가 생기면 null을 반환한다
 * (호출부는 null일 때 원문 draftOutput을 그대로 사용하는 기존 폴백 동작을 유지해야 한다).
 */
export function assembleNaverBlogHtml(draftOutput: string): string | null {
  try {
    const publishMatch = draftOutput.match(/<!-- PUBLISH:START -->([\s\S]*?)<!-- PUBLISH:END -->/);
    if (!publishMatch) return null;

    const notesMatch = draftOutput.match(/<!-- NOTES:START -->([\s\S]*?)<!-- NOTES:END -->/);
    if (notesMatch && isGateFailed(notesMatch[1])) return null;

    const lines = publishMatch[1].replace(/^﻿/, "").split(/\r?\n/);

    const titleIdx = lines.findIndex(l => l.trim().length > 0);
    if (titleIdx === -1) return null;
    const title = lines[titleIdx].trim().replace(/^#\s*/, "");

    const htmlParts: string[] = [];
    let pendingList: PendingList | null = null;

    const flushList = () => {
      if (!pendingList) return;
      const itemsHtml = pendingList.items.map(i => `<li>${i}</li>`).join("");
      htmlParts.push(pendingList.type === "ul" ? `<ul>${itemsHtml}</ul>` : `<ol>${itemsHtml}</ol>`);
      pendingList = null;
    };

    for (const rawLine of lines.slice(titleIdx + 1)) {
      const trimmed = rawLine.trim();

      if (!trimmed) { flushList(); continue; }

      if (isCardPlaceholder(trimmed)) { flushList(); htmlParts.push(trimmed); continue; }

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
        const text = trimmed.replace(/^(✅|-)\s*/, "");
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

    const bodyHtml = htmlParts.join("\n");
    if (!bodyHtml.trim()) return null;

    return renderDocument(title, bodyHtml);
  } catch (e) {
    console.warn(`[htmlAssembler] 변환 실패, draft 원문으로 폴백: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

function renderDocument(title: string, bodyHtml: string): string {
  // 셸 템플릿의 플레이스홀더를 치환한다. 치환값에 $ 등이 있어도 안전하도록 replacer 함수를 사용.
  return SHELL
    .replace(/\{\{TITLE\}\}/g, () => title)
    .replace(/\{\{BODY\}\}/g, () => bodyHtml);
}
