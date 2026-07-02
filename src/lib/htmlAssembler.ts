// data/channels/naver-blog/agents/assembler-web.md 3~4단계 변환 규칙표를 그대로 코드로 이식.
// LLM에게 draft 전체를 다시 타이핑시키던 방식(출력 길이가 입력에 비례 → max_tokens에서 계속 잘림)을
// 대체하는 결정론적 마크다운→HTML 변환기.

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
    return '<a href="tel:1522-5539" style="display:block;background:#1e90d6;color:#fff;text-align:center;padding:14px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0;">📞 1522-5539 무료 상담</a>';
  }
  if (trimmed === "[RICH:MAP]") {
    return '<div style="background:#f5f5f5;border-radius:8px;padding:16px;text-align:center;margin:16px 0;color:#555;">📍 CS쉐어링 위치 안내 (발행 시 지도 삽입)</div>';
  }
  const linkMatch = trimmed.match(/^\[RICH:LINK:(.+)\]$/);
  if (linkMatch) {
    return `<a href="https://cssharing.co.kr" style="display:block;background:#f0f7ff;border:2px solid #1e90d6;color:#1e90d6;text-align:center;padding:14px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0;">${linkMatch[1]} →</a>`;
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
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { background: #f9f9f9; margin: 0; padding: 40px 16px;
         font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; }
  .container { max-width: 700px; margin: 0 auto; background: #fff;
               padding: 40px; border-radius: 8px;
               box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  h1 { font-size: 28px; font-weight: 700; color: #111;
       border-bottom: 2px solid #e0e0e0; padding-bottom: 16px; margin-bottom: 24px; }
  h2 { font-size: 20px; font-weight: 700; color: #111;
       border-left: 5px solid #2c4a7c; padding-left: 14px; margin: 32px 0 12px; }
  h3.toc-label { font-size: 16px; font-weight: 700; color: #555; margin-bottom: 8px; }
  p { font-size: 16px; line-height: 1.8; color: #333; }
  p.center-text { text-align: center; }
  ul, ol { padding-left: 24px; line-height: 1.8; }
  li { font-size: 16px; color: #333; margin-bottom: 4px; }
  blockquote { border-left: 4px solid #2c4a7c; background: #f0f4ff;
               padding: 12px 20px; margin: 16px 0; border-radius: 0 8px 8px 0; }
  mark { background: #fff3cd; padding: 1px 4px; border-radius: 3px; }
  .handwriting { font-style: italic; color: #555; }
  .highlight-line { font-weight: 600; color: #1e90d6; }
  strong { font-weight: 700; color: #111; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th { background: #2c4a7c; color: #fff; padding: 10px 14px; border: 1px solid #1a3a6c; }
  td { padding: 10px 14px; border: 1px solid #e0e0e0; }
  tr:nth-child(even) td { background: #f5f7fa; }
  h3.toc-label + ol { list-style: none; padding: 0; text-align: center; }
  h3.toc-label + ol li { display: inline-flex; align-items: center;
                          justify-content: center; gap: 8px; margin: 4px 0; }
  .tag { display: inline-block; background: #e8f4fd; color: #1e90d6;
         padding: 3px 10px; border-radius: 20px; font-size: 13px;
         font-weight: 600; margin: 2px; }
  img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
</style>
</head>
<body>
<div class="container">
<h1>${title}</h1>
${bodyHtml}
</div>
</body>
</html>`;
}
