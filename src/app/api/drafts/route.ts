import { NextRequest, NextResponse } from "next/server";
import { loadAIConfig, type Provider, type ProviderKey } from "@/lib/aiConfig";

async function callAI(
  provider: ProviderKey,
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  if (provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message ?? `Claude API 오류 (${res.status})`); }
    const d = await res.json();
    return (d.content?.[0]?.text as string) ?? "";
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || "gpt-4o",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message ?? `OpenAI API 오류 (${res.status})`); }
    const d = await res.json();
    return (d.choices?.[0]?.message?.content as string) ?? "";
  }

  if (provider === "gemini") {
    const fullModel = model || "gemini-2.5-flash";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${fullModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 3000 },
        }),
      }
    );
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message ?? `Gemini API 오류 (${res.status})`); }
    const d = await res.json();
    return (d.candidates?.[0]?.content?.parts?.[0]?.text as string) ?? "";
  }

  throw new Error("mock");
}

export interface DraftItem {
  angle: string;
  title: string;
  body: string;
}

function mockDrafts(topic: string): DraftItem[] {
  return [
    {
      angle: "정보 전달형",
      title: `${topic}의 핵심 포인트 3가지`,
      body: `많은 기업들이 ${topic}에 대해 고민하고 있습니다. 하지만 어디서부터 시작해야 할지 막막한 경우가 많죠.

CS쉐어링이 정리한 핵심 포인트 3가지:

1. 현황 파악이 먼저입니다 — 데이터 기반으로 현재 상태를 정확히 진단해야 합니다.
2. 전문 파트너가 필요합니다 — 혼자보다 전문가와 함께할 때 훨씬 빠른 성과를 낼 수 있습니다.
3. 지속적인 모니터링이 답입니다 — 한 번의 변화로 끝나는 것이 아니라 꾸준한 관리가 중요합니다.

${topic}, CS쉐어링과 함께라면 걱정 없습니다.`,
    },
    {
      angle: "감성 스토리텔링형",
      title: `${topic}을 경험한 기업들의 이야기`,
      body: `"처음엔 막막했는데, 지금은 달라졌어요."

${topic}을 도입하기 전과 후, 많은 기업들이 이런 말을 합니다.

한 중소기업 대표님의 이야기를 들어보겠습니다. 인력 부족과 비용 부담으로 고객 응대에 어려움을 겪던 그분은, CS쉐어링과 함께한 후 고객 만족도가 눈에 띄게 올라갔다고 말씀하셨습니다.

작은 변화 하나가 기업 전체를 바꿉니다. 여러분의 이야기도 달라질 수 있습니다.`,
    },
    {
      angle: "문제 해결형",
      title: `${topic}, 지금 해결할 수 있습니다`,
      body: `지금 이 순간에도 ${topic} 때문에 고민하고 계신가요?

문제는 분명합니다. 비용은 늘어나고, 인력은 부족하고, 고객 불만은 쌓여가고 있죠.

해결책도 분명합니다.

✅ 전문 아웃소싱으로 고정비 절감
✅ 24시간 고객 대응 체계 구축
✅ 데이터 기반 VOC 분석과 개선

CS쉐어링은 ${topic}의 완벽한 해결책을 제공합니다. 지금 바로 상담해보세요.`,
    },
  ];
}

function parseDrafts(raw: string, topic: string): DraftItem[] {
  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\])/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]) as DraftItem[];
      if (Array.isArray(parsed) && parsed.length >= 2) return parsed.slice(0, 3);
    }
  } catch { /* fall through */ }

  const sections = raw.split(/(?:초안\s*[1-3]|##\s*[1-3])[.:)]\s*/i).filter(Boolean);
  if (sections.length >= 2) {
    const angles = ["정보 전달형", "감성 스토리텔링형", "문제 해결형"];
    return sections.slice(0, 3).map((sec, i) => {
      const lines = sec.trim().split("\n");
      const title = lines[0].replace(/^#+\s*/, "").trim() || `${topic} 초안 ${i + 1}`;
      const body = lines.slice(1).join("\n").trim();
      return { angle: angles[i] ?? `초안 ${i + 1}`, title, body };
    });
  }

  return mockDrafts(topic);
}

export async function POST(req: NextRequest) {
  try {
    const { topic, provider: providerOverride } = await req.json() as { topic: string; provider?: string };
    if (!topic?.trim()) return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });

    const config = await loadAIConfig();
    const provider = (providerOverride ?? config.activeProvider) as Provider;

    if (provider === "mock") {
      return NextResponse.json({ drafts: mockDrafts(topic.trim()) });
    }

    const pc = config.providers[provider as ProviderKey];
    if (!pc?.apiKey) {
      return NextResponse.json({ drafts: mockDrafts(topic.trim()) });
    }

    const system = `당신은 마케팅 콘텐츠 전략가입니다. 주어진 주제로 3가지 서로 다른 각도의 초안을 작성합니다.
각 초안은 다음 JSON 배열 형식으로 반환하세요:
[
  { "angle": "초안 유형 (예: 정보 전달형)", "title": "제목", "body": "본문 (2~4 문단)" },
  ...
]
초안은 서로 다른 방향성(정보형, 스토리형, 문제해결형 등)을 가져야 하며, CS쉐어링 마케팅에 활용될 것입니다.`;

    const user = `주제: "${topic.trim()}"\n\n위 주제로 마케팅 콘텐츠 초안 3가지를 JSON 형식으로 작성해주세요.`;

    try {
      const raw = await callAI(provider as ProviderKey, pc.apiKey, pc.model, system, user);
      const drafts = parseDrafts(raw, topic.trim());
      return NextResponse.json({ drafts });
    } catch {
      return NextResponse.json({ drafts: mockDrafts(topic.trim()) });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
