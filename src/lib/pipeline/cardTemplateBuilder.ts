// 네이버 블로그 이미지 카드를 코드가 결정적으로 SVG로 조립한다.
// 이전엔 image-maker LLM이 카드마다 HTML+CSS를 자유롭게 새로 그렸는데, 결과물이 래스터(PNG)라
// Figma/일러스트레이터에서 열어도 편집 가능한 도형·텍스트가 아니라 통짜 이미지 하나였다
// (현업 피드백: "PNG는 수정이 안 된다"). HTML을 사후에 SVG로 감싸는 방식(<foreignObject>)도
// 검토했지만 Figma가 foreignObject를 렌더링하지 못해 "편집 가능"이라는 목적을 만족 못 한다.
//
// 그래서 이미 썸네일에 쓰던 thumbnailBuilder.ts 패턴(LLM은 내용만, 코드가 마크업을 결정적으로
// 조립)을 본문 카드까지 확장한다 — image-maker LLM은 이제 HTML이 아니라 레이아웃 타입 + 정해진
// 텍스트 필드(JSON)만 정하고, 이 파일이 실제 SVG 도형·텍스트로 조립한다. 결과물이 진짜
// <text>/<rect> 벡터라 Figma·일러스트레이터에서 텍스트를 실제로 선택·수정할 수 있다.
// 색상·규격 값은 이전 guide/04-image-guide.md 2-1·2-2절 HTML/CSS 템플릿 수치를 그대로 이식했다
// — 이 파일이 이제 그 수치들의 단일 소스다(가이드 문서는 값이 아니라 필드/글자수 규칙만 설명).

// ─── 디자인 토큰 (guide 2-1절 고정값 이식) ─────────────────────────
const CARD_WIDTH = 800;
const PAD_X = 44;
const PAD_TOP = 44;
const PAD_BOTTOM = 36;
const CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2; // 712

const BG_FROM = "#f1f3f7";
const BG_TO = "#e3e8ee";
const NAVY = "#234b73";
const INK = "#141d29";
const LABEL_GRAY = "#7d8792";
const SUBTEXT_GRAY = "#626d78";
const WATERMARK_GRAY = "#9aa2ad";
const CTA_FROM = "#4a80ab";
const CTA_TO = "#16324f";
const FONT_FAMILY = "'Pretendard','Malgun Gothic','맑은 고딕',sans-serif";

const THUMBNAIL_SIZE = 720;
const THUMBNAIL_BG = "#18A0E8";

// ─── 공통 유틸 ──────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 어절(공백) 단위 그리디 줄바꿈 — Korean word-break:keep-all과 동일하게 단어 중간을 안 끊는다.
 * 한 어절이 그 자체로 한계를 넘으면(긴 영단어 등) 그 어절만 강제로 문자 단위로 자른다.
 * maxLines를 넘기면 마지막 줄 끝에 "…"를 붙여 자른다 — SVG는 CSS overflow가 없어 방어적으로 필요.
 */
function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) {
      cur = candidate;
      continue;
    }
    if (cur) lines.push(cur);
    if (w.length > maxCharsPerLine) {
      let rest = w;
      while (rest.length > maxCharsPerLine) {
        lines.push(rest.slice(0, maxCharsPerLine));
        rest = rest.slice(maxCharsPerLine);
      }
      cur = rest;
    } else {
      cur = w;
    }
  }
  if (cur) lines.push(cur);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length > maxCharsPerLine - 1
      ? `${last.slice(0, maxCharsPerLine - 1)}…`
      : `${last}…`;
    return kept;
  }
  return lines;
}

// 한 줄로만 쓰는 필드(헤드라인·컨텍스트 라벨·CTA 등)의 안전망. wrapText와 달리 줄바꿈하지 않고
// 그 자리에서 바로 자른다 — 가이드의 글자수 규칙을 LLM이 넘겼을 때 카드 밖으로 텍스트가
// 삐져나가는 대신 눈에 띄게 잘리는 편이 낫다(가이드 규칙 위반이 로그에도 안 남는 것보다 낫다).
function clamp(text: string, maxChars: number): string {
  const t = text.trim();
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

interface TextOpts {
  size: number;
  weight?: number;
  color?: string;
  anchor?: "start" | "middle" | "end";
  letterSpacing?: number;
}

// 한 줄 = <text> 엘리먼트 하나. tspan으로 묶는 대신 줄마다 독립된 <text>로 분리해서
// Figma/일러스트레이터에서 줄 단위로도 개별 선택·수정이 가능하게 한다.
function textLine(x: number, y: number, s: string, o: TextOpts): string {
  const ls = o.letterSpacing ? ` letter-spacing="${o.letterSpacing}"` : "";
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${o.size}" ` +
    `font-weight="${o.weight ?? 400}" fill="${o.color ?? INK}" text-anchor="${o.anchor ?? "start"}"${ls}>` +
    `${escapeXml(s)}</text>`;
}

// ─── 카드 콘텐츠 스키마 (image-maker LLM이 채우는 값) ──────────────
interface CardBase {
  contextLabel: string;       // 상단 컨텍스트 바 — 글 제목 축약, 10~20자
  headline: [string, string]; // 메인 헤드라인 2행 (1행 검정·2행 네이비)
  subtext?: string;           // 보조 설명 1줄 (선택)
  cta: [string, string];      // CTA 2행 (1행 일반, 2행 강조)
}

export type CardContent =
  | (CardBase & { layout: "summary"; body: string })
  | (CardBase & { layout: "numbered"; items: { title: string; desc: string }[] })
  | (CardBase & { layout: "chat"; bubbles: [string, string]; conclusion: string })
  | (CardBase & { layout: "badges"; tags: string[]; gridItems: [{ title: string; desc: string }, { title: string; desc: string }] })
  | (CardBase & { layout: "table"; columns: [string, string]; rows: { label: string; values: [string, string] }[] });

// ─── 콘텐츠 영역 렌더러 (5종) — 각자 자기 높이를 반환한다(코드가 결정 → 편차 문제 구조적 해소) ──
interface Rendered { svg: string; height: number; }

function renderChat(c: Extract<CardContent, { layout: "chat" }>, y0: number): Rendered {
  let y = y0;
  const parts: string[] = [];
  const bubbleMaxW = Math.round(CONTENT_WIDTH * 0.75);
  for (const bubble of c.bubbles) {
    const lines = wrapText(bubble, 26, 2);
    const bh = 24 + lines.length * 20 + 8; // padding-top+bottom(≈24) + 줄높이 20px + 여유
    parts.push(
      `<rect x="0" y="${y}" width="${bubbleMaxW}" height="${bh}" rx="16" ry="16" fill="#f0f0f0"/>` +
      `<path d="M0 ${y + bh - 4} L0 ${y + bh} L4 ${y + bh - 4} Z" fill="#f0f0f0"/>`
    );
    lines.forEach((ln, i) => {
      parts.push(textLine(16, y + 26 + i * 20, `"${ln}"`, { size: 14, color: "#333" }));
    });
    y += bh + 10;
  }
  y += 6;
  parts.push(textLine(CONTENT_WIDTH / 2, y + 18, "»", { size: 22, color: NAVY, anchor: "middle" }));
  y += 34;
  const conclLines = wrapText(c.conclusion, 30, 2);
  const conclH = 28 + conclLines.length * 20;
  parts.push(`<rect x="0" y="${y}" width="${CONTENT_WIDTH}" height="${conclH}" rx="8" fill="#eef1f5"/>`);
  conclLines.forEach((ln, i) => {
    parts.push(textLine(CONTENT_WIDTH / 2, y + 24 + i * 20, ln, { size: 14, weight: 600, color: NAVY, anchor: "middle" }));
  });
  y += conclH;
  return { svg: parts.join(""), height: y - y0 };
}

function renderNumbered(c: Extract<CardContent, { layout: "numbered" }>, y0: number): Rendered {
  let y = y0;
  const parts: string[] = [];
  const textX = 46 + 18; // 고스트 넘버 폭(46) + gap(18)
  c.items.forEach((item, i) => {
    if (i > 0) parts.push(`<line x1="0" y1="${y}" x2="${CONTENT_WIDTH}" y2="${y}" stroke="#c9d2dc" stroke-width="1"/>`);
    const padTop = 18;
    const num = String(i + 1).padStart(2, "0");
    const descLines = wrapText(item.desc, 28, 2);
    parts.push(
      `<text x="0" y="${y + padTop + 32}" font-family="${FONT_FAMILY}" font-size="40" font-weight="700" ` +
      `fill="${NAVY}" fill-opacity="0.18">${escapeXml(num)}</text>`
    );
    parts.push(textLine(textX, y + padTop + 14, clamp(item.title, 14), { size: 14.5, weight: 700, color: NAVY }));
    descLines.forEach((ln, li) => {
      parts.push(textLine(textX, y + padTop + 14 + 22 + li * 20, ln, { size: 14, color: "#414b56" }));
    });
    const rowH = padTop + 14 + 22 + descLines.length * 20 + 4;
    y += rowH;
  });
  return { svg: parts.join(""), height: y - y0 };
}

function renderBadges(c: Extract<CardContent, { layout: "badges" }>, y0: number): Rendered {
  let y = y0;
  const parts: string[] = [];
  let tx = 0;
  const tagY = y;
  for (const tagRaw of c.tags) {
    const tag = clamp(tagRaw, 10);
    const w = 26 + tag.length * 13; // 대략적인 폭 추정(패딩 13px 좌우 + 글자당 13px)
    parts.push(
      `<rect x="${tx}" y="${tagY}" width="${w}" height="26" rx="13" fill="#eef1f5" ` +
      `stroke="${NAVY}" stroke-opacity="0.18"/>`
    );
    parts.push(textLine(tx + w / 2, tagY + 18, tag, { size: 13, weight: 600, color: NAVY, anchor: "middle" }));
    tx += w + 8;
  }
  y += 26 + 16;

  const gap = 10;
  const colW = (CONTENT_WIDTH - gap) / 2;
  const boxH = 78;
  c.gridItems.forEach((item, i) => {
    const bx = i * (colW + gap);
    parts.push(`<rect x="${bx}" y="${y}" width="${colW}" height="${boxH}" rx="8" fill="#f7f9fc"/>`);
    parts.push(textLine(bx + 14, y + 26, clamp(item.title, 12), { size: 13, weight: 700, color: NAVY }));
    const descLines = wrapText(item.desc, 16, 2);
    descLines.forEach((ln, li) => {
      parts.push(textLine(bx + 14, y + 46 + li * 16, ln, { size: 12, color: "#555" }));
    });
  });
  y += boxH;
  return { svg: parts.join(""), height: y - y0 };
}

function renderTable(c: Extract<CardContent, { layout: "table" }>, y0: number): Rendered {
  let y = y0;
  const parts: string[] = [];
  const colLabelW = Math.round(CONTENT_WIDTH * 0.34);
  const colValW = Math.round((CONTENT_WIDTH - colLabelW) / 2);
  const rowH = 40;

  parts.push(`<rect x="0" y="${y}" width="${CONTENT_WIDTH}" height="${rowH}" fill="${NAVY}"/>`);
  parts.push(`<line x1="${colLabelW}" y1="${y}" x2="${colLabelW}" y2="${y + rowH}" stroke="#1a3a58"/>`);
  parts.push(`<line x1="${colLabelW + colValW}" y1="${y}" x2="${colLabelW + colValW}" y2="${y + rowH}" stroke="#1a3a58"/>`);
  parts.push(textLine(12, y + 25, "구분", { size: 13, color: "#fff" }));
  parts.push(textLine(colLabelW + colValW / 2, y + 25, clamp(c.columns[0], 10), { size: 13, color: "#fff", anchor: "middle" }));
  parts.push(textLine(colLabelW + colValW + colValW / 2, y + 25, clamp(c.columns[1], 10), { size: 13, color: "#fff", anchor: "middle" }));
  y += rowH;

  for (const row of c.rows) {
    parts.push(`<rect x="0" y="${y}" width="${CONTENT_WIDTH}" height="${rowH}" fill="none" stroke="#e0e0e0"/>`);
    parts.push(`<line x1="${colLabelW}" y1="${y}" x2="${colLabelW}" y2="${y + rowH}" stroke="#e0e0e0"/>`);
    parts.push(`<line x1="${colLabelW + colValW}" y1="${y}" x2="${colLabelW + colValW}" y2="${y + rowH}" stroke="#e0e0e0"/>`);
    parts.push(textLine(12, y + 25, clamp(row.label, 14), { size: 13, color: INK }));
    parts.push(textLine(colLabelW + colValW / 2, y + 25, clamp(row.values[0], 10), { size: 13, color: "#888", anchor: "middle" }));
    parts.push(textLine(colLabelW + colValW + colValW / 2, y + 25, clamp(row.values[1], 10), { size: 13, weight: 700, color: NAVY, anchor: "middle" }));
    y += rowH;
  }
  return { svg: parts.join(""), height: y - y0 };
}

function renderSummary(c: Extract<CardContent, { layout: "summary" }>, y0: number): Rendered {
  const lines = wrapText(c.body, 40, 3);
  const padY = 16;
  const h = padY * 2 + lines.length * 24;
  const parts = [
    `<rect x="0" y="${y0}" width="${CONTENT_WIDTH}" height="${h}" rx="8" fill="#eef1f5"/>`,
    `<rect x="0" y="${y0}" width="4" height="${h}" fill="${NAVY}"/>`,
    ...lines.map((ln, i) => textLine(20, y0 + padY + 15 + i * 24, ln, { size: 15, color: "#1a1a1a" })),
  ];
  return { svg: parts.join(""), height: h };
}

// ─── 본문 카드 전체 조립 ────────────────────────────────────────
export function buildCardSvg(content: CardContent): string {
  let y = PAD_TOP;
  const parts: string[] = [];

  // 상단 컨텍스트 바
  parts.push(`<rect x="0" y="${y}" width="3" height="13" fill="${NAVY}"/>`);
  parts.push(textLine(12, y + 11, clamp(content.contextLabel, 20), { size: 12, color: LABEL_GRAY, letterSpacing: 0.4 }));
  y += 13 + 24;

  // 메인 헤드라인 2행
  parts.push(textLine(0, y + 23, clamp(content.headline[0], 16), { size: 29, weight: 700, color: INK }));
  y += 29 * 1.32;
  parts.push(textLine(0, y + 23, clamp(content.headline[1], 16), { size: 29, weight: 700, color: NAVY }));
  y += 29 * 1.32 + 10;

  // 보조 설명(선택)
  if (content.subtext) {
    parts.push(textLine(0, y + 15, clamp(content.subtext, 50), { size: 14.5, color: SUBTEXT_GRAY }));
    y += 14.5 * 1.6 + 34;
  } else {
    y += 10;
  }

  // 콘텐츠 영역 (레이아웃별)
  const contentTop = y;
  parts.push(`<g transform="translate(0, ${contentTop})">`);
  let rendered: Rendered;
  switch (content.layout) {
    case "chat": rendered = renderChat(content, 0); break;
    case "numbered": rendered = renderNumbered(content, 0); break;
    case "badges": rendered = renderBadges(content, 0); break;
    case "table": rendered = renderTable(content, 0); break;
    case "summary": rendered = renderSummary(content, 0); break;
  }
  parts.push(rendered.svg);
  parts.push(`</g>`);
  y = contentTop + rendered.height;

  // CTA 버튼
  const ctaY = y + 30;
  const ctaH = 17 * 2 + 15 * 1.5 * 2; // padding 위아래(17*2) + 2줄(각 15px*1.5줄간격)
  parts.push(`<rect x="0" y="${ctaY}" width="${CONTENT_WIDTH}" height="${ctaH}" rx="11" fill="url(#ctaGrad)"/>`);
  parts.push(textLine(CONTENT_WIDTH / 2, ctaY + ctaH / 2 - 6, clamp(content.cta[0], 26), { size: 15, weight: 600, color: "#fff", anchor: "middle" }));
  parts.push(textLine(CONTENT_WIDTH / 2, ctaY + ctaH / 2 + 16, clamp(content.cta[1], 26), { size: 15, weight: 700, color: "#fff", anchor: "middle" }));
  y = ctaY + ctaH;

  // 워터마크
  y += 16;
  parts.push(textLine(CONTENT_WIDTH, y, "CS쉐어링", { size: 11.5, weight: 600, color: WATERMARK_GRAY, anchor: "end", letterSpacing: 0.6 }));

  const cardHeight = y + PAD_BOTTOM;

  return (
    `<svg width="${CARD_WIDTH}" height="${cardHeight}" viewBox="0 0 ${CARD_WIDTH} ${cardHeight}" ` +
    `xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="bgGrad" x1="0.15" y1="0" x2="0.85" y2="1">` +
    `<stop offset="0%" stop-color="${BG_FROM}"/><stop offset="100%" stop-color="${BG_TO}"/>` +
    `</linearGradient>` +
    `<linearGradient id="ctaGrad" x1="0.2" y1="0" x2="0.8" y2="1">` +
    `<stop offset="0%" stop-color="${CTA_FROM}"/><stop offset="100%" stop-color="${CTA_TO}"/>` +
    `</linearGradient>` +
    `<filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#14202e" flood-opacity="0.14"/>` +
    `</filter>` +
    `</defs>` +
    `<rect x="0" y="0" width="${CARD_WIDTH}" height="${cardHeight}" rx="18" fill="url(#bgGrad)" filter="url(#cardShadow)"/>` +
    `<g transform="translate(${PAD_X}, 0)">${parts.join("")}</g>` +
    `</svg>`
  );
}

// ─── 안전망: JSON 파싱 실패 등으로 카드를 못 만들 때 쓰는 최소 대체 카드 ──
// 파이프라인 전체를 죽이는 대신, 헤드라인만 담은 단순 요약 카드로 대체한다.
export function buildFallbackCardSvg(headline: string): string {
  return buildCardSvg({
    layout: "summary",
    contextLabel: "CS쉐어링",
    headline: [headline.slice(0, 16), ""],
    cta: ["자세히 알아보기", "CS쉐어링과 상담하기"],
    body: headline,
  });
}

// 이모지(📞 등)는 쓰지 않는다 — resvg는 Pretendard 폰트 파일만 로드하므로(이모지 글리프 없음)
// 이모지 코드포인트가 깨진 사각형("tofu")으로 렌더링된다. 대신 원 배지 + 최소한의 기본 도형
// (원 배지 + 회전된 막대·원 2개로 만든 옛 수화기 실루엣)만으로 직접 그린다 — 폰트 의존이
// 전혀 없어 어떤 배포 환경에서도 항상 동일하게 렌더링된다.
function phoneIcon(cx: number, cy: number, badgeR: number): string {
  const barLen = badgeR * 0.62;
  const barW = badgeR * 0.34;
  const dotR = badgeR * 0.28;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${badgeR}" fill="#ffffff" fill-opacity="0.16"/>` +
    `<g transform="translate(${cx},${cy}) rotate(-45)">` +
    `<rect x="${-barLen / 2}" y="${-barW / 2}" width="${barLen}" height="${barW}" rx="${barW / 2}" fill="#fff"/>` +
    `<circle cx="${-barLen / 2}" cy="0" r="${dotR}" fill="#fff"/>` +
    `<circle cx="${barLen / 2}" cy="0" r="${dotR}" fill="#fff"/>` +
    `</g>`
  );
}

// ─── 대표 썸네일 (720×720, 결정적 조립 — thumbnailBuilder.ts의 SVG 버전) ──
// mascotDataUri가 null이면(자산 로드 실패 등) 마스코트 이미지 없이 나머지 요소만으로 조립한다 —
// 항상 유효한 SVG를 반환해야 호출부가 마커 인덱스 정렬을 안 깨고(빈 문자열을 걸러내지 않고)
// 그대로 스플라이스할 수 있다.
export function buildThumbnailSvg(title: string, subtitleRaw: string, mascotDataUri: string | null): string {
  const titleLines = wrapText(title, 15, 2);
  const subtitle = clamp(subtitleRaw, 26);
  const badgeW = Math.min(600, 60 + subtitle.length * 17);

  const titleBlock = titleLines
    .map((ln, i) => textLine(THUMBNAIL_SIZE / 2, 402 + i * 46, ln, { size: 36, weight: 800, color: "#fff", anchor: "middle" }))
    .join("");

  const mascot = mascotDataUri
    ? `<image href="${mascotDataUri}" x="32" y="${THUMBNAIL_SIZE - 178}" width="150" height="150" preserveAspectRatio="xMidYMid meet"/>`
    : "";

  return (
    `<svg width="${THUMBNAIL_SIZE}" height="${THUMBNAIL_SIZE}" viewBox="0 0 ${THUMBNAIL_SIZE} ${THUMBNAIL_SIZE}" ` +
    `xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="4" y="4" width="${THUMBNAIL_SIZE - 8}" height="${THUMBNAIL_SIZE - 8}" fill="${THUMBNAIL_BG}" ` +
    `stroke="#ffffff" stroke-width="8"/>` +
    `<path d="M40 80 L40 40 L80 40" fill="none" stroke="#fff" stroke-width="4"/>` +
    textLine(THUMBNAIL_SIZE - 40, 58, "CS Sharing", { size: 18, weight: 700, color: "#fff", anchor: "end", letterSpacing: 1 }) +
    `<rect x="${THUMBNAIL_SIZE / 2 - badgeW / 2}" y="292" width="${badgeW}" height="38" rx="19" fill="#fff"/>` +
    textLine(THUMBNAIL_SIZE / 2, 317, subtitle, { size: 16, weight: 700, color: THUMBNAIL_BG, anchor: "middle" }) +
    titleBlock +
    phoneIcon(THUMBNAIL_SIZE / 2, 495, 42) +
    mascot +
    textLine(THUMBNAIL_SIZE - 40, THUMBNAIL_SIZE - 52, "CS 아웃소싱의 새로운 기준", { size: 14, weight: 500, color: "#fff", anchor: "end" }) +
    `</svg>`
  );
}
