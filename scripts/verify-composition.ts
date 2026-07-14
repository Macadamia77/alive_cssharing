// composition 컴파일/검증 로직을 실제 파일로 검증(LLM·네트워크 없음, 순수 로직).
// 실행: npx tsx scripts/verify-composition.ts
import { readFileSync } from "fs";
import { compileComposition, validateComposition } from "../src/lib/pipeline/composition";
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
  { kind: "reviewer", persona: "reviewer",      guides: ["guide/02-personas.md", "guide/04-structure.md", "guide/03-content-rules.md"] },
  { kind: "reviewer", persona: "tone-reviewer", guides: [] },
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
const files = { agents: ["writer", "reviewer", "tone-reviewer"], guides: ["guide/00-tone.md", "guide/01-examples.md", "guide/02-personas.md", "guide/04-structure.md", "guide/03-content-rules.md"] };
check(validateComposition(comp, files).length === 0, "파일 실존 검증 통과(실제 링크드인 파일 기준)");
check(validateComposition(comp, { agents: ["writer"], guides: [] }).length > 0, "없는 파일 배정 시 오류 감지");

console.log(pass ? "\n전체 PASS" : "\n실패 있음");
if (!pass) process.exit(1);
