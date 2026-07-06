// [IMAGE: ...] 마커 ↔ image-maker가 생성한 <!-- CARD_START -->...<!-- CARD_END --> 카드 HTML을
// 서로 이어붙이는 순수 로직. runPipeline.ts(신엔진)와 agentRunner.ts(레거시)가 동일한 로직을
// 각자 복제해 두고 있었어서 여기로 통합한다 — 버그를 한 곳만 고치면 양쪽에 다 반영된다.

const IMAGE_MARKER_RE = /\[IMAGE:\s*([^\]]+)\]/g;
const CARD_BLOCK_RE = /<!-- CARD_START -->([\s\S]*?)<!-- CARD_END -->/g;
const CARD_DIV_FALLBACK_RE = /<div style="font-family:[\s\S]*?<\/div>\s*<\/div>/g;

// image-maker LLM의 원본 출력에서 카드 HTML들을 추출한다.
export function extractCards(cardsRaw: string): string[] {
  const cards: string[] = [];
  let m: RegExpExecArray | null;
  const blockRe = new RegExp(CARD_BLOCK_RE);
  while ((m = blockRe.exec(cardsRaw)) !== null) cards.push(m[1].trim());

  if (cards.length === 0) {
    const divRe = new RegExp(CARD_DIV_FALLBACK_RE);
    while ((m = divRe.exec(cardsRaw)) !== null) cards.push(m[0].trim());
  }
  return cards;
}

export class ImageCardCountMismatchError extends Error {
  constructor(public readonly expected: number, public readonly actual: number) {
    super(
      `이미지 카드 생성 개수가 부족합니다 (마커 ${expected}개 중 ${actual}개만 생성됨). ` +
      `image-maker 응답이 잘렸거나 CARD_START/CARD_END 형식이 어긋났을 수 있습니다 — ` +
      `원본 마커 텍스트를 그대로 출력에 남기는 대신 이 단계를 실패 처리합니다.`
    );
    this.name = "ImageCardCountMismatchError";
  }
}

// draft 안의 [IMAGE: ...] 마커를 <!-- HTML_CARD_N --> 플레이스홀더로 치환하고,
// 실제 카드 HTML은 별도 배열로 반환한다.
// 카드 개수가 마커 개수보다 적으면(응답 잘림 등) 원본 마커 텍스트를 그대로 흘려보내지 않고
// ImageCardCountMismatchError를 던진다 — 호출자가 이 단계를 명시적 실패로 처리하도록 강제한다.
export function spliceImageCards(
  draft: string,
  cardsRaw: string
): { draft: string; cards: string[] } {
  const cards = extractCards(cardsRaw);
  const markers = [...draft.matchAll(IMAGE_MARKER_RE)];

  if (cards.length < markers.length) {
    throw new ImageCardCountMismatchError(markers.length, cards.length);
  }

  const replacedCards: string[] = [];
  let cardIndex = 0;
  const spliced = draft.replace(IMAGE_MARKER_RE, () => {
    const cardHtml = cards[cardIndex];
    replacedCards.push(cardHtml);
    const placeholder = `<!-- HTML_CARD_${cardIndex} -->`;
    cardIndex++;
    return placeholder;
  });

  return { draft: spliced, cards: replacedCards };
}
