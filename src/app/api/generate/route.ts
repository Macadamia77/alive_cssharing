import { NextRequest, NextResponse } from "next/server";
import { CHANNELS, type ChannelKey } from "@/lib/channels";
import { buildSystemPrompt, hasAgentPipeline, collectGuideFiles, readChannelFile } from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";
import { loadAIConfig, type Provider, type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";

export const maxDuration = 300;

// ─── Claude API ───────────────────────────────────────────────
async function callClaude(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 4096
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { content?: Array<{ type: string; text: string }> };
  const block = data.content?.[0];
  if (block?.type === "text") return block.text;
  throw new Error("Claude API 응답 형식 오류");
}

// ─── OpenAI API ───────────────────────────────────────────────
async function callOpenAI(
  apiKey: string, model: string, systemPrompt: string, userMessage: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  throw new Error("OpenAI API 응답 형식 오류");
}

// ─── Gemini API ───────────────────────────────────────────────
async function callGemini(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxOutputTokens = 4096
): Promise<string> {
  const fullModel = model || "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${fullModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  if (text) return text;
  throw new Error("Gemini API 응답 형식 오류");
}

// ─── Gemini + Google Search (리서치 단계 전용) ────────────────
async function callGeminiWithSearch(
  apiKey: string, model: string, systemPrompt: string, userMessage: string
): Promise<string> {
  const fullModel = model || "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${fullModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 4096 },
        tools: [{ google_search: {} }],
      }),
    }
  );
  if (!res.ok) {
    // 검색 도구 오류 시 일반 Gemini로 폴백
    console.warn("[pipeline/research] Gemini Search 실패, 일반 모드로 재시도");
    return callGemini(apiKey, model, systemPrompt, userMessage, 4096);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  if (text) return text;
  // 응답이 비어있으면 폴백
  return callGemini(apiKey, model, systemPrompt, userMessage, 4096);
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

    case "facebook":
      return `${topic}, 여러분 기업에서는 어떻게 접근하고 계신가요?

CS쉐어링이 정리한 핵심 인사이트:

1️⃣ 현황 파악 — 데이터 기반으로 정확히 진단
2️⃣ 전략 수립 — 기업 규모와 상황에 맞게 설계
3️⃣ 실행과 개선 — 지속적인 모니터링으로 성과 확보

여러분 기업에서 ${topic}과 관련해 가장 어려운 점은 무엇인가요? 💬`;

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

// ─── 단순 채널 콘텐츠 생성 (guide 파일만 있는 채널) ───────────
async function generateContent(
  req: NextRequest,
  channel: ChannelKey,
  topic: string,
  draft: string,
  systemPrompt: string,
  providerOverride?: string,
  suggestions?: string[]
): Promise<string> {
  const provider = (providerOverride ?? resolveActiveProvider(req)) as Provider;

  const suggestionContext =
    suggestions && suggestions.length > 0
      ? `\n\n[참고 키워드 및 방향]\n${suggestions.map((s) => `- ${s}`).join("\n")}`
      : "";

  // 채널별 이미지 카드 안내 (이미지가 있는 채널 가이드에 맞게 AI가 직접 HTML 카드 생성)
  const imageCardGuide = `

[이미지 카드]
콘텐츠에 이미지/인포그래픽이 필요한 위치에는 아래 형식의 HTML 카드를 직접 삽입하세요.
(CS쉐어링 B2B 맥락: 콜센터·CS 운영·기업 담당자 소재만 사용, 소비재·생활 이미지 금지)
<figure style="font-family:'맑은 고딕','Malgun Gothic',sans-serif;background:#fff;border:1px solid #e0e8f0;border-radius:10px;padding:24px 28px;margin:20px 0;box-shadow:0 2px 8px rgba(30,144,214,0.07);">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
    <div style="width:3px;height:14px;background:#1e90d6;border-radius:2px;"></div>
    <span style="font-size:12px;color:#aaa;">CS쉐어링</span>
  </div>
  <div style="font-size:22px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">[헤드라인 1행]</div>
  <div style="font-size:22px;font-weight:700;color:#1e90d6;margin-bottom:16px;">[핵심 메시지 2행]</div>
  [내용: 번호 목록 / 비교표 / 소제목 요약 등 — 내용에 맞게 선택]
  <div style="background:#1e90d6;color:#fff;text-align:center;padding:13px;border-radius:7px;font-size:15px;font-weight:700;margin-top:20px;">CS쉐어링 문의 ☎ 1522-5539</div>
  <div style="text-align:right;font-size:11px;color:#ccc;margin-top:10px;letter-spacing:0.5px;">CS Sharing</div>
</figure>`;

  const userMessage = draft
    ? `위에 제공된 가이드 문서를 반드시 참고하여, 아래 작성자 초안을 바탕으로 ${channel} 채널에 맞는 완성된 콘텐츠를 작성해주세요. 가이드의 형식, 어조, 구조를 철저히 준수하세요.

[주제]
${topic}${suggestionContext}

[작성자 초안]
${draft}

위 초안의 핵심 메시지와 방향성을 유지하면서, 채널 가이드에 맞게 완성해주세요.${imageCardGuide}`
    : `위에 제공된 가이드 문서를 반드시 참고하여, 아래 주제로 ${channel} 채널에 맞는 콘텐츠를 작성해주세요. 가이드의 형식과 규칙을 철저히 준수하세요.\n\n[주제]\n${topic}${suggestionContext}${imageCardGuide}`;

  if (provider !== "mock") {
    const pc = resolveProvider(req, provider as ProviderKey)
      ?? await loadAIConfig().then(c => c.providers[provider as ProviderKey]).catch(() => null);

    if (!pc?.apiKey) {
      throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
    }

    if (provider === "claude") return callClaude(pc.apiKey, pc.model, systemPrompt, userMessage);
    if (provider === "openai") return callOpenAI(pc.apiKey, pc.model, systemPrompt, userMessage);
    if (provider === "gemini") return callGemini(pc.apiKey, pc.model, systemPrompt, userMessage);
  }

  return mockGenerate(channel, topic, systemPrompt ? `[가이드 ${Math.round(systemPrompt.length / 100)}백자]` : "");
}

// ─── 네이버 블로그 멀티에이전트 파이프라인 ───────────────────
// blog/ 폴더의 researcher → writer → image-maker → assembler 흐름을 웹에서 재현
const WEB_PIPELINE_NOTE = `[웹 파이프라인 환경]
파일 저장/읽기 작업 없이 결과 텍스트를 직접 출력합니다.
이전 단계 결과는 [이전 단계 출력] 섹션으로 제공됩니다.

`;

async function runAgentPipeline(
  req: NextRequest,
  channel: ChannelKey,
  topic: string,
  userDraft: string,
  token: string | undefined,
  providerOverride?: string
): Promise<string> {
  const provider = (providerOverride ?? resolveActiveProvider(req)) as Provider;

  // 필요한 파일 목록 (agent + guide)
  const needed = [
    "agents/researcher.md",
    "agents/writer.md",
    "agents/image-maker.md",
    "agents/assembler.md",
    "guide/01-writing-guide.md",
    "guide/02-examples.md",
    "guide/03-quality-check.md",
    "guide/04-image-guide.md",
    "guide/06-brand-cta-reference.md",
    "guide/07-recatch-style.md",
    "guide/08-naver-seo.md",
  ];

  // 존재하는 파일만 병렬 로드 (가이드 관리에서 최신 버전 사용)
  const allFiles = await collectGuideFiles(channel, token);
  const fileContents: Record<string, string> = {};
  await Promise.all(
    needed
      .filter(k => allFiles.includes(k))
      .map(async k => {
        try {
          fileContents[k] = await readChannelFile(channel, k, token);
        } catch {
          console.warn(`[pipeline] ${channel}/${k} 로드 실패`);
        }
      })
  );

  console.log(`[pipeline] ${channel}: 파일 ${Object.keys(fileContents).length}개 로드`);

  // Mock 모드
  if (provider === "mock") {
    return mockGenerate(channel, topic, `[파이프라인 모의, 파일 ${Object.keys(fileContents).length}개]`) ?? "";
  }

  // Provider 인증
  const pc = resolveProvider(req, provider as ProviderKey)
    ?? await loadAIConfig().then(c => c.providers[provider as ProviderKey]).catch(() => null);
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
    useSearch = false
  ): Promise<string> => {
    if (provider === "gemini") {
      return useSearch
        ? callGeminiWithSearch(pc.apiKey, pc.model, system, user)
        : callGemini(pc.apiKey, pc.model, system, user, maxTokens);
    }
    if (provider === "claude") return callClaude(pc.apiKey, pc.model, system, user, maxTokens);
    if (provider === "openai") return callOpenAI(pc.apiKey, pc.model, system, user);
    return "";
  };

  // ── Step 1: Research ──────────────────────────────────────
  // researcher.md 지침 + guide/06(서비스 카탈로그) + guide/08(SEO 키워드)
  const researchSystem =
    WEB_PIPELINE_NOTE +
    (fileContents["agents/researcher.md"] ?? "") +
    sec("guide/06-brand-cta-reference.md") +
    sec("guide/08-naver-seo.md");

  const researchUser =
    `주제: ${topic}` +
    (userDraft ? `\n참고 초안 방향:\n${userDraft}` : "") +
    `\n\nresearch.md 형식으로 조사·분석 결과를 직접 출력하세요. 파일 저장 없이 텍스트로 출력합니다.`;

  console.log(`[pipeline] ${channel} Step 1: 리서치 시작`);
  const researchOutput = await step(researchSystem, researchUser, 4096, provider === "gemini");
  console.log(`[pipeline] ${channel} Step 1: 리서치 완료 (${researchOutput.length}자)`);

  // ── Step 2: Write ─────────────────────────────────────────
  // writer.md 지침 + guide/01,02,03,06,07,08 + 리서치 결과
  const writeSystem =
    WEB_PIPELINE_NOTE +
    (fileContents["agents/writer.md"] ?? "") +
    sec("guide/01-writing-guide.md") +
    sec("guide/02-examples.md") +
    sec("guide/03-quality-check.md") +
    sec("guide/06-brand-cta-reference.md") +
    sec("guide/07-recatch-style.md") +
    sec("guide/08-naver-seo.md");

  const writeUser =
    `[주제]\n${topic}\n\n` +
    `[이전 단계 출력 — research.md]\n${researchOutput}\n\n` +
    `위 리서치 결과를 바탕으로 draft.md 형식(PUBLISH 블록 + NOTES 블록)으로 블로그 초안을 작성하세요. ` +
    `파일 저장 없이 전체 내용을 직접 출력하세요.`;

  console.log(`[pipeline] ${channel} Step 2: 글쓰기 시작`);
  const draftOutput = await step(writeSystem, writeUser, 8000);
  console.log(`[pipeline] ${channel} Step 2: 글쓰기 완료 (${draftOutput.length}자)`);

  if (!draftOutput.trim()) throw new Error("[pipeline] 글쓰기 단계 결과가 비어 있습니다.");

  // ── Step 2.5: Image Making ────────────────────────────────
  // image-maker.md 지침으로 [IMAGE: 설명] 마커를 HTML+CSS 카드로 치환
  // Python/Playwright 없이 AI가 HTML+CSS를 직접 생성 → 브라우저에서 동일하게 렌더링
  const imageMarkers = [...draftOutput.matchAll(/\[IMAGE:\s*([^\]]+)\]/g)];
  let finalDraft = draftOutput;

  if (imageMarkers.length > 0 && fileContents["agents/image-maker.md"]) {
    const imageMakerSystem =
      `[웹 파이프라인 환경 — HTML+CSS 카드 직접 출력 모드]\n` +
      `Playwright/PNG 렌더링 대신, 각 [IMAGE: ...] 마커를 04-image-guide.md의 브랜드 카드 HTML+CSS로 직접 교체합니다.\n` +
      `브랜드 PNG 파일은 웹에서 직접 로드 불가이므로 캐릭터 자리는 스타일된 텍스트/이모지로 처리하세요.\n` +
      `색상: 썸네일 배경 #18A0E8, 카드 강조 #1e90d6, 남색 #2c4a7c\n\n` +
      WEB_PIPELINE_NOTE +
      (fileContents["agents/image-maker.md"] ?? "") +
      sec("guide/04-image-guide.md") +
      sec("guide/01-writing-guide.md") +
      sec("guide/06-brand-cta-reference.md");

    const imageMakerUser =
      `[주제]\n${topic}\n\n` +
      `아래 draft.md에서 [IMAGE: ...] 마커(${imageMarkers.length}개)를 04-image-guide.md의 브랜드 카드 HTML+CSS로 교체하세요.\n` +
      `규칙:\n` +
      `- 첫 번째 이미지 또는 "썸네일" 키워드: 720×720px 카드, 배경 #18A0E8(스카이블루), 제목·부제 흰색\n` +
      `- 소제목 요약 카드(소제목마다 1장 필수): 800px, 브랜드 카드 템플릿\n` +
      `- 나머지 이미지: 내용에 맞는 타입 선택(번호카드/비교표/배지카드 등)\n` +
      `- 모든 카드 하단에 파란 CTA 버튼 + CS Sharing 워터마크 포함\n` +
      `- PUBLISH/NOTES 블록 마커와 나머지 텍스트는 그대로 유지\n` +
      `- 수정된 전체 draft.md를 출력하세요\n\n` +
      `[draft.md]\n${draftOutput}`;

    console.log(`[pipeline] ${channel} Step 2.5: 이미지 제작 시작 (마커 ${imageMarkers.length}개)`);
    const draftWithImages = await step(imageMakerSystem, imageMakerUser, 8000);

    if (draftWithImages.trim()) {
      finalDraft = draftWithImages;
      console.log(`[pipeline] ${channel} Step 2.5: 이미지 제작 완료 (${finalDraft.length}자)`);
    } else {
      console.warn(`[pipeline] ${channel} Step 2.5: 결과 없음, 이전 draft 사용`);
    }
  } else {
    console.log(`[pipeline] ${channel} Step 2.5: 이미지 마커 없음 또는 image-maker.md 없음, 생략`);
  }

  // ── Step 3: Assemble ──────────────────────────────────────
  // assembler.md 지침 + guide/01(렌더링 규칙) + 이미지 카드 포함 draft 결과
  const assembleSystem =
    WEB_PIPELINE_NOTE +
    `NOTES 블록이 없어도 PUBLISH 블록만으로 HTML을 생성하세요.\n` +
    `초안에 이미 HTML+CSS 이미지 카드(<figure>, <div> 등)가 포함된 경우 그대로 유지하세요.\n` +
    `남아있는 [IMAGE: ...] 마커는 아래 placeholder로 처리하세요:\n` +
    `<div style="background:#f0f4ff;border:1.5px dashed #2c4a7c;border-radius:10px;padding:28px;text-align:center;margin:24px 0;"><span style="color:#2c4a7c;font-size:14px;">📷 이미지 자리</span></div>\n\n` +
    (fileContents["agents/assembler.md"] ?? "") +
    sec("guide/01-writing-guide.md");

  const assembleUser =
    `[주제]\n${topic}\n\n` +
    `[이전 단계 출력 — draft.md (이미지 카드 포함)]\n${finalDraft}\n\n` +
    `위 초안을 assembler.md 지침에 따라 완성된 HTML로 변환하세요. ` +
    `초안 내 HTML 이미지 카드는 그대로 유지하고, PUBLISH 블록 전체를 HTML로 완성하여 출력하세요.`;

  console.log(`[pipeline] ${channel} Step 3: 조립 시작`);
  const finalHtml = await step(assembleSystem, assembleUser, 8000);
  console.log(`[pipeline] ${channel} Step 3: 조립 완료 (${finalHtml.length}자)`);

  // 조립 결과가 비어 있으면 draft 반환 (graceful fallback)
  return finalHtml.trim() || draftOutput;
}

// ─── POST /api/generate ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      topic,
      draft = "",
      channels: requestedChannels,
      provider: providerOverride,
      suggestions,
    } = (await req.json()) as {
      topic: string;
      draft?: string;
      channels?: string[];
      provider?: string;
      suggestions?: string[];
    };

    if (!topic?.trim()) {
      return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });
    }

    const targetChannels: ChannelKey[] = Array.isArray(requestedChannels)
      ? requestedChannels.filter((c): c is ChannelKey => CHANNELS.includes(c as ChannelKey))
      : [...CHANNELS];

    if (targetChannels.length === 0) {
      return NextResponse.json({ error: "채널을 하나 이상 선택해주세요." }, { status: 400 });
    }

    const token = resolveGithubToken(req);

    const results = await Promise.all(
      targetChannels.map(async (channel) => {
        // 멀티에이전트 파이프라인 여부 확인 (agents/researcher.md 존재 시)
        const isPipeline = await hasAgentPipeline(channel, token);

        if (isPipeline) {
          // blog/폴더와 동일한 researcher → writer → assembler 파이프라인
          const content = await runAgentPipeline(
            req, channel, topic.trim(), draft, token, providerOverride
          );
          return { channel, content, pipeline: true };
        }

        // 단순 가이드 기반 생성 (guide.md만 있는 채널)
        const systemPrompt = await buildSystemPrompt(channel, token);
        if (!systemPrompt) {
          console.warn(`[generate] ${channel}: 가이드를 로드하지 못했습니다.`);
        }
        const content = await generateContent(
          req, channel, topic.trim(), draft, systemPrompt, providerOverride, suggestions
        );
        return { channel, content, pipeline: false };
      })
    );

    return NextResponse.json({ topic: topic.trim(), results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "콘텐츠 생성에 실패했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
