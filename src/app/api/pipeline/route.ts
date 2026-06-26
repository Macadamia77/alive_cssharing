import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { readChannelFile, collectGuideFiles, isTextFile } from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";
import { loadAIConfig, type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";

// Vercel Pro: allow up to 300s for long AI generation steps
export const maxDuration = 300;

const STEP_AGENTS: Record<string, string> = {
  research: "agents/researcher.md",
  write: "agents/writer.md",
  assemble: "agents/assembler.md",
};

async function buildStepSystemPrompt(
  channel: ChannelKey,
  step: string,
  token?: string
): Promise<string> {
  const agentFile = STEP_AGENTS[step];

  let agentContent: string;
  try {
    agentContent = await readChannelFile(channel, agentFile, token);
  } catch {
    throw new Error(`에이전트 파일을 찾을 수 없습니다: ${agentFile}`);
  }

  // Load all non-agent guide files as reference context
  const allFiles = await collectGuideFiles(channel, token);
  const guideFiles = allFiles.filter((f) => !f.startsWith("agents/"));

  const guideParts: string[] = [];
  for (const filePath of guideFiles) {
    if (!isTextFile(filePath.split("/").pop() ?? "")) continue;
    try {
      const content = await readChannelFile(channel, filePath, token);
      guideParts.push(
        `\n\n${"=".repeat(60)}\n# 가이드 파일: ${filePath}\n${"=".repeat(60)}\n\n${content}`
      );
    } catch {
      // skip unreadable files silently
    }
  }

  const header = "# 에이전트 지침\n\n" + agentContent;
  const guideSection =
    guideParts.length > 0
      ? "\n\n# 참조 가이드 문서" + guideParts.join("")
      : "";

  return header + guideSection;
}

function buildUserMessage(step: string, topic: string, context?: string): string {
  switch (step) {
    case "research":
      return (
        `주제: "${topic}"\n\n` +
        `위 리서처 에이전트 지침과 가이드 문서를 참고하여, 이 주제에 대한 리서치를 수행하고 research.md 형식으로 결과를 작성해주세요.\n\n` +
        `실제 웹 검색이 가능한 경우 신뢰할 수 있는 출처 5개 이상을 검색하세요. ` +
        `검색이 불가능한 경우 알려진 업계 지식과 CS쉐어링 서비스 연결점을 바탕으로 최대한 충실하게 작성하세요.`
      );

    case "write":
      return (
        `주제: "${topic}"\n\n` +
        `아래 리서치 결과와 위의 writer 에이전트 지침 및 가이드 문서를 참고하여, draft.md 형식의 블로그 초안을 작성해주세요.\n\n` +
        `반드시 <!-- PUBLISH:START --> / <!-- PUBLISH:END --> 와 <!-- NOTES:START --> / <!-- NOTES:END --> 블록 마커를 포함하세요.\n\n` +
        `## 리서치 결과\n\n${context ?? ""}`
      );

    case "assemble":
      return (
        `아래 초안(draft.md)을 위의 assembler 에이전트 지침에 따라 final.html로 변환해주세요.\n\n` +
        `중요 사항:\n` +
        `- 완성도 게이트(Step 0) 확인은 건너뛰고 PUBLISH 블록 내용을 바탕으로 HTML을 생성하세요.\n` +
        `- [IMAGE: 설명] 마커는 아래와 같은 플레이스홀더 박스로 대체하세요:\n` +
        `  <figure style="margin:24px 0;text-align:center;"><div style="background:#f0f4f8;border:2px dashed #b0bec5;border-radius:8px;padding:48px 24px;color:#90a4ae;font-size:14px;font-family:sans-serif;">🖼️ 이미지: DESCRIPTION</div></figure>\n` +
        `  (DESCRIPTION 자리에 [IMAGE: ...] 안의 설명을 넣으세요)\n` +
        `- 마크다운 코드 블록 없이 완전한 HTML 문서만 출력하세요 (코드 펜스 제외).\n\n` +
        `## 초안 (draft.md)\n\n${context ?? ""}`
      );

    default:
      throw new Error(`알 수 없는 스텝: ${step}`);
  }
}

async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  user: string
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
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ??
        `Claude API 오류 (HTTP ${res.status})`
    );
  }
  const data = await res.json() as { content?: Array<{ type: string; text: string }> };
  const block = data.content?.[0];
  if (block?.type === "text") return block.text;
  throw new Error("Claude API 응답 형식 오류");
}

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      max_tokens: 8192,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ??
        `OpenAI API 오류 (HTTP ${res.status})`
    );
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  throw new Error("OpenAI API 응답 형식 오류");
}

async function callGemini(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  useSearch = false
): Promise<string> {
  const fullModel = model || "gemini-2.5-flash";
  const body: Record<string, unknown> = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: 8192 },
  };
  if (useSearch) {
    // Gemini 2.x grounding with Google Search
    body.tools = [{ google_search: {} }];
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${fullModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ??
        `Gemini API 오류 (HTTP ${res.status})`
    );
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  // Collect all text parts (grounding may return multiple parts)
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (text) return text;
  throw new Error("Gemini API 응답 형식 오류");
}

export async function POST(req: NextRequest) {
  try {
    const {
      topic,
      channel = "naver-blog",
      step,
      context,
      provider: providerOverride,
    } = (await req.json()) as {
      topic: string;
      channel?: string;
      step: string;
      context?: string;
      provider?: string;
    };

    if (!topic?.trim()) {
      return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });
    }
    if (!STEP_AGENTS[step]) {
      return NextResponse.json(
        { error: `알 수 없는 스텝: ${step}` },
        { status: 400 }
      );
    }

    const token = resolveGithubToken(req);

    const systemPrompt = await buildStepSystemPrompt(
      channel as ChannelKey,
      step,
      token
    );
    const userMessage = buildUserMessage(step, topic, context);

    const provider = (providerOverride ?? resolveActiveProvider(req)) as ProviderKey;

    const pc =
      resolveProvider(req, provider) ??
      (await loadAIConfig()
        .then((c) => c.providers[provider])
        .catch(() => null));

    if (!pc?.apiKey) {
      return NextResponse.json(
        { error: `${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.` },
        { status: 400 }
      );
    }

    const useSearch = provider === "gemini" && step === "research";
    let output: string;

    if (provider === "claude") {
      output = await callClaude(pc.apiKey, pc.model, systemPrompt, userMessage);
    } else if (provider === "openai") {
      output = await callOpenAI(pc.apiKey, pc.model, systemPrompt, userMessage);
    } else if (provider === "gemini") {
      output = await callGemini(
        pc.apiKey,
        pc.model,
        systemPrompt,
        userMessage,
        useSearch
      );
    } else {
      return NextResponse.json(
        { error: `지원하지 않는 AI: ${provider}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ output });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "파이프라인 실행 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
