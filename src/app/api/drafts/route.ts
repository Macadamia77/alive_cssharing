import { NextRequest, NextResponse } from "next/server";
import { loadAIConfig, type Provider, type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";
import { resolveGithubToken } from "@/lib/resolveToken";
import { callClaude, callOpenAI, callGemini } from "@/lib/apiClients";
import { readFileSync } from "fs";
import { join } from "path";
import { dataRoot } from "@/lib/dataRoot";
import { guard } from "@/lib/authGate";

const DRAFTS_SYSTEM = readFileSync(join(dataRoot(), "data/prompts/drafts.md"), "utf-8");

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
  const denied = await guard();
  if (denied) return denied;
  try {
    const { topic, provider: providerOverride } = await req.json() as { topic: string; provider?: string };
    if (!topic?.trim()) return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });

    const provider = (providerOverride ?? resolveActiveProvider(req)) as Provider;

    if (provider === "mock") {
      return NextResponse.json({ drafts: mockDrafts(topic.trim()) });
    }

    const pc = resolveProvider(req, provider as ProviderKey)
      ?? await loadAIConfig(resolveGithubToken(req)).then(c => c.providers[provider as ProviderKey]).catch(() => null);

    if (!pc?.apiKey) {
      return NextResponse.json(
        { error: `${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.` },
        { status: 400 }
      );
    }

    const user = `주제: "${topic.trim()}"\n\n위 주제로 마케팅 콘텐츠 초안 3가지를 JSON 형식으로 작성해주세요.`;

    let raw: string;
    if (provider === "claude") raw = await callClaude(pc.apiKey, pc.model, DRAFTS_SYSTEM, user, 3000);
    else if (provider === "openai") raw = await callOpenAI(pc.apiKey, pc.model, DRAFTS_SYSTEM, user);
    else raw = await callGemini(pc.apiKey, pc.model, DRAFTS_SYSTEM, user, 3000);

    return NextResponse.json({ drafts: parseDrafts(raw, topic.trim()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
