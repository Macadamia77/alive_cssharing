// cardCapture.ts가 만든 카드 PNG + 원본 SVG를 Supabase Storage("card-images" 버킷)에 업로드하고
// 공개 URL을 반환한다. 기존 supabase 클라이언트(src/lib/supabaseClient.ts)를 그대로 재사용.
// SVG도 같이 올리는 이유: 카드가 이제 cardTemplateBuilder.ts가 조립한 진짜 벡터라, 원본 SVG를
// 그대로 내려주면 Figma/일러스트레이터에서 텍스트를 실제로 선택·수정할 수 있다(PNG는 못 함).
import { supabase } from "../supabaseClient";
import type { CapturedCard } from "./cardCapture";

const BUCKET = "card-images";

export interface CardAsset {
  svg: string;
  pngUrl: string;
  svgUrl: string;
  heightPx: number;
}

// jobId는 저장 경로 구분용 식별자일 뿐 — task.id와 일치할 필요 없음(호출자가 없으면 자체 생성).
//
// contentType은 반드시 "card-images" 버킷의 allowed_mime_types(["image/png","image/svg+xml"])와
// 정확히 문자열 일치해야 한다 — Supabase Storage가 이 목록을 부분/파싱 매칭이 아니라 정확한
// 문자열로 검사한다(실측 확인). "image/svg+xml;charset=utf-8"처럼 파라미터를 붙이면 업로드
// 자체가 거부돼 예외가 던져진다. 인코딩을 명시하고 싶으면 이 헤더가 아니라 SVG 문서 자체의
// `<?xml version="1.0" encoding="UTF-8"?>` 선언으로 하고(cardTemplateBuilder.ts), 여기 문자열은
// 절대 건드리지 않는다.
const PNG_CONTENT_TYPE = "image/png";
const SVG_CONTENT_TYPE = "image/svg+xml";

// 카드 1장 업로드 실패가 전체를 무너뜨리지 않게 카드 단위로 격리한다 — 예전엔 한 장이라도
// 실패하면(예: 위 MIME 타입 불일치 사고) uploadCards() 전체가 예외를 던져 이미 성공한 카드까지
// 포함해 assets가 통째로 비어버렸다(호출부가 "부가 기능"이라며 조용히 삼켜서 원인 파악도
// 어려웠다 — 2026-07-13 실측 사고). 실패한 카드만 건너뛰고 나머지는 정상적으로 반환한다.
export async function uploadCards(
  channel: string,
  jobId: string,
  cards: CapturedCard[]
): Promise<CardAsset[]> {
  const assets: CardAsset[] = [];
  for (let i = 0; i < cards.length; i++) {
    try {
      const pngPath = `${channel}/${jobId}/card-${i}.png`;
      const svgPath = `${channel}/${jobId}/card-${i}.svg`;
      const { error: pngErr } = await supabase.storage.from(BUCKET).upload(pngPath, cards[i].png, {
        contentType: PNG_CONTENT_TYPE,
        upsert: true,
      });
      if (pngErr) throw new Error(`카드 ${i} PNG 업로드 실패: ${pngErr.message}`);
      const { error: svgErr } = await supabase.storage.from(BUCKET).upload(svgPath, cards[i].svg, {
        contentType: SVG_CONTENT_TYPE,
        upsert: true,
      });
      if (svgErr) throw new Error(`카드 ${i} SVG 업로드 실패: ${svgErr.message}`);
      const { data: pngData } = supabase.storage.from(BUCKET).getPublicUrl(pngPath);
      const { data: svgData } = supabase.storage.from(BUCKET).getPublicUrl(svgPath);
      assets.push({
        svg: cards[i].svg,
        pngUrl: pngData.publicUrl,
        svgUrl: svgData.publicUrl,
        heightPx: cards[i].heightPx,
      });
    } catch (e) {
      console.warn(`[cardStorage] 카드 ${i} 업로드 실패 — 이 카드만 건너뜀(다운로드 링크 없이 본문엔 그대로 반영): ${e instanceof Error ? e.message : e}`);
    }
  }
  return assets;
}
