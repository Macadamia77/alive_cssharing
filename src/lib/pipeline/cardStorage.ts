// cardCapture.ts가 만든 카드 PNG를 Supabase Storage("card-images" 버킷)에 업로드하고
// 공개 URL을 반환한다. 기존 supabase 클라이언트(src/lib/supabaseClient.ts)를 그대로 재사용.
import { supabase } from "../supabaseClient";
import type { CapturedCard } from "./cardCapture";

const BUCKET = "card-images";

export interface CardAsset {
  html: string;
  pngUrl: string;
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
    const path = `${channel}/${jobId}/card-${i}.png`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, cards[i].png, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) throw new Error(`카드 ${i} 업로드 실패: ${error.message}`);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    assets.push({ html: cards[i].html, pngUrl: data.publicUrl, heightPx: cards[i].heightPx });
  }
  return assets;
}
