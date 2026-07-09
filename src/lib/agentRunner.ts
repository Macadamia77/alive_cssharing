import { CHANNELS, type ChannelKey } from "./channels";
import { buildSystemPrompt, hasAgentPipeline, collectGuideFiles, readChannelFile, getChannelMeta } from "./channelFiles";
import { loadAIConfig, type Provider, type ProviderKey } from "./aiConfig";
import { DEFAULT_MODELS } from "./resolveProvider";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { callClaude, callOpenAI, callGemini, callGeminiWithSearch, callClaudeWithNativeSearch } from "./apiClients";
import { assembleNaverBlogHtml } from "./htmlAssembler";
import { dataRoot } from "./dataRoot";
import { spliceImageCards } from "./pipeline/imageCards";
import type { CardAsset } from "./pipeline/cardStorage";
// captureCards/uploadCards는 Playwright(네이티브 브라우저 바이너리 필요)를 정적 최상단에서
// import하면, 이 파일을 함께 import하는 Vercel(Next.js API route) 쪽에서도 모듈 로드
// 시점에 번들링/로딩이 실패한다 — 아래 Step 2.5 안에서만 동적 import로 지연 로드한다.

function saveDebug(stepName: string, content: string) {
  try {
    const debugDir = join(process.cwd(), "debug_pipeline");
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(join(debugDir, `${stepName}.txt`), content, "utf-8");
  } catch (e) {
    console.error("Failed to write debug file:", e);
  }
}

// ─── Mock 생성기 ──────────────────────────────────────────────
function mockGenerate(channel: ChannelKey, topic: string, guideHint = ""): string {
  switch (channel) {
    case "naver-blog":
      return `# ${topic}: 기업이 반드시 알아야 할 핵심 전략 ${guideHint}

## 들어가며

${topic}을 제대로 이해하지 못한 기업들이 연간 수억 원의 손실을 보고 있습니다. CS쉐어링이 500개 이상의 기업을 컨설팅하며 확인한 사실입니다.

## ${topic}의 현주소

많은 기업들이 ${topic}의 중요성은 알지만, 막상 어디서부터 시작해야 할지 모르는 경우가 많습니다.

**핵심은 "무엇을 할 것인가"가 아니라 "어떻게 실행할 것인가"입니다.**

## 핵심 해결 전략 3가지

**첫 번째, 데이터 기반 현황 진단**
현재 상태를 정확히 파악하지 않고 움직이는 것은 지도 없이 길을 나서는 것과 같습니다.

**두 번째, 전문 파트너 선정**
${topic} 분야의 전문가와 함께해야 시행착오를 줄일 수 있습니다.

**세 번째, 단계적 실행과 모니터링**
빠른 실행보다 지속 가능한 프로세스가 더 중요합니다.

## CS쉐어링과 함께 시작하세요

#${topic.replace(/\s/g, "")} #CS쉐어링 #고객서비스 #아웃소싱`;

    case "instagram":
      return `${topic}에 대해 알고 계셨나요? 🤔

사실 많은 분들이 이 부분에서 막막함을 느끼세요.

✅ 포인트 1 — 현황 파악이 먼저입니다
✅ 포인트 2 — 전문가와 함께하면 달라집니다
✅ 포인트 3 — 작은 변화가 큰 차이를 만들어요

CS쉐어링이 함께라면 ${topic}도 걱정 없어요 💪

${topic}에서 가장 어려운 점이 뭔가요? 댓글로 알려주세요! 💬

#CS쉐어링 #고객센터 #고객서비스 #CX #아웃소싱`;

    case "linkedin":
      return `${topic}이 기업 경쟁력의 핵심이 되고 있습니다.

**CS쉐어링 ${topic} 전략 3단계:**

▶ 1단계: 데이터 기반 현황 진단
▶ 2단계: 맞춤형 운영 모델 설계
▶ 3단계: KPI 기반 지속 개선

${topic}에 대해 이야기 나눠보고 싶으시다면 언제든 연락해주세요.

#CustomerExperience #CX #아웃소싱 #CS쉐어링`;

    case "magazine":
      return `# ${topic}: CS쉐어링 인사이트 리포트 ${guideHint}

## Executive Summary

${topic}은 현대 비즈니스 환경에서 기업의 지속 성장을 위한 핵심 요소입니다.

---

## 1. 현황 분석

디지털 전환 가속화와 고객 기대치 상승으로 ${topic}의 중요성이 높아지고 있습니다.

## 2. CS쉐어링 전략 프레임워크

**Phase 1 — 진단**: 현황 정밀 분석
**Phase 2 — 설계**: 맞춤형 운영 모델
**Phase 3 — 최적화**: KPI 기반 지속 개선

---
*CS쉐어링 인사이트 매거진 | contact@cssharing.co.kr*`;
  }
}

// ─── 코드 블록 제거 헬퍼 ─────────────────────────────────────
function stripCodeFence(text: string): string {
  let s = text.trim();
  // ① 출력 전체가 펜스로 깔끔히 감싸진 경우 → 안쪽만 추출
  const m = s.match(/^(?:```|~~~)[\w-]*\n?([\s\S]*?)\n?(?:```|~~~)\s*$/);
  if (m) return m[1].trim();
  // ② 여는 펜스만 있고 닫는 펜스가 누락/부분인 경우(잘림 등) → 앞뒤 펜스 줄만 제거
  s = s.replace(/^(?:```|~~~)[\w-]*[ \t]*\r?\n/, "");
  s = s.replace(/\r?\n(?:```|~~~)[ \t]*$/, "");
  return s.trim();
}

// ─── 카드 JSON 추출 (마크다운 펜스·잡텍스트 안에 섞여있어도 파싱) ───
function extractJsonObject(text: string): any {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }

  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

// ─── 자동 검수 (guide/08-qc-checklist.md 1번 항목, 코드로 직접 계산) ───
function computeAutoChecks(parsed: any): Record<string, "PASS" | "FAIL"> {
  const cards: any[] = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const checks: Record<string, "PASS" | "FAIL"> = {};

  checks["카드_구성"] = cards.length === 5 || cards.length === 6 ? "PASS" : "FAIL";

  const first = cards[0];
  const last = cards[cards.length - 1];
  checks["카드_순서"] = first?.layout_type === "cover" && last?.layout_type === "cta" ? "PASS" : "FAIL";

  checks["첫장_필드"] = first
    ? ((first.items?.length ?? 0) === 0 && !first.highlight_text ? "PASS" : "FAIL")
    : "FAIL";

  checks["CTA_필드"] = last
    ? ((last.items?.length ?? 0) === 0 && !last.highlight_text ? "PASS" : "FAIL")
    : "FAIL";

  // 05-hook-patterns.md의 데모 문장을 그대로(또는 토씨만 바꿔) 베끼지 않았는지 확인.
  // 실제로 이 문장 그대로 쓰면 3인칭 일반론이라 공감이 안 되는 밋밋한 후킹이 된다.
  const HOOK_DEMO_PHRASES = [
    "1년을 못 채우고 그만둡니다",
    "올해도 처음부터 다시 시작하시나요",
    "3개월 만에 퇴사",
    "떠난 고객은 다시 오지 않습니다",
    "CS쉐어링은 '구독'입니다",
    "매년 이맘때 채용공고 올리는 CS팀장님",
    "경쟁사는 이미 인력 운영 방식을 바꿨습니다",
    "이번 달에도 그 문의 또 왔어요",
    "문의가 안 줄어드는 CS팀의 흔한 유형 3가지",
    "문의가 반복되면 보통 상담사 탓을 합니다",
    "고객이 화내는 건 응대가 늦어서가 아니라, 대답이 매번 달라서입니다",
    "같은 문의 100건, 몇 건이 운영 문제일까",
    "그 문의, 이번 달에도\n또 들어왔다면\n상담사 탓이 아닙니다",
  ].map((s) => s.split(/[,\n]/).map((seg) => seg.replace(/\s+/g, "")).filter(Boolean));
  checks["후킹_예시문장_재사용"] = first
    ? (() => {
        const normalized = `${first.title || ""}${first.subtitle || ""}`.replace(/\s+/g, "");
        // 절 단위로 쪼개서 전부 포함되는지 확인 — 중간에 다른 문구를 끼워넣어 이어붙이기를 피해가는 경우도 잡는다.
        return HOOK_DEMO_PHRASES.some((segments) => segments.every((seg) => normalized.includes(seg))) ? "FAIL" : "PASS";
      })()
    : "PASS";

  const middles = cards.slice(1, -1);

  checks["중간카드_title_줄바꿈"] = middles.length > 0 && middles.every((c) => {
    const title: string = c.title || "";
    const lineBreaks = (title.match(/\n/g) || []).length;
    return lineBreaks === 1 && title.split("\n").every((l) => l.length <= 15);
  }) ? "PASS" : "FAIL";

  checks["중간카드_subtitle"] = middles.every((c) => {
    const sub: string = c.subtitle || "";
    return !sub.includes("\n") && sub.length <= 25;
  }) ? "PASS" : "FAIL";

  // 첫 장/CTA 카드도 중간 카드와 동일한 title(줄당 15자)·subtitle(줄바꿈 없이 25자) 글자수 제한을 지킨다.
  checks["첫장_CTA_글자수"] = [first, last].filter(Boolean).every((c) => {
    const title: string = c.title || "";
    const sub: string = c.subtitle || "";
    return title.split("\n").every((l) => l.length <= 15) && !sub.includes("\n") && sub.length <= 25;
  }) ? "PASS" : "FAIL";

  const layoutRange: Record<string, [number, number]> = {
    steps_vertical: [2, 4], compare_2col: [2, 2], flow_process: [3, 4],
    keyword_boxes: [3, 4], stacked_boxes: [2, 3],
  };
  checks["items_개수"] = middles.every((c) => {
    const range = layoutRange[c.layout_type];
    if (!range) return true;
    const n = (c.items?.length ?? 0);
    return n >= range[0] && n <= range[1];
  }) ? "PASS" : "FAIL";

  checks["highlight_text_일치"] = middles.every((c) =>
    !c.highlight_text || (c.title || "").includes(c.highlight_text)
  ) ? "PASS" : "FAIL";

  // steps_vertical 박스는 1줄만 표시되게 고정이라, item.body가 25자를 넘으면 Figma에서 2줄로 밀려 아래가 잘린다.
  checks["steps_vertical_body_길이"] = middles.every((c) => {
    if (c.layout_type !== "steps_vertical") return true;
    const items: any[] = Array.isArray(c.items) ? c.items : [];
    return items.every((it) => (it?.body || "").length <= 25);
  }) ? "PASS" : "FAIL";

  // title/subtitle에 "N단계", "N가지"처럼 숫자를 명시했으면 items 개수가 실제로 N개인지 대조
  checks["숫자_문구_일치"] = middles.every((c) => {
    const text = `${c.title || ""} ${c.subtitle || ""}`;
    const match = text.match(/(\d+)\s*(단계|가지|개)/);
    if (!match) return true;
    const claimed = parseInt(match[1], 10);
    const n = c.items?.length ?? 0;
    return claimed === n;
  }) ? "PASS" : "FAIL";

  // company-facts.md "외부 리서치를 인용한 수치" 섹션의 특정 수치만 출처 표기 대상이다.
  // "개별 고객사 사례"(CS쉐어링 자체 사례) 수치는 우리 회사 자료라 출처가 필요 없어서 제외한다(00-brand-scope.md 참고).
  // company-facts.md의 "외부 리서치" 섹션이 바뀌면 이 목록도 같이 업데이트해야 한다.
  const EXTERNAL_STAT_PATTERNS = [/\b88\s*%/, /\b70\s*%/, /\b60\s*%/, /\b78\.6\s*%/, /\b10\s*배/];
  checks["수치_출처_표기"] = middles.every((c) => {
    const itemsText = Array.isArray(c.items)
      ? c.items.map((it: any) => `${it?.title || ""} ${it?.body || ""}`).join(" ")
      : "";
    const text = `${c.title || ""} ${c.subtitle || ""} ${c.highlight_text || ""} ${itemsText}`;
    const hasExternalStat = EXTERNAL_STAT_PATTERNS.some((p) => p.test(text));
    return !hasExternalStat || !!(c.cta && String(c.cta).trim());
  }) ? "PASS" : "FAIL";

  // 캡션 이모지 개수 3~5개 (06-content-rules.md 캡션 규칙)
  const emojiCount = ((parsed?.caption || "").match(/\p{Extended_Pictographic}/gu) || []).length;
  checks["캡션_이모지_개수"] = emojiCount >= 3 && emojiCount <= 5 ? "PASS" : "FAIL";

  const hashtags: any[] = Array.isArray(parsed?.hashtags) ? parsed.hashtags : [];
  const hasRequiredTags = REQUIRED_HASHTAGS.every((t) => hashtags.includes(t));
  checks["해시태그_개수_필수태그"] = hashtags.length >= 12 && hashtags.length <= 15 && hasRequiredTags ? "PASS" : "FAIL";

  const leakText = [parsed?.caption, ...cards.map((c) => `${c.body ?? ""} ${c.design_point ?? ""}`)].join(" ");
  checks["검수정보_비노출"] = /\bplanning\b|\bdesign_point\b/i.test(leakText) ? "FAIL" : "PASS";

  return checks;
}

// guide/06-content-rules.md 기준 필수 해시태그
const REQUIRED_HASHTAGS = ["#CS쉐어링", "#CS대행", "#고객센터대행"];

// ─── 재생성 없이 코드로 바로 고칠 수 있는 기계적 문제 보정 ───
// parsed를 직접 변형한다 (재할당 아님 — 호출부에서 그대로 이어서 씀).
function applyMechanicalFixes(parsed: any): void {
  if (Array.isArray(parsed?.hashtags)) {
    let tags: string[] = [...new Set(parsed.hashtags as string[])];
    for (const req of REQUIRED_HASHTAGS) {
      if (!tags.includes(req)) tags.unshift(req);
    }
    if (tags.length > 15) tags = tags.slice(0, 15);
    // 12개 미만이면 내용을 지어내야 해서 여기서 안전하게 채울 수 없다 — 재생성으로 넘긴다.
    parsed.hashtags = tags;
  }
}

// Figma에서 수동으로 바로 고칠 수 있는 항목은 전체 판정을 막지 않는다 (재생성 낭비 방지).
// highlight_text_일치: 강조 위치는 Figma에서 수동 조정 가능. 중간카드_title_줄바꿈·중간카드_subtitle·첫장_CTA_글자수:
// 글자수·줄바꿈도 Figma 텍스트박스에서 손으로 바로 고칠 수 있는 사소한 항목이라 재생성까지 갈 필요 없음.
const NON_BLOCKING_AUTO_CHECKS = new Set(["highlight_text_일치", "중간카드_title_줄바꿈", "중간카드_subtitle", "첫장_CTA_글자수"]);

// 정성 평가 30점 만점 기준. PASS 26점 이상(평균 4.33/5), 조건부 PASS 22~25점, 그 미만은 FAIL.
// LLM 채점 특성상 30점 만점(전 항목 5점)을 매번 요구하면 사실상 통과가 불가능해져 기준 자체가 무의미해지므로,
// "웬만하면 잘 썼다"를 걸러내는 실질적 상한선으로 26점을 쓴다.
function computeVerdict(autoChecks: Record<string, "PASS" | "FAIL">, scores: Record<string, number>): "PASS" | "조건부 PASS" | "FAIL" {
  const blockingChecks = Object.entries(autoChecks).filter(([key]) => !NON_BLOCKING_AUTO_CHECKS.has(key));
  const autoAllPass = blockingChecks.every(([, v]) => v === "PASS");
  const values = Object.values(scores).filter((v) => typeof v === "number");
  const sum = values.reduce((a, b) => a + b, 0);
  const serviceZero = (scores["서비스_범위_정확성"] ?? 5) === 0;
  if (!autoAllPass || sum < 22 || serviceZero) return "FAIL";
  if (sum >= 26) return "PASS";
  return "조건부 PASS";
}

// ─── 검수 체크리스트(guide/08-qc-checklist.md 등) 기반 채점 + 재생성 ───
// 채널 폴더에 검수 체크리스트 파일이 있을 때만 동작. 없거나 카드 JSON이 아니면 원본 그대로 반환.
async function runQcAndRegenerate(
  channel: ChannelKey,
  content: string,
  systemPrompt: string,
  userMessage: string,
  provider: Provider,
  pc: { apiKey: string; model: string },
  maxTok: number,
  disableThinking: boolean,
  token?: string
): Promise<string> {
  let qcChecklist = "";
  try {
    qcChecklist = (await readChannelFile(channel, "guide/08-qc-checklist.md", token)).trim();
  } catch {
    return content;
  }
  if (!qcChecklist) return content;

  let companyFacts = "";
  try {
    companyFacts = readFileSync(join(dataRoot(), "data", "company-facts.md"), "utf-8").trim();
  } catch {
    // 없으면 서비스 실존 여부 대조 없이 진행
  }

  async function callProvider(system: string, user: string, tokens: number): Promise<string | null> {
    try {
      if (provider === "claude") return await callClaude(pc.apiKey, pc.model, system, user, tokens);
      if (provider === "gemini") return await callGemini(pc.apiKey, pc.model, system, user, tokens, disableThinking);
      if (provider === "openai") return await callOpenAI(pc.apiKey, pc.model, system, user);
      return null;
    } catch {
      return null;
    }
  }

  const CRITERIA_NAMES = ["문장_자연스러움", "서비스_범위_정확성", "고객_문제_반영", "채널_적합성", "후킹력", "CTA_연결성"];

  async function scoreOnce(text: string): Promise<{ parsed: any; report: any } | null> {
    const parsed = extractJsonObject(text);
    if (!parsed || !Array.isArray(parsed.cards)) return null;

    // 재생성 없이 코드로 바로 고칠 수 있는 기계적 문제는 여기서 직접 고친다 (해시태그 5개 초과 시 자르기 등)
    applyMechanicalFixes(parsed);

    const autoChecks = computeAutoChecks(parsed);

    const qcPrompt = `다음은 방금 생성된 카드뉴스 콘텐츠와 검수 체크리스트다. 체크리스트의 "2. 정성 평가" 6개 항목을 각각 1~5점(서비스 범위 정확성은 0~5점)으로 엄격하게 채점하라.

- 후킹력: 1장 title/subtitle이 05-hook-patterns.md 유형 중 하나로 명확히 분류되는지. 어느 유형에도 안 걸리고 "~한데 ~인지"류 안전한 반문형이면 3점 이하.
- 서비스 범위 정확성: 아래 [검증된 회사 정보]에 없는 서비스명·기능을 지어냈으면 반드시 0점. 수치는 출처가 있거나 가상 예시 표시가 있어야 함.

[검증된 회사 정보]
${companyFacts || "(제공되지 않음 — 서비스 실존 여부는 판단하지 말고 다른 항목만 채점)"}

[검수 체크리스트]
${qcChecklist}

[방금 생성된 콘텐츠]
${text}

각 항목마다 왜 그 점수를 줬는지 근거(reason)를 반드시 대고, 5점 미만이면 구체적으로 어떻게 고치면 되는지 대안(suggestion)까지 써라 — 채점자 마음대로 점수만 던지지 말 것. 아래 JSON 형식으로만 답하라. 다른 설명은 출력하지 마라.
{
  "criteria": [
    { "name": "문장_자연스러움", "score": 1~5 정수, "reason": "이 점수를 준 근거 1문장", "suggestion": "5점 미만이면 구체적 수정 방향, 5점이면 빈 문자열" },
    { "name": "서비스_범위_정확성", "score": 0~5 정수, "reason": "...", "suggestion": "..." },
    { "name": "고객_문제_반영", "score": 1~5 정수, "reason": "...", "suggestion": "..." },
    { "name": "채널_적합성", "score": 1~5 정수, "reason": "...", "suggestion": "..." },
    { "name": "후킹력", "score": 1~5 정수, "reason": "...", "suggestion": "..." },
    { "name": "CTA_연결성", "score": 1~5 정수, "reason": "...", "suggestion": "..." }
  ]
}`;

    const verdictRaw = await callProvider("", qcPrompt, 1600);
    if (!verdictRaw) return null;

    let scoreResult: { criteria?: Array<{ name: string; score: number; reason?: string; suggestion?: string }> };
    try {
      scoreResult = JSON.parse(stripCodeFence(verdictRaw));
    } catch {
      return null;
    }

    const criteria = Array.isArray(scoreResult.criteria) ? scoreResult.criteria : [];
    const scores: Record<string, number> = {};
    for (const c of criteria) {
      if (c && CRITERIA_NAMES.includes(c.name) && typeof c.score === "number") scores[c.name] = c.score;
    }
    // 6개 항목 중 일부라도 빠지면(형식을 안 지켰거나 파싱이 어긋난 경우) 조용히 0점 처리하지 않고
    // 파싱 실패와 동일하게 취급해 재시도 경로를 타게 한다.
    if (Object.keys(scores).length < CRITERIA_NAMES.length) return null;
    const values = Object.values(scores);
    const sum = values.reduce((a, b) => a + b, 0);
    const average = values.length ? Math.round((sum / values.length) * 100) / 100 : 0;
    const verdict = computeVerdict(autoChecks, scores);

    return {
      parsed,
      report: { auto_checks: autoChecks, criteria, scores, sum, average, verdict },
    };
  }

  function attemptRank(report: any): number {
    // 재시도를 다 써도 PASS가 안 나올 때 "그나마 나은" 시도를 고르기 위한 순위 (높을수록 좋음).
    if (report.verdict === "PASS") return 2_000 + report.sum;
    if (report.verdict === "조건부 PASS") return 1_000 + report.sum;
    return report.sum;
  }

  const MAX_ATTEMPTS = 3;
  const attempts: Array<{ parsed: any; report: any }> = [];

  // 1차 시도: 이미 생성된 content 그대로 채점.
  let current: { parsed: any; report: any } | null = await scoreOnce(content);
  if (!current) {
    // JSON으로 파싱조차 안 되면(잡담·설명 텍스트 섞임, 이스케이프 깨짐 등) 검수를 건너뛰고
    // 깨진 콘텐츠를 그대로 사용자에게 보여주지 않는다 — JSON만 다시 출력하도록 1회 재시도한다.
    const retryMessage = `${userMessage}

[중요] 방금 응답이 유효한 JSON으로 파싱되지 않았습니다. 설명 문구나 코드펜스 밖 텍스트 없이, 순수한 JSON 객체 하나만 다시 출력하세요.`;
    const reformatted = await callProvider(systemPrompt, retryMessage, maxTok);
    if (!reformatted) return content;
    current = await scoreOnce(reformatted);
    if (!current) return reformatted; // 재시도도 파싱 실패면 그거라도 최선으로 반환
  }
  attempts.push(current);

  // FAIL이면 최대 MAX_ATTEMPTS번까지(1차 포함) 반복 재작성. PASS/조건부 PASS가 나오면 바로 멈춘다.
  while (attempts[attempts.length - 1].report.verdict === "FAIL" && attempts.length < MAX_ATTEMPTS) {
    const last = attempts[attempts.length - 1];
    const criteriaFeedback = (last.report.criteria as Array<{ name: string; score: number; reason?: string; suggestion?: string }> ?? [])
      .filter((c) => typeof c.score === "number" && c.score < 5)
      .map((c) => `- ${c.name} (${c.score}점): ${c.reason ?? ""} → 개선: ${c.suggestion || "구체적으로 다시 작성"}`)
      .join("\n");
    const retryMessage = `${userMessage}

[검수 피드백 — 반드시 반영해서 전체를 다시 작성]
이전 시도가 검수를 통과하지 못했습니다 (합계 ${last.report.sum}/30, 자동검수: ${JSON.stringify(last.report.auto_checks)}).
${criteriaFeedback || "검수 기준 미달"}
전체 콘텐츠를 처음부터 다시 생성하세요.`;

    const retried = await callProvider(systemPrompt, retryMessage, maxTok);
    if (!retried) break;
    const next = await scoreOnce(retried);
    if (!next) break;
    attempts.push(next);
  }

  const best = attempts.reduce((a, b) => (attemptRank(b.report) > attemptRank(a.report) ? b : a));
  best.report.attempts = attempts.length;
  best.parsed.qc_report = best.report;
  return "```json\n" + JSON.stringify(best.parsed, null, 2) + "\n```";
}

// ─── 통합 파이프라인 엔진(runPipeline) 결과물에 인스타그램 전용 구조 검수를 덧씌운다 ───
// runPipeline.ts(공용 엔진)는 건드리지 않고, 그 결과를 넘겨받아 여기서만 기계적 검증
// (카드 수·items 개수·숫자 문구 일치·해시태그 자동 보정·JSON 파싱 재시도)을 적용한다.
// 다른 채널은 이 함수를 호출하지 않으므로 영향이 없다.
export async function runInstagramStructuralQc(
  channel: ChannelKey,
  content: string,
  topic: string,
  draft: string,
  provider: Provider,
  token?: string,
  apiKeyOverride?: string,
  modelOverride?: string
): Promise<string> {
  if (provider === "mock") return content;

  const systemPrompt = await buildSystemPrompt(channel, token).catch(() => "");
  if (!systemPrompt) return content;

  const meta = await getChannelMeta(channel, token).catch(() => null);

  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  const envModel = process.env[`${provider.toUpperCase()}_MODEL`]?.trim();
  let pc = envKey ? { apiKey: envKey, model: envModel || DEFAULT_MODELS[provider] } : null;
  if (!pc) pc = await loadAIConfig(token).then(c => c.providers[provider as ProviderKey]).catch(() => null);
  if (apiKeyOverride) pc = { apiKey: apiKeyOverride, model: pc?.model || envModel || DEFAULT_MODELS[provider] };
  if (modelOverride) pc = { apiKey: pc?.apiKey || apiKeyOverride || "", model: modelOverride };
  if (!pc?.apiKey) return content; // 키 없으면 검수 없이 파이프라인 결과 그대로 사용

  const userMessage = draft
    ? `위에 제공된 가이드 문서를 반드시 참고하여, 아래 작성자 초안을 바탕으로 ${channel} 채널에 맞는 완성된 콘텐츠를 작성해주세요.\n\n[주제]\n${topic}\n\n[작성자 초안]\n${draft}`
    : `위에 제공된 가이드 문서를 반드시 참고하여, 아래 주제로 ${channel} 채널에 맞는 콘텐츠를 작성해주세요.\n\n[주제]\n${topic}`;

  return runQcAndRegenerate(
    channel, content, systemPrompt, userMessage, provider, pc,
    meta?.maxTokens ?? 4096, meta?.disableThinking ?? false, token
  );
}

// ─── 단순 채널 콘텐츠 생성 (guide 파일만 있는 채널) ───────────
export async function generateContent(
  channel: ChannelKey,
  topic: string,
  draft: string,
  systemPrompt: string,
  provider: Provider,
  token?: string,
  suggestions?: string[],
  apiKeyOverride?: string,
  angle?: string,
  modelOverride?: string,
  improveDirection?: string
): Promise<string> {
  // 채널 설정(_meta.json)에서 생성 튜닝 로드 (없으면 코드 기본값)
  const meta = await getChannelMeta(channel, token).catch(() => null);

  const suggestionContext =
    suggestions && suggestions.length > 0
      ? `\n\n[참고 키워드 및 방향]\n${suggestions.map((s) => `- ${s}`).join("\n")}`
      : "";

  // 이미지 카드 가이드는 채널별 파일(data/channels/<채널>/image-card-guide.md)에서 로드한다.
  // 공용 파일로 획일 적용하지 않고 채널마다 독립적으로 관리한다.
  // _meta.json의 imageCards가 false인 채널(JSON 출력 등)은 아예 불러오지 않는다.
  let imageCardGuide = "";
  if (meta?.imageCards !== false) {
    try {
      const guideText = (await readChannelFile(channel, "image-card-guide.md", token)).trim();
      if (guideText) imageCardGuide = `\n\n${guideText}`;
    } catch {
      // 해당 채널에 image-card-guide.md가 없으면 이미지 카드 가이드 없이 진행 (정상)
    }
  }

  const angleContext = angle ? `\n\n[선택된 방향]\n${angle}` : "";
  // [M8 재개선] 사용자가 준 개선 방향(최우선 반영) — 레거시 경로에도 주입.
  const directionContext = improveDirection && improveDirection.trim()
    ? `\n\n[사용자 개선 방향 — 최우선 반영]\n${improveDirection.trim()}`
    : "";

  const userMessage = draft
    ? `위에 제공된 가이드 문서를 반드시 참고하여, 아래 작성자 초안을 바탕으로 ${channel} 채널에 맞는 완성된 콘텐츠를 작성해주세요. 가이드의 형식, 어조, 구조를 철저히 준수하세요.

[주제]
${topic}${suggestionContext}${angleContext}${directionContext}

[작성자 초안]
${draft}

위 초안의 핵심 메시지와 방향성을 유지하면서, 채널 가이드에 맞게 완성해주세요. [선택된 방향]이 명시되어 있다면 그 방향에 맞는 카드 흐름 구조를 채널 가이드에서 찾아 적용하세요. 단, 초안에 등장하는 구체적 수치가 출처 없는 것이라면 "예를 들어" 같은 표현으로 가상 예시임을 밝히고, 김 대리 같은 인물도 실존 인물처럼 단정하지 말고 가상의 예시로 서술하세요.

[중요] 이 요청에는 이미 작성자 초안이 포함되어 있습니다. 기획 방향(A/B/C) 제안 절차는 건너뛰고, 위 초안의 핵심 질문과 주장을 선택된 방향으로 간주하여 최종 완성 콘텐츠를 즉시 생성하세요. 방향을 묻거나 제안하는 응답은 하지 마세요.${imageCardGuide}`
    : `위에 제공된 가이드 문서를 반드시 참고하여, 아래 주제로 ${channel} 채널에 맞는 콘텐츠를 작성해주세요. 가이드의 형식과 규칙을 철저히 준수하세요.\n\n[주제]\n${topic}${suggestionContext}${directionContext}${imageCardGuide}`;

  if (provider !== "mock") {
    // Vercel 환경변수 우선 조회, 없으면 ai-config.json에서 조회
    const envKey = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
    const envModel = process.env[`${provider.toUpperCase()}_MODEL`]?.trim();
    let pc = envKey ? { apiKey: envKey, model: envModel || DEFAULT_MODELS[provider] } : null;

    if (!pc) {
      pc = await loadAIConfig(token).then(c => c.providers[provider as ProviderKey]).catch(() => null);
    }

    if (apiKeyOverride) {
      pc = { apiKey: apiKeyOverride, model: pc?.model || envModel || DEFAULT_MODELS[provider] };
    }

    if (modelOverride) {
      pc = { apiKey: pc?.apiKey || apiKeyOverride || "", model: modelOverride };
    }

    if (!pc?.apiKey) {
      throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
    }

    // 응답 길이·thinking은 _meta.json에서 (JSON 구조화 채널은 길게 + thinking off)
    const maxTok = meta?.maxTokens ?? 4096;
    const disableThinking = meta?.disableThinking ?? false;

    let firstPass: string;
    if (provider === "claude") firstPass = await callClaude(pc.apiKey, pc.model, systemPrompt, userMessage, maxTok);
    else if (provider === "openai") firstPass = await callOpenAI(pc.apiKey, pc.model, systemPrompt, userMessage);
    else if (provider === "gemini") firstPass = await callGemini(pc.apiKey, pc.model, systemPrompt, userMessage, maxTok, disableThinking);
    else return mockGenerate(channel, topic, systemPrompt ? `[가이드 ${Math.round(systemPrompt.length / 100)}백자]` : "");

    return await runQcAndRegenerate(
      channel, firstPass, systemPrompt, userMessage, provider,
      { apiKey: pc.apiKey, model: pc.model }, maxTok, disableThinking, token
    );
  }

  return mockGenerate(channel, topic, systemPrompt ? `[가이드 ${Math.round(systemPrompt.length / 100)}백자]` : "");
}

// ─── 네이버 블로그 멀티에이전트 파이프라인 ───────────────────
const WEB_PIPELINE_NOTE = readFileSync(join(dataRoot(), "data/prompts/web-pipeline-note.md"), "utf-8");

export async function runAgentPipeline(
  channel: ChannelKey,
  topic: string,
  userDraft: string,
  token: string | undefined,
  provider: Provider,
  statusCallback?: (status: string) => Promise<void>,
  apiKeyOverride?: string,
  // 이미지 카드가 실제 PNG로 캡처·업로드되면 호출자에게 전달(기존 반환 타입은 유지 — 다른 호출부에
  // 영향 없음). 콜백이 없으면 업로드 자체를 시도하지 않는다(예: 로컬 dev fallback 경로).
  onCardAssets?: (assets: CardAsset[]) => void,
  modelOverride?: string,
  improveDirection?: string
): Promise<string> {
  // 채널 설정(_meta.json) — 리서치/글쓰기 가이드 선택·순서를 여기서 읽는다 (하드코딩 금지)
  const meta = await getChannelMeta(channel, token).catch(() => null);

  // 채널 디렉토리의 모든 파일을 동적으로 로드 (가이드 관리에서 추가/수정된 파일 포함)
  const allFiles = await collectGuideFiles(channel, token);
  const fileContents: Record<string, string> = {};
  await Promise.all(
    allFiles.map(async k => {
      try {
        fileContents[k] = await readChannelFile(channel, k, token);
      } catch {
        console.warn(`[pipeline] ${channel}/${k} 로드 실패`);
      }
    })
  );

  const guideKeys = allFiles.filter(k => k.startsWith("guide/") && fileContents[k]);
  const loadedKeys = Object.keys(fileContents);
  const totalBytes = loadedKeys.reduce((s, k) => s + (fileContents[k]?.length ?? 0), 0);

  console.log(`[pipeline] ${channel}: 전체 ${loadedKeys.length}개 로드 (guide ${guideKeys.length}개, 총 ${totalBytes}바이트)`);
  if (guideKeys.length === 0) {
    console.warn(`[pipeline] ${channel}: 가이드 파일이 없습니다. 가이드 관리에서 파일을 추가해주세요.`);
  }

  // Mock 모드
  if (provider === "mock") {
    return mockGenerate(channel, topic, `[파이프라인 모의, 파일 ${Object.keys(fileContents).length}개]`) ?? "";
  }

  // Provider 인증 정보 조회
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  const envModel = process.env[`${provider.toUpperCase()}_MODEL`]?.trim();
  let pc = envKey ? { apiKey: envKey, model: envModel || DEFAULT_MODELS[provider] } : null;

  if (!pc) {
    pc = await loadAIConfig(token).then(c => c.providers[provider as ProviderKey]).catch(() => null);
  }

  if (apiKeyOverride) {
    pc = { apiKey: apiKeyOverride, model: pc?.model || envModel || DEFAULT_MODELS[provider] };
  }

  if (modelOverride) {
    pc = { apiKey: pc?.apiKey || apiKeyOverride || "", model: modelOverride };
  }

  if (!pc?.apiKey) {
    throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
  }

  // 섹션 조립 헬퍼
  const sec = (key: string) =>
    fileContents[key]
      ? `\n\n${"=".repeat(60)}\n# ${key}\n${"=".repeat(60)}\n\n${fileContents[key]}`
      : "";

  // 단계별 AI 호출 헬퍼
  const step = async (
    system: string,
    user: string,
    maxTokens: number,
    useSearch = false,
    disableThinking = false
  ): Promise<string> => {
    if (provider === "gemini") {
      return useSearch
        ? callGeminiWithSearch(pc.apiKey, pc.model, system, user, disableThinking)
        : callGemini(pc.apiKey, pc.model, system, user, maxTokens, disableThinking);
    }
    if (provider === "claude") return callClaude(pc.apiKey, pc.model, system, user, maxTokens);
    if (provider === "openai") return callOpenAI(pc.apiKey, pc.model, system, user);
    return "";
  };

  // ── Step 1: Research ──────────────────────────────────────
  if (statusCallback) await statusCallback("researching");

  const researcherInstructions =
    fileContents["agents/researcher-web.md"] ??
    fileContents["agents/researcher.md"] ??
    "당신은 리서처입니다. 주제를 조사하고 research.md 형식으로 출력하세요.";

  // 리서치 단계에 넣을 가이드 — _meta.json의 researchGuides (없으면 코드 기본값)
  const RESEARCH_GUIDE_KEYS = new Set(
    meta?.researchGuides ?? ["guide/06-brand-cta-reference.md", "guide/08-naver-seo.md"]
  );
  const researchGuideKeys = guideKeys.filter(k => RESEARCH_GUIDE_KEYS.has(k));

  const researchSystem =
    WEB_PIPELINE_NOTE +
    researcherInstructions +
    researchGuideKeys.map(k => sec(k)).join("");

  const researchUser =
    `주제: ${topic}` +
    (userDraft ? `\n참고 초안 방향:\n${userDraft}` : "") +
    `\n\nresearch.md 형식으로 조사·분석 결과를 직접 출력하세요.`;

  console.log(`[pipeline] ${channel} Step 1: 리서치 시작`);
  let researchOutput: string;
  if (provider === "claude") {
    researchOutput = stripCodeFence(
      await callClaudeWithNativeSearch(pc.apiKey, pc.model, researchSystem, researchUser, 8192, (n) => {
        if (statusCallback) void statusCallback(`소스 ${n}개 검색 중`);
      })
    );
  } else {
    researchOutput = stripCodeFence(await step(researchSystem, researchUser, 8192, provider === "gemini"));
  }
  console.log(`[pipeline] ${channel} Step 1: 리서치 완료 (${researchOutput.length}자)`);
  saveDebug("step1_research", researchOutput);

  // ── Step 2: Write ─────────────────────────────────────────
  if (statusCallback) await statusCallback("writing");

  const writerInstructions = fileContents["agents/writer-web.md"];

  // 글쓰기 단계 가이드 배치 순서 — _meta.json의 writeOrder (없으면 코드 기본값).
  // 중요도 낮은 순 → 높은 순 (LLM은 프롬프트 뒷부분에 더 주목).
  const WRITE_GUIDE_ORDER = meta?.writeOrder ?? [
    "guide/04-image-guide.md",
    "guide/02-examples.md",
    "guide/03-quality-check.md",
    "guide/08-naver-seo.md",
    "guide/06-brand-cta-reference.md",
    "guide/07-recatch-style.md",
    "guide/01-writing-guide.md", // 핵심 규칙 — 가장 마지막에 배치
  ];
  const writeGuideKeys = [
    ...guideKeys.filter(k => !WRITE_GUIDE_ORDER.includes(k)),
    ...WRITE_GUIDE_ORDER.filter(k => guideKeys.includes(k)),
  ];

  let writeSystem: string;
  if (writerInstructions) {
    writeSystem =
      WEB_PIPELINE_NOTE +
      writerInstructions +
      writeGuideKeys.map(k => sec(k)).join("");
  } else {
    const writerFileList = writeGuideKeys
      .map((k, i) => `${i + 1}. ${k} → 아래 === 섹션에 전문 포함됨`)
      .join("\n");
    const writeFileReadyNote =
      `[웹 파이프라인 — 파일 제공 완료. 지금 바로 작성 시작]\n` +
      `writer.md의 '읽을 파일' 목록이 모두 이 시스템 프롬프트 안에 제공되어 있습니다:\n` +
      writerFileList + "\n" +
      `${writeGuideKeys.length + 1}. output/[주제]/research.md → 사용자 메시지의 [이전 단계 출력] 섹션\n\n` +
      `→ 모든 파일 제공 완료. '하나라도 빠지면 작성하지 않는다' 조건 충족됨. 지금 바로 전체 글 작성 시작.\n\n`;
    writeSystem =
      writeFileReadyNote +
      (fileContents["agents/writer.md"] ?? "당신은 블로그 글쓰기 전문가입니다.") +
      writeGuideKeys.map(k => sec(k)).join("");
  }

  const writeUser =
    `[주제]\n${topic}\n\n` +
    (improveDirection && improveDirection.trim() ? `[사용자 개선 방향 — 최우선 반영]\n${improveDirection.trim()}\n\n` : "") +
    `[이전 단계 출력 — research.md]\n${researchOutput}\n\n` +
    `위 리서치 결과와 시스템 프롬프트의 모든 가이드 파일 규칙을 철저히 적용해 블로그 초안을 작성하세요.\n` +
    `(분량·구조·톤·이모지·CTA·해시태그 등 모든 기준은 가이드 파일에 명시되어 있습니다)\n\n` +
    `[출력 형식 — 반드시 준수]\n` +
    `<!-- PUBLISH:START -->\n` +
    `[여기에 발행할 블로그 본문 전체. 제목으로 시작. 소제목은 이모지+단독행.]\n` +
    `<!-- PUBLISH:END -->\n\n` +
    `<!-- NOTES:START -->\n` +
    `[편집 메모, 대체 제목 A/B/C안, 강조 지정 표, 하네스 검증 결과]\n` +
    `<!-- NOTES:END -->`;

  console.log(`[pipeline] ${channel} Step 2: 글쓰기 시작`);
  const draftRaw = stripCodeFence(await step(writeSystem, writeUser, 24000));
  console.log(`[pipeline] ${channel} Step 2: 글쓰기 완료 (${draftRaw.length}자)`);
  saveDebug("step2_writer_raw", draftRaw);

  if (!draftRaw.trim()) throw new Error("[pipeline] 글쓰기 단계 결과가 비어 있습니다.");

  let draftOutput = draftRaw.includes("<!-- PUBLISH:START -->")
    ? draftRaw
    : `<!-- PUBLISH:START -->\n${draftRaw}\n<!-- PUBLISH:END -->`;

  // ── Step 2b: 자기검증 + 필요 시 1회 재작성 (Claude 전용) ──────
  if (provider === "claude") {
    if (statusCallback) await statusCallback("품질 검증 중");
    const rubric = fileContents["guide/03-quality-check.md"] ?? "";
    // 검증 페르소나는 data/channels/naver-blog/agents/verifier-web.md에서 로드 (하드코딩 금지).
    // 파일이 없으면 최소 폴백 스텁 사용.
    const verifierInstructions =
      fileContents["agents/verifier-web.md"] ??
      "당신은 콘텐츠 품질 검증 담당자입니다. 첫 줄에 정확히 'PASS' 또는 'FAIL'만 쓰고, FAIL인 경우 다음 줄부터 구체적 문제점을 불릿으로 나열하세요.";
    const verifySystem = verifierInstructions + "\n\n" + rubric;
    const verifyUser = `[검증 대상 원고]\n${draftOutput}`;

    try {
      const verifyResult = stripCodeFence(await callClaude(pc.apiKey, pc.model, verifySystem, verifyUser, 1024));
      saveDebug("step2b_verify", verifyResult);

      const firstLine = verifyResult.trim().split("\n")[0]?.trim().toUpperCase() ?? "";
      if (firstLine.startsWith("FAIL")) {
        if (statusCallback) await statusCallback("본문 보완 중 (재작성)");
        const issues = verifyResult.trim().split("\n").slice(1).join("\n");
        const revisionUser =
          writeUser +
          `\n\n[이전 원고]\n${draftOutput}\n\n[품질 검증 결과 — 아래 문제점을 반드시 해결하여 전체를 다시 작성하세요]\n${issues}`;
        const revisedRaw = stripCodeFence(await callClaude(pc.apiKey, pc.model, writeSystem, revisionUser, 24000));
        saveDebug("step2c_revision", revisedRaw);
        if (revisedRaw.trim()) {
          draftOutput = revisedRaw.includes("<!-- PUBLISH:START -->")
            ? revisedRaw
            : `<!-- PUBLISH:START -->\n${revisedRaw}\n<!-- PUBLISH:END -->`;
        }
      }
    } catch (e) {
      // 검증/재작성 실패는 파이프라인을 막지 않는다 — 원래 초안을 그대로 사용
      console.warn(`[pipeline] ${channel} Step 2b 검증/재작성 실패, 원래 초안 유지: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── Step 2.5: Image Making ────────────────────────────────
  const imageMarkers = [...draftOutput.matchAll(/\[IMAGE:\s*([^\]]+)\]/g)];
  let finalDraft = draftOutput;
  let replacedCards: string[] = [];

  const imageMakerInstructions =
    fileContents["agents/image-maker-web.md"] ??
    fileContents["agents/image-maker.md"];

  if (imageMarkers.length > 0 && imageMakerInstructions) {
    if (statusCallback) await statusCallback("making-images");

    const imageMakerSystem =
      WEB_PIPELINE_NOTE +
      imageMakerInstructions +
      sec("guide/04-image-guide.md") +
      sec("guide/06-brand-cta-reference.md") +
      sec("guide/01-writing-guide.md");

    const imageMakerUser =
      `[주제]\n${topic}\n\n` +
      `아래 입력 draft.md 전문에서 [IMAGE: ...] 마커(${imageMarkers.length}개)들의 설명에 부합하는 브랜드 카드 HTML+CSS 코드를 작성하세요.\n\n` +
      `[작성 규칙]\n` +
      `- 본문의 나머지 텍스트는 절대로 출력하지 마십시오.\n` +
      `- 오직 각 마커에 들어갈 HTML 카드 코드블록들만 순서대로 작성하십시오.\n` +
      `- 각 카드 코드블록은 반드시 \`<!-- CARD_START -->\` 와 \`<!-- CARD_END -->\` 마커로 감싸주십시오.\n` +
      `- **첫 번째 마커 (인덱스 0)**는 블로그 대표 썸네일이므로, 반드시 720x720px 크기에 파란색/하늘색 배경(#18A0E8)을 가진 **대표 이미지 (썸네일) 프레임**을 사용하여 작성하십시오.\n` +
      `- **두 번째 마커 이후 (인덱스 1 이상)**는 본문 요약 및 자료 카드들이므로, 반드시 800px 너비에 옅은 회색 배경(#F3F3F3)을 가진 **본문 이미지 브랜드 카드 프레임**을 사용하여 작성하십시오 (순백 #ffffff 금지 — 네이버 블로그 본문 배경도 흰색이라 카드 경계가 사라집니다).\n\n` +
      `[입력 draft.md 전문]\n${draftOutput}`;

    console.log(`[pipeline] ${channel} Step 2.5: 이미지 카드 작성 시작 (${imageMarkers.length}개 감지)`);
    const finalDraftRaw = stripCodeFence(await step(imageMakerSystem, imageMakerUser, 12000, false, true));
    console.log(`[pipeline] ${channel} Step 2.5: 이미지 카드 작성 완료 (${finalDraftRaw.length}자)`);
    saveDebug("step2.5_imagemaker_raw", finalDraftRaw);

    // 원래 draft에서 [IMAGE] 마커들을 플레이스홀더 <!-- HTML_CARD_X -->로 치환하고, 카드 배열에 저장.
    // 카드 개수가 마커 개수보다 적으면(응답 잘림 등) spliceImageCards가 예외를 던진다 —
    // 원본 [IMAGE: ...] 텍스트를 그대로 흘려보내지 않기 위함.
    const spliced = spliceImageCards(draftOutput, finalDraftRaw);
    finalDraft = spliced.draft;
    replacedCards.push(...spliced.cards);
    saveDebug("step2.5_imagemaker_final_draft", finalDraft);

    // 서버사이드 캡처(품질 확인·높이 게이트 + 실제 PNG 업로드). 어떤 이유로든 실패해도 기존
    // inline HTML 카드 흐름은 그대로 유지된다(폴백) — 이 블록은 finalDraft를 건드리지 않는다.
    try {
      const { captureCards } = await import("./pipeline/cardCapture");
      const { cards: captured, warnings } = await captureCards(spliced.cards);
      if (warnings.length > 0) {
        console.warn(`[pipeline] ${channel} Step 2.5 카드 높이 게이트 경고:\n  ${warnings.join("\n  ")}`);
      } else {
        console.log(`[pipeline] ${channel} Step 2.5 카드 높이 게이트 통과`);
      }
      if (onCardAssets) {
        const { uploadCards } = await import("./pipeline/cardStorage");
        const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const assets = await uploadCards(channel, jobId, captured);
        onCardAssets(assets);
      }
    } catch (e) {
      console.warn(`[pipeline] ${channel} Step 2.5 서버사이드 캡처/업로드 실패(폴백: inline HTML 유지) — ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── Step 3: Assembler (코드 기반 — LLM 호출 없음, 토큰 한도 없음) ──
  if (statusCallback) await statusCallback("assembling");

  console.log(`[pipeline] ${channel} Step 3: 조립 시작 (코드 기반)`);
  // HTML 셸 템플릿을 channelFiles(Supabase→GitHub→로컬)로 읽어 넘긴다 → 웹 수정 시 실시간 반영
  const shell = await readChannelFile(channel, "templates/blog-shell.html", token).catch(() => undefined);
  const assembled = assembleNaverBlogHtml(finalDraft, shell);
  if (assembled === null) {
    console.warn(`[pipeline] ${channel} Step 3: 조립 불가(마커 누락/품질 게이트 FAIL) — draft 원문 반환`);
    return draftOutput;
  }
  let finalHtml = assembled;
  console.log(`[pipeline] ${channel} Step 3: 조립 완료 (${finalHtml.length}자)`);
  saveDebug("step3_assembled_html", finalHtml);

  // 조립된 최종 HTML에서 플레이스홀더들을 실제 HTML 카드 코드로 치환 복원!
  replacedCards.forEach((cardHtml, idx) => {
    finalHtml = finalHtml.replace(new RegExp(`<!--\\s*HTML_CARD_${idx}\\s*-->`, "g"), cardHtml);
  });
  saveDebug("step3_final_html", finalHtml);

  return finalHtml;
}
