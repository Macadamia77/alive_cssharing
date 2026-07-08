// 대표 썸네일 카드를 LLM 대신 코드가 결정적으로 조립한다.
// 예전엔 매 생성마다 LLM이 720x720 스카이블루 카드 HTML을 손으로 새로 그렸는데, 그때마다
// 색상·레이아웃·마커 문법이 조금씩 달라지고(디자인 어설픔·`{{THUMBNAIL}}` 같은 정체불명
// 토큰 유출·hoist 실패 등) 같은 계열의 버그가 반복 재발했다. 디자인 자체는 이미
// guide/04-image-guide.md 1절에 정확히 문서화돼 있으므로, 그 마크업을
// templates/thumbnail-template.html로 고정해두고 제목·부제·마스코트 세 값만 치환한다 —
// 재현성 100%, LLM 변동성 0%. 템플릿을 바꾸고 싶으면 그 파일만 고치면 되고 코드 재배포는
// 필요 없다(blog-shell.html과 동일한 방식).

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildThumbnailCard(
  template: string,
  title: string,
  subtitle: string,
  mascotDataUri: string
): string {
  return template
    .replace(/\{\{TITLE\}\}/g, () => escapeHtml(title))
    .replace(/\{\{SUBTITLE\}\}/g, () => escapeHtml(subtitle))
    .replace(/\{\{MASCOT\}\}/g, () => mascotDataUri);
}

// draft(PUBLISH 블록 포함 원문)에서 글 제목(PUBLISH 블록 첫 줄)을 뽑는다.
// htmlAssembler.ts의 titleIdx 판별 로직과 동일 기준(코드펜스 제외 첫 비어있지 않은 줄).
export function extractDraftTitle(draftOutput: string): string {
  const publishMatch = draftOutput.match(/<!-- PUBLISH:START -->([\s\S]*?)<!-- PUBLISH:END -->/);
  const body = publishMatch ? publishMatch[1] : draftOutput;
  const lines = body.replace(/^﻿/, "").split(/\r?\n/);
  const isCodeFence = (l: string) => /^(?:```|~~~)[a-zA-Z0-9]*$/.test(l);
  const titleLine = lines.find(l => l.trim().length > 0 && !isCodeFence(l.trim()));
  return (titleLine ?? "").trim().replace(/^#\s*/, "");
}

// NOTES 블록에서 writer가 남긴 "썸네일 부제: ..." 한 줄을 뽑는다. 없으면 폴백 문구를 쓴다 —
// 부제 누락이 파이프라인 전체를 막을 이유는 없다.
const SUBTITLE_LINE_RE = /썸네일\s*부제\s*[:：]\s*(.+)/;
const FALLBACK_SUBTITLE = "CS쉐어링 인사이트";

export function extractThumbnailSubtitle(draftOutput: string): string {
  const notesMatch = draftOutput.match(/<!-- NOTES:START -->([\s\S]*?)<!-- NOTES:END -->/);
  if (!notesMatch) return FALLBACK_SUBTITLE;
  const m = notesMatch[1].match(SUBTITLE_LINE_RE);
  const subtitle = m?.[1]?.trim().replace(/\s+$/, "");
  return subtitle || FALLBACK_SUBTITLE;
}
