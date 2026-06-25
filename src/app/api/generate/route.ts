import { NextRequest, NextResponse } from "next/server";
import { CHANNELS, type ChannelKey } from "@/lib/channels";
import { buildSystemPrompt } from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";
import { loadAIConfig, type Provider } from "@/lib/aiConfig";

// ─── Claude API ───────────────────────────────────────────────
async function callClaude(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const block = data.content?.[0];
  if (block?.type === "text") return block.text as string;
  throw new Error("Claude API 응답 형식 오류");
}

// ─── OpenAI API ───────────────────────────────────────────────
async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
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
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `OpenAI API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  throw new Error("OpenAI API 응답 형식 오류");
}

// ─── Gemini API ───────────────────────────────────────────────
async function callGemini(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
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
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text === "string") return text;
  throw new Error("Gemini API 응답 형식 오류");
}

// ─── Mock 생성기 ──────────────────────────────────────────────
function mockGenerate(channel: ChannelKey, topic: string, systemPrompt: string): string {
  const guideLen = Math.round(systemPrompt.length / 100);
  const guideHint = guideLen > 0 ? `[가이드 ${guideLen}백자 로드]` : "[가이드 없음]";

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

// ─── 채널별 콘텐츠 생성 ───────────────────────────────────────
async function generateContent(
  channel: ChannelKey,
  topic: string,
  draft: string,
  systemPrompt: string,
  providerOverride?: string
): Promise<string> {
  const config = await loadAIConfig();
  const provider = (providerOverride ?? config.activeProvider) as Provider;

  const userMessage = draft
    ? `위에 제공된 가이드 문서를 반드시 참고하여, 아래 작성자 초안을 바탕으로 ${channel} 채널에 맞는 완성된 콘텐츠를 작성해주세요. 가이드의 형식, 어조, 구조를 철저히 준수하세요.

[주제]
${topic}

[작성자 초안]
${draft}

위 초안의 핵심 메시지와 방향성을 유지하면서, 채널 가이드에 맞게 완성해주세요.`
    : `위에 제공된 가이드 문서를 반드시 참고하여, 아래 주제로 ${channel} 채널에 맞는 콘텐츠를 작성해주세요. 가이드의 형식과 규칙을 철저히 준수하세요.\n\n[주제]\n${topic}`;

  if (provider === "claude") {
    if (!config.providers.claude.apiKey)
      throw new Error("Claude API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
    return callClaude(config.providers.claude.apiKey, config.providers.claude.model, systemPrompt, userMessage);
  }

  if (provider === "openai") {
    if (!config.providers.openai.apiKey)
      throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
    return callOpenAI(config.providers.openai.apiKey, config.providers.openai.model, systemPrompt, userMessage);
  }

  if (provider === "gemini") {
    if (!config.providers.gemini.apiKey)
      throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
    return callGemini(config.providers.gemini.apiKey, config.providers.gemini.model, systemPrompt, userMessage);
  }

  return mockGenerate(channel, topic, systemPrompt);
}

// ─── POST /api/generate ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { topic, draft = "", channels: requestedChannels, provider: providerOverride } = await req.json() as {
      topic: string;
      draft?: string;
      channels?: string[];
      provider?: string;
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
        const systemPrompt = await buildSystemPrompt(channel, token);
        const content = await generateContent(channel, topic.trim(), draft, systemPrompt, providerOverride);
        return { channel, content };
      })
    );

    return NextResponse.json({ topic: topic.trim(), results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "콘텐츠 생성에 실패했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
