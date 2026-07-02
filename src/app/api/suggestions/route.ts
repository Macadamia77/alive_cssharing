import { NextRequest, NextResponse } from "next/server";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";
import { loadAIConfig, type ProviderKey } from "@/lib/aiConfig";
import { resolveGithubToken } from "@/lib/resolveToken";
import { callClaude, callOpenAI, callGemini } from "@/lib/apiClients";
import { readFileSync } from "fs";
import { join } from "path";
import { dataRoot } from "@/lib/dataRoot";

const MOCK_SUGGESTIONS = [
  "비용 절감 효과 비교",
  "중소기업 도입 사례",
  "24시간 고객 응대 자동화",
  "AI 챗봇 연동 방법",
  "서비스 품질 KPI 관리",
  "콜센터 운영 효율화",
  "고객 만족도 향상 전략",
  "아웃소싱 업체 선정 기준",
];

const SYSTEM_PROMPT = readFileSync(join(dataRoot(), "data/prompts/suggestions.md"), "utf-8");

function buildUserMessage(topic: string): string {
  return (
    `주제: "${topic}"\n\n` +
    `이 주제로 CS쉐어링의 마케팅 콘텐츠를 만들려고 합니다.\n` +
    `이 주제와 관련하여 마케팅에 활용할 수 있는 관련 주제, 핵심 키워드, 내용 방향을 7~9개 추천해주세요.\n\n` +
    `각 항목은:\n` +
    `- 한국어로 간결하게 (5~20자)\n` +
    `- 구체적이고 실용적인 내용\n` +
    `- 다양한 관점 포함 (비용, 효과, 사례, 비교, 방법론, 타깃 고객 등)\n\n` +
    `JSON 배열만 출력하세요: ["항목1", "항목2", ...]`
  );
}

function parseJsonArray(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return MOCK_SUGGESTIONS;
  try {
    const arr = JSON.parse(match[0]) as unknown[];
    const result = arr.filter((x): x is string => typeof x === "string");
    return result.length > 0 ? result : MOCK_SUGGESTIONS;
  } catch {
    return MOCK_SUGGESTIONS;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { topic, provider: providerOverride } = (await req.json()) as {
      topic: string;
      provider?: string;
    };

    if (!topic?.trim()) {
      return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });
    }

    const provider = (providerOverride ?? resolveActiveProvider(req)) as ProviderKey | "mock";

    if (provider === "mock") {
      return NextResponse.json({ suggestions: MOCK_SUGGESTIONS });
    }

    const pc =
      resolveProvider(req, provider as ProviderKey) ??
      (await loadAIConfig(resolveGithubToken(req))
        .then((c) => c.providers[provider as ProviderKey])
        .catch(() => null));

    if (!pc?.apiKey) {
      return NextResponse.json(
        { error: `${provider} API 키가 설정되지 않았습니다.` },
        { status: 400 }
      );
    }

    let raw: string;
    if (provider === "claude") raw = await callClaude(pc.apiKey, pc.model, SYSTEM_PROMPT, buildUserMessage(topic.trim()), 512);
    else if (provider === "openai") raw = await callOpenAI(pc.apiKey, pc.model, SYSTEM_PROMPT, buildUserMessage(topic.trim()));
    else raw = await callGemini(pc.apiKey, pc.model, SYSTEM_PROMPT, buildUserMessage(topic.trim()), 512);

    return NextResponse.json({ suggestions: parseJsonArray(raw) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "추천 생성 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
