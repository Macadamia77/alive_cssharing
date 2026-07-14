// resolveModelFor()의 provider/model 라우팅 로직을 실제 LLM 호출 없이 검증하는 스크립트.
// API 키는 진짜일 필요 없음(resolveAuth는 문자열 존재 여부만 봄) — 순수 라우팅 로직만 확인.
// 실행: npx tsx scripts/verify-research-model-routing.ts
process.env.CLAUDE_API_KEY = "dummy-claude-key";
process.env.GEMINI_API_KEY = "dummy-gemini-key";
process.env.OPENAI_API_KEY = "dummy-openai-key";
// CLAUDE_MODEL/GEMINI_MODEL/OPENAI_MODEL env는 일부러 안 세팅 — DEFAULT_MODELS로 폴백되는
// 경로도 같이 검증하기 위함(대부분 실제 Railway 배포도 MODEL env는 안 씀).

import { createAuthResolver } from "../src/lib/pipeline/auth";

interface Case {
  label: string;
  baseProvider: "claude" | "gemini" | "openai";
  modelOverride?: string;       // 브라우저에서 고른 모델(활성 provider 선택)
  providerOverride?: string;    // 리서치 전용 provider(연구 provider 독립선택). undefined="동일시"
  modelIdByProvider?: Record<string, string>;
  useSearch?: boolean;
  expect: { p: string; modelContains?: string; modelIs?: string };
}

const CASES: Case[] = [
  {
    label: "1) claude+opus 선택, 리서치=동일시, useSearch(연구 단계) → sonnet-5로 다운그레이드",
    baseProvider: "claude", modelOverride: "claude-opus-4-8", useSearch: true,
    modelIdByProvider: { claude: "claude-sonnet-5" },
    expect: { p: "claude", modelIs: "claude-sonnet-5" },
  },
  {
    label: "2) claude+sonnet-4-6 선택(이미 낮음), 리서치=동일시 → 그대로 유지(더 안 낮춤)",
    baseProvider: "claude", modelOverride: "claude-sonnet-4-6", useSearch: true,
    modelIdByProvider: { claude: "claude-sonnet-5" },
    expect: { p: "claude", modelIs: "claude-sonnet-4-6" },
  },
  {
    label: "3) gemini 선택, 리서치=동일시 → gemini 그대로(맵에 gemini 키 없어 안 건드림)",
    baseProvider: "gemini", modelOverride: "gemini-3.5-flash", useSearch: true,
    modelIdByProvider: { claude: "claude-sonnet-5" },
    expect: { p: "gemini", modelIs: "gemini-3.5-flash" },
  },
  {
    label: "4) openai 선택 + useSearch(연구 단계) → gemini/claude로 자동 폴백(웹서치 불가)",
    baseProvider: "openai", modelOverride: "gpt-4o", useSearch: true,
    modelIdByProvider: { claude: "claude-sonnet-5" },
    expect: { p: "gemini" }, // gemini 키가 있으니 gemini 우선
  },
  {
    label: "5) claude+opus 선택인데 리서치 전용 provider=gemini(명시) → claude의 opus가 안 새어들어감",
    baseProvider: "claude", modelOverride: "claude-opus-4-8", providerOverride: "gemini", useSearch: true,
    modelIdByProvider: { claude: "claude-sonnet-5" },
    expect: { p: "gemini" },
  },
  {
    label: "6) gemini 선택인데 리서치 전용 provider=claude(명시) → gemini 선택이 claude에 안 새어들어감",
    baseProvider: "gemini", modelOverride: "gemini-3.5-flash", providerOverride: "claude", useSearch: true,
    modelIdByProvider: { claude: "claude-sonnet-5" },
    expect: { p: "claude" },
  },
  {
    label: "7) [채널 단계 시뮬레이션] claude+opus 선택, modelIdByProvider 없음(writer 오늘 상태) → opus 그대로(안 낮아짐)",
    baseProvider: "claude", modelOverride: "claude-opus-4-8", useSearch: false,
    modelIdByProvider: undefined,
    expect: { p: "claude", modelIs: "claude-opus-4-8" },
  },
];

async function main() {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    const { resolveModelFor } = createAuthResolver(undefined, c.baseProvider, undefined, c.modelOverride);
    const result = await resolveModelFor({
      model: c.providerOverride,
      modelIdByProvider: c.modelIdByProvider,
      useSearch: c.useSearch,
      stageId: "verify-script",
    });
    const providerOk = result.p === c.expect.p;
    const modelOk =
      (c.expect.modelIs ? result.model === c.expect.modelIs : true) &&
      (c.expect.modelContains ? result.model.includes(c.expect.modelContains) : true);
    const ok = providerOk && modelOk;
    ok ? pass++ : fail++;
    console.log(`${ok ? "✅" : "❌"} ${c.label}\n   → 실제: p=${result.p}, model=${result.model}`);
  }
  console.log(`\n${pass}/${CASES.length} 통과${fail > 0 ? `, ${fail}개 실패` : ""}`);
  if (fail > 0) process.exit(1);
}

main();
