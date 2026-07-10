// 이미지 카드 SVG → 실제 PNG 래스터화.
// 예전엔 Playwright 헤드리스 브라우저로 카드 HTML을 한 장씩 스크린샷했다(로컬 blog/ 파이프라인의
// 방식을 그대로 가져온 것). 카드가 이제 image-maker LLM의 자유 HTML이 아니라
// cardTemplateBuilder.ts가 결정적으로 조립한 SVG라, 브라우저 없이 @resvg/resvg-js(Rust 기반
// 네이티브 SVG 렌더러)로 직접 래스터화할 수 있다 — 브라우저 기동·networkidle 대기·폰트 로딩
// 레이스 컨디션이 전부 사라지고, Railway 빌드에서 Chromium 설치 단계도 없어진다.
//
// 참고: data 채널의 guide/04-image-guide.md 2절(카드 스키마), agents/image-maker.md(출력 형식).

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

export interface CapturedCard {
  svg: string;
  png: Buffer;
  heightPx: number;
}

export interface CaptureResult {
  cards: CapturedCard[];
}

// Pretendard 정적 OTF(=TTF 계열, resvg/fontdb가 안정적으로 지원)를 직접 파일로 로드한다.
// 예전엔 pretendardFontData.ts에 base64 WOFF2로 박아두고 브라우저 @font-face로 주입했는데,
// resvg는 파일 경로 기반 폰트 로딩만 지원해 그 방식이 안 맞는다 — npm의 정식 `pretendard`
// 패키지가 정적 OTF 파일을 그대로 배포하므로 그걸 직접 가리킨다(base64 인라인 불필요).
//
// require.resolve()로 .otf 파일 경로를 직접 가리키면 안 된다 — Next.js(Turbopack/webpack)가
// 이 파일을 정적으로 추적해 "번들링할 모듈"로 취급하는데, .otf는 알려진 모듈 타입이 아니라
// 빌드 자체가 깨진다(다른 채널 API 라우트가 agentRunner.ts를 거쳐 이 파일까지 정적으로 참조
// 가능해서, 실제로 이 코드가 Vercel에서 실행되지 않아도 빌드 시점엔 추적된다). 대신
// package.json(알려진 .json 확장자라 안전)의 위치만 resolve하고, 실제 폰트 파일 경로는
// 런타임에 순수 문자열 조합(path.join)으로 만든다 — 번들러의 정적 분석 대상이 되지 않는다.
const PRETENDARD_STATIC_DIR = join(dirname(require.resolve("pretendard/package.json")), "dist/public/static");
const FONT_REGULAR = join(PRETENDARD_STATIC_DIR, "Pretendard-Regular.otf");
const FONT_BOLD = join(PRETENDARD_STATIC_DIR, "Pretendard-Bold.otf");

const RESVG_OPTIONS: ResvgRenderOptions = {
  font: {
    fontFiles: [FONT_REGULAR, FONT_BOLD],
    loadSystemFonts: false, // 배포 서버(Linux)마다 설치된 폰트가 달라 결과가 흔들리는 걸 방지 — 지정한 두 파일만 쓴다.
    defaultFontFamily: "Pretendard",
    sansSerifFamily: "Pretendard",
  },
  background: "rgba(255,255,255,0)",
};

// cardTemplateBuilder.ts가 만든 SVG 문자열 하나를 PNG Buffer로 래스터화한다.
// scale=2로 렌더링해 레티나/고DPI 화면에서도 텍스트·그라디언트가 흐려 보이지 않게 한다
// (예전 Playwright deviceScaleFactor:2와 동일한 의도).
export function renderSvgToPng(svg: string, scale = 2): { png: Buffer; heightPx: number } {
  const resvg = new Resvg(svg, {
    ...RESVG_OPTIONS,
    fitTo: { mode: "zoom", value: scale },
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  // 실제 높이는 SVG 원본 좌표계 기준(스케일 배율 적용 전) — cardTemplateBuilder가 계산한 값과
  // 맞추기 위해 렌더링된 픽셀 높이를 다시 scale로 나눈다.
  const heightPx = Math.round(rendered.height / scale);
  return { png, heightPx };
}

// cards: imageCards.ts가 반환한 SVG 문자열 배열(인덱스 0 = 썸네일, cardTemplateBuilder.ts가 조립).
// 순수 함수 호출이라 실패하더라도(SVG 문법 오류 등) 카드 1개 단위 예외이므로 호출자가 개별 처리한다.
export function captureCards(cards: string[]): CaptureResult {
  const captured: CapturedCard[] = cards.map((svg) => {
    const { png, heightPx } = renderSvgToPng(svg);
    return { svg, png, heightPx };
  });
  return { cards: captured };
}

// 로컬 개발 환경 등에서 폰트 파일 존재를 미리 확인하고 싶을 때 쓰는 헬퍼(선택 사용).
export function assertFontsAvailable(): void {
  readFileSync(FONT_REGULAR);
  readFileSync(FONT_BOLD);
}
