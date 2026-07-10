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
export async function uploadCards(
  channel: string,
  jobId: string,
  cards: CapturedCard[]
): Promise<CardAsset[]> {
  const assets: CardAsset[] = [];
  for (let i = 0; i < cards.length; i++) {
    const pngPath = `${channel}/${jobId}/card-${i}.png`;
    const svgPath = `${channel}/${jobId}/card-${i}.svg`;
    const { error: pngErr } = await supabase.storage.from(BUCKET).upload(pngPath, cards[i].png, {
      contentType: "image/png",
      upsert: true,
    });
    if (pngErr) throw new Error(`카드 ${i} PNG 업로드 실패: ${pngErr.message}`);
    const { error: svgErr } = await supabase.storage.from(BUCKET).upload(svgPath, cards[i].svg, {
      contentType: "image/svg+xml",
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
  }
  return assets;
}
