// 결과물 게시 보조: 클립보드 복사 / 카드(HTML) → PNG 렌더 / ZIP 다운로드
// 전부 브라우저(클라이언트)에서만 동작한다. 브라우저 전용 라이브러리는 함수 내부에서 동적 import.
import JSZip from "jszip";

// HTML 문자열에서 이미지 카드(<figure>)들의 outerHTML을 추출
export function extractCards(html: string): string[] {
  if (typeof window === "undefined" || !html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("figure")).map((f) => f.outerHTML);
}

// HTML 본문을 붙여넣기용 평문 텍스트로 변환 (이미지 카드는 제거 — 카드는 이미지로 따로 받음)
export function htmlToText(html: string): string {
  if (typeof window === "undefined" || !html) return html ?? "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("figure").forEach((f) => f.remove());
  doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  doc
    .querySelectorAll("p,div,h1,h2,h3,h4,h5,li,section,article")
    .forEach((el) => el.appendChild(document.createTextNode("\n")));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// 캡션에서 해시태그를 분리
export function splitHashtags(text: string): { body: string; tags: string } {
  const tagRegex = /#[^\s#]+/g;
  const tags = (text.match(tagRegex) ?? []).join(" ");
  const body = text.replace(tagRegex, "").replace(/\n{3,}/g, "\n\n").trim();
  return { body, tags };
}

// 카드 HTML 하나를 화면 밖에서 렌더해 PNG Blob으로 변환
async function renderCardToBlob(cardHtml: string, width = 640): Promise<Blob> {
  const html2canvas = (await import("html2canvas")).default;
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.width = `${width}px`;
  holder.style.background = "#ffffff";
  holder.innerHTML = cardHtml;
  document.body.appendChild(holder);
  try {
    const target = (holder.firstElementChild as HTMLElement) ?? holder;
    const canvas = await html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))),
        "image/png"
      )
    );
  } finally {
    document.body.removeChild(holder);
  }
}

// 텍스트를 클립보드에 복사
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// 카드 한 장 개별 다운로드
export async function downloadCardPng(cardHtml: string, filename: string): Promise<void> {
  const { saveAs } = await import("file-saver");
  const blob = await renderCardToBlob(cardHtml);
  saveAs(blob, filename);
}

// 카드 여러 장을 ZIP으로 일괄 다운로드 (파일명 01, 02, … 순번)
export async function downloadCardsZip(cards: string[], baseName: string): Promise<void> {
  const { saveAs } = await import("file-saver");
  const zip = new JSZip();
  for (let i = 0; i < cards.length; i++) {
    const blob = await renderCardToBlob(cards[i]);
    const num = String(i + 1).padStart(2, "0");
    zip.file(`${baseName}_${num}.png`, blob);
  }
  const out = await zip.generateAsync({ type: "blob" });
  saveAs(out, `${baseName}_images.zip`);
}
