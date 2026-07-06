// naver-blog 채널을 신엔진(runPipeline)으로 마이그레이션한 뒤 로컬에서 검증하기 위한 1회성 스크립트.
// Supabase/네트워크 없이 로컬 data/channels/naver-blog 파일만으로 동작 확인.
// 실행: npx tsx scripts/test-naver-pipeline.ts
import { runPipeline } from "../src/lib/pipeline/runPipeline";
import { assembleNaverBlogHtml } from "../src/lib/htmlAssembler";

async function testStageResolution() {
  console.log("\n=== 1) mock provider로 단계 해석/가이드 배정 확인 ===\n");
  const result = await runPipeline("naver-blog", "AI 고객응대 도입 전 검토 사항", "", undefined, "mock");
  console.log(result);
}

async function testHtmlAssembly() {
  console.log("\n=== 2) assembleNaverBlogHtml() 표 변환 포함 정적 테스트 ===\n");
  const fakeDraft = `<!-- PUBLISH:START -->
AI 고객응대 도입 전 검토할 3가지 운영 기준

🤔 이런 경험 있으시죠?

점심시간이 끝나고 자리에 돌아왔는데, {{hl:부재중 전화 12건}}이 알림 화면에 쌓여 있던 순간 말이에요.

📑 이 글의 순서
1. 점심·야간·주말, 전화는 어디서 새는가
2. 응대 누락이 반복되는 진짜 원인

[IMAGE: 부재중 전화 알림 가득한 화면 일러스트]

🔍 도입 전후 비교

| 구분 | 도입 전 | 도입 후 |
|---|---|---|
| 부재중 비율 | 41% | 9% |
| CSAT | 72점 | 84점 |

✅ 야간·주말 사각지대 해소
✅ 인력 충원 없이 대응

{{center:추정보다 실측이 빠릅니다}}

[RICH:PHONE]

#AI고객응대 #CS쉐어링
<!-- PUBLISH:END -->

<!-- NOTES:START -->
[Step 0] PASS
<!-- NOTES:END -->`;

  const html = assembleNaverBlogHtml(fakeDraft);
  if (html === null) {
    console.error("❌ assembleNaverBlogHtml()이 null을 반환했습니다 (마커 누락 또는 게이트 FAIL).");
    process.exit(1);
  }
  console.log(html);

  console.log("\n--- 검증 ---");
  console.log("표 <table> 변환 포함:", html.includes("<table>") && html.includes("<th>구분</th>"));
  console.log("표 데이터 셀 포함:", html.includes("<td>41%</td>") && html.includes("<td>9%</td>"));
  console.log("하이라이트 변환:", html.includes("<mark>부재중 전화 12건</mark>"));
  console.log("가운데 정렬 변환:", html.includes('text-align:center">추정보다 실측이 빠릅니다'));
  console.log("전화 리치요소 변환:", html.includes('href="tel:1522-5539"'));
  console.log("이미지 마커 보존(카드 미생성 상태):", html.includes("[IMAGE:"));
  console.log("소제목 변환:", html.includes("<h2>🔍 도입 전후 비교</h2>"));
  console.log("체크리스트 변환:", html.includes("<ul><li>야간·주말 사각지대 해소</li>"));
  console.log("해시태그 변환:", html.includes('<span class="tag">#AI고객응대</span>'));
}

async function main() {
  await testStageResolution();
  await testHtmlAssembly();
}
main().catch(e => { console.error(e); process.exit(1); });
