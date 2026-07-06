// 이미지 카드 HTML → 실제 PNG 서버사이드 캡처.
// 클라이언트의 html2canvas(src/lib/resultDownload.ts)는 실제 브라우저 렌더링을 근사만 하므로
// 그림자·그라디언트·폰트 렌더링이 최종 디자인과 미묘하게 어긋날 수 있다. 로컬 blog/ 파이프라인이
// 이미 검증한 방식(Playwright 헤드리스 브라우저로 1회 실행해 순차 캡처)을 그대로 재사용한다.
// 참고: data 채널의 guide/04-image-guide.md 4절 캡처 코드, agents/image-maker.md 4.5단계(높이 검증).
//
// page.evaluate() 콜백은 Playwright가 브라우저 컨텍스트에서 실행하므로 런타임에는 document가
// 항상 존재한다 — 아래 참조는 render-worker(별도 tsconfig, lib에 "dom" 미포함)에서도 타입
// 체크가 통과하도록 이 파일에만 DOM lib을 명시적으로 끌어온다.
/// <reference lib="dom" />

import { chromium, type Browser } from "playwright";

export interface CapturedCard {
  html: string;
  png: Buffer;
  heightPx: number;
}

export interface CaptureResult {
  cards: CapturedCard[];
  // 본문 카드(인덱스 1+) 높이 최댓값-최솟값 편차가 200px을 넘으면 경고 메시지가 담긴다.
  // 1차 버전은 파이프라인을 막지 않고 경고만 남긴다 — 자동 재작성 루프는 범위 밖.
  warnings: string[];
}

const THUMBNAIL_WIDTH = 720;
const THUMBNAIL_HEIGHT = 720;
const BODY_CARD_WIDTH = 800;
const MAX_BODY_HEIGHT_VARIANCE = 200;

function wrapHtml(cardHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Malgun Gothic','맑은 고딕',sans-serif; }
  </style></head><body>${cardHtml}</body></html>`;
}

async function captureOne(
  browser: Browser,
  html: string,
  isThumbnail: boolean
): Promise<{ png: Buffer; heightPx: number }> {
  const page = await browser.newPage({
    viewport: isThumbnail
      ? { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }
      : { width: BODY_CARD_WIDTH, height: 1200 },
  });
  try {
    await page.setContent(wrapHtml(html), { waitUntil: "networkidle" });
    const png = await page.screenshot({ fullPage: !isThumbnail });
    const heightPx = isThumbnail
      ? THUMBNAIL_HEIGHT
      : await page.evaluate(() => document.body.scrollHeight);
    return { png, heightPx };
  } finally {
    await page.close();
  }
}

// cards: imageCards.ts의 spliceImageCards()가 반환한 카드 HTML 배열(인덱스 0 = 썸네일).
// Playwright/Chromium이 설치돼 있지 않으면 chromium.launch()가 던지는 에러가 그대로 위로
// 전파된다 — 호출자가 이를 잡아 inline HTML 폴백으로 처리한다(runPipeline.ts/agentRunner.ts).
export async function captureCards(cards: string[]): Promise<CaptureResult> {
  const browser = await chromium.launch();
  try {
    const captured: CapturedCard[] = [];
    for (let i = 0; i < cards.length; i++) {
      const { png, heightPx } = await captureOne(browser, cards[i], i === 0);
      captured.push({ html: cards[i], png, heightPx });
    }

    const warnings: string[] = [];
    const bodyHeights = captured.slice(1).map((c) => c.heightPx);
    if (bodyHeights.length > 1) {
      const variance = Math.max(...bodyHeights) - Math.min(...bodyHeights);
      if (variance > MAX_BODY_HEIGHT_VARIANCE) {
        warnings.push(
          `본문 카드 높이 편차 ${variance}px (기준 ${MAX_BODY_HEIGHT_VARIANCE}px 초과) — ` +
          `실측값: [${bodyHeights.join(", ")}]`
        );
      }
    }

    return { cards: captured, warnings };
  } finally {
    await browser.close();
  }
}
