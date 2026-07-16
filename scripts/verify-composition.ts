// composition 컴파일/검증 로직을 실제 파일로 검증(LLM·네트워크 없음, 순수 로직).
// 실행: npx tsx scripts/verify-composition.ts
import { readFileSync } from "fs";
import { compileComposition, validateComposition } from "../src/lib/pipeline/composition";
import { buildCardSvg, buildThumbnailSvg, THEMES } from "../src/lib/pipeline/cardTemplateBuilder";
import type { CardContent } from "../src/lib/pipeline/cardTemplateBuilder";
import type { Composition } from "../src/lib/pipeline/types";
import type { ChannelMeta } from "../src/lib/channelFiles";

const meta = { label: "링크드인", type: "single", description: "", include: [] } as unknown as ChannelMeta;
const comp = JSON.parse(readFileSync("data/channels/linkedin/composition.json", "utf-8")) as Composition;

let pass = true;
const check = (ok: boolean, msg: string) => { if (!ok) pass = false; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

// 1) 구조 검증 통과
check(validateComposition(comp).length === 0, "구조 검증: 에러 없음");

// 2) 컴파일 결과 = writer → reviewer → tone-reviewer (지금 링크드인 파이프라인과 동일)
const stages = compileComposition(comp, meta);
console.log("   컴파일:", stages.map(s => `${s.kind}:${s.persona}`).join(" → "));
const expected = [
  { kind: "writer",   persona: "writer",        guides: ["guide/00-tone.md", "guide/01-examples.md", "guide/02-personas.md", "guide/04-structure.md", "guide/03-content-rules.md"] },
  { kind: "reviewer", persona: "reviewer",      guides: ["guide/02-personas.md", "guide/04-structure.md", "guide/03-content-rules.md", "guide/05-image-preserve.md"] },
  { kind: "reviewer", persona: "tone-reviewer", guides: ["guide/05-image-preserve.md"] },
  { kind: "image",    persona: "image-maker",   guides: ["guide/image-card-guide.md"] },
];
check(stages.length === expected.length, `단계 수 ${stages.length}개 (기대 ${expected.length})`);
expected.forEach((e, i) => {
  const s = stages[i];
  check(
    !!s && s.kind === e.kind && s.persona === e.persona && JSON.stringify(s.guides) === JSON.stringify(e.guides),
    `단계 ${i + 1}: kind=${s?.kind} persona=${s?.persona} guides순서=${JSON.stringify(s?.guides)}`
  );
});
// rewriteMode·maxRetries 승계 확인(리뷰어 단계)
check(stages[1]?.rewriteMode === "full" && stages[1]?.maxRetries === 1, "리뷰어에 rewriteMode:full·maxRetries:1 승계");

// 3) 검증이 "빈 생성 슬롯 + 리뷰어 0" 오류를 잡는지
const bad = validateComposition({ version: 1, blocks: [{ type: "review-loop", generateAgent: "", reviewers: [] }] } as Composition);
check(bad.length >= 2, `잘못된 composition 오류 감지 ${bad.length}건: ${bad.join(" / ")}`);

// 4) 파일 실존 검증(에이전트·가이드 목록 주면 없는 파일 잡음). tone-reviewer는 공용 폴백이라 목록에 포함.
const files = { agents: ["writer", "reviewer", "tone-reviewer", "image-maker", "image-reviewer"], guides: ["guide/00-tone.md", "guide/01-examples.md", "guide/02-personas.md", "guide/04-structure.md", "guide/03-content-rules.md", "guide/05-image-preserve.md", "guide/image-card-guide.md"] };
check(validateComposition(comp, files).length === 0, "파일 실존 검증 통과(실제 링크드인 파일 기준)");
check(validateComposition(comp, { agents: ["writer"], guides: [] }).length > 0, "없는 파일 배정 시 오류 감지");

// 5) ★원자 블록(generate:draft + reviewer) 컴파일 — review-loop과 동등한 스테이지가 나오는지.
const atomic: Composition = { version: 1, blocks: [
  { type: "generate", agent: "writer", output: "draft", guides: ["guide/00-tone.md"] },
  { type: "reviewer", agent: "reviewer", guides: ["guide/02-personas.md"], maxRetries: 2, rewriteMode: "patch" },
  { type: "reviewer", agent: "tone-reviewer", guides: [] },
] };
check(validateComposition(atomic).length === 0, "원자 블록 구조 검증 통과");
const aStages = compileComposition(atomic, meta);
check(
  aStages.length === 3 && aStages[0].kind === "writer" && aStages[1].kind === "reviewer" && aStages[2].kind === "reviewer",
  `원자 컴파일: ${aStages.map(s => `${s.kind}:${s.persona}`).join(" → ")}`
);
check(aStages[1]?.maxRetries === 2 && aStages[1]?.rewriteMode === "patch", "원자 reviewer에 maxRetries:2·rewriteMode:patch 승계");
check(aStages[1]?.injectContext === true && aStages[2]?.injectContext === false, "injectContext: 내용 리뷰어 O, tone 리뷰어 X");

// 6) 순서 검증: draft 생성자 없이 reviewer만 있으면 오류.
const noDraft = validateComposition({ version: 1, blocks: [
  { type: "generate", agent: "researcher", output: "context" },
  { type: "reviewer", agent: "reviewer" },
] } as Composition);
check(noDraft.some(e => e.includes("draft가 없습니다")), `draft 없는 리뷰어 순서 오류 감지: ${noDraft.join(" / ")}`);

// 7) ★이미지 테마 골든 — 기본 테마가 네이버(무영향) + 링크드인 테마가 실제로 파랑으로 바뀌는지.
//    색 상수를 theme 파라미터로 뽑는 리팩터가 (a)기본 호출부는 네이버 색 그대로 두고 (b)링크드인
//    테마 주입 시에만 파랑이 되도록 배선됐는지 기계적으로 확인한다(감이 아니라 문자열 검사).
const sampleCard: CardContent = {
  layout: "summary", contextLabel: "CS쉐어링",
  headline: ["테스트 헤드라인", "두 번째 행"], subtext: null,
  cta: ["자세히 보기", "상담하기"], body: "본문 요약 텍스트입니다.",
};
const naverCard = buildCardSvg(sampleCard);                 // 인자 없음 = 기본
const naverCardExplicit = buildCardSvg(sampleCard, THEMES.naver);
const linkedinCard = buildCardSvg(sampleCard, THEMES.linkedin);
check(naverCard === naverCardExplicit, "기본 테마 === naver 테마(기본값이 네이버로 고정)");
check(naverCard.includes("#234b73") && !naverCard.includes("#1e90d6"), "네이버 카드: 남색 accent 유지, 링크드인 파랑 없음");
check(linkedinCard.includes("#1e90d6") && !linkedinCard.includes("#234b73"), "링크드인 카드: 파랑 accent 주입, 네이버 남색 없음");
check(linkedinCard.includes("#166bb0"), "링크드인 카드: CTA 파랑 그라디언트 끝색 반영");

const naverThumb = buildThumbnailSvg("제목", "부제", null);
const linkedinThumb = buildThumbnailSvg("제목", "부제", null, THEMES.linkedin);
check(naverThumb.includes("#18A0E8") && !naverThumb.includes("#1e90d6"), "네이버 썸네일: 기존 배경색 유지");
check(linkedinThumb.includes("#1e90d6") && !linkedinThumb.includes("#18A0E8"), "링크드인 썸네일: 파랑 배경 주입");

console.log(pass ? "\n전체 PASS" : "\n실패 있음");
if (!pass) process.exit(1);
