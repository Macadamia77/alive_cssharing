import { CHANNELS, type ChannelKey } from "./channels";
import { buildSystemPrompt, hasAgentPipeline, collectGuideFiles, readChannelFile } from "./channelFiles";
import { loadAIConfig, type Provider, type ProviderKey } from "./aiConfig";
import { DEFAULT_MODELS } from "./resolveProvider";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

function saveDebug(stepName: string, content: string) {
  try {
    const debugDir = join(process.cwd(), "debug_pipeline");
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(join(debugDir, `${stepName}.txt`), content, "utf-8");
  } catch (e) {
    console.error("Failed to write debug file:", e);
  }
}


// ─── Claude API ───────────────────────────────────────────────
async function callClaude(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-20240620",
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
  const text = data.choices?.[0]?.message?.content;
  if (text) return text;
  throw new Error("OpenAI API 응답 형식 오류");
}

// ─── Gemini API ───────────────────────────────────────────────
async function callGemini(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192, disableThinking = false
): Promise<string> {
  const realModel = model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${realModel}:generateContent?key=${apiKey}`;

  const generationConfig: any = { maxOutputTokens: maxTokens };
  if (disableThinking && realModel.includes("2.5-flash")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  if (text) return text;
  throw new Error("Gemini API 응답 형식 오류");
}

async function callGeminiWithSearch(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, disableThinking = false
): Promise<string> {
  const realModel = model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${realModel}:generateContent?key=${apiKey}`;

  const generationConfig: any = { maxOutputTokens: 8192 };
  if (disableThinking && realModel.includes("2.5-flash")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      tools: [{ googleSearch: {} }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API (Google Search) 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  if (text) return text;
  
  // 구글 검색이 실패하거나 결과를 정상 획득하지 못하면 일반 호출로 폴백
  return callGemini(apiKey, model, systemPrompt, userMessage, 8192);
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
  const s = text.trim();
  const m = s.match(/^(?:```|~~~)[\w-]*\n?([\s\S]*?)\n?(?:```|~~~)\s*$/);
  return m ? m[1].trim() : s;
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
  apiKeyOverride?: string
): Promise<string> {
  const suggestionContext =
    suggestions && suggestions.length > 0
      ? `\n\n[참고 키워드 및 방향]\n${suggestions.map((s) => `- ${s}`).join("\n")}`
      : "";

  // instagram은 JSON만 출력해야 하므로 HTML 이미지 카드 가이드를 제외
  const imageCardGuide = channel === "instagram" ? "" : `

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

    if (!pc?.apiKey) {
      throw new Error(`${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.`);
    }

    const maxTok = channel === "instagram" ? 8000 : 4096;
    // instagram은 JSON 구조화 작업 → thinking 불필요, 끄면 훨씬 빠름
    const disableThinking = channel === "instagram";
    if (provider === "claude") return callClaude(pc.apiKey, pc.model, systemPrompt, userMessage, maxTok);
    if (provider === "openai") return callOpenAI(pc.apiKey, pc.model, systemPrompt, userMessage);
    if (provider === "gemini") return callGemini(pc.apiKey, pc.model, systemPrompt, userMessage, maxTok, disableThinking);
  }

  return mockGenerate(channel, topic, systemPrompt ? `[가이드 ${Math.round(systemPrompt.length / 100)}백자]` : "");
}

// ─── 네이버 블로그 멀티에이전트 파이프라인 ───────────────────
const WEB_PIPELINE_NOTE = `[웹 파이프라인 환경 — 절대 규칙]
- 파일 저장/읽기/Python 코드 실행 불필요. 결과를 텍스트로 직접 출력한다.
- 이전 단계 결과는 [이전 단계 출력] 섹션으로 제공된다.
- 코드 블록(\`\`\`html, ~~~html 등)으로 감싸지 않는다.

`;

export async function runAgentPipeline(
  channel: ChannelKey,
  topic: string,
  userDraft: string,
  token: string | undefined,
  provider: Provider,
  statusCallback?: (status: string) => Promise<void>,
  apiKeyOverride?: string
): Promise<string> {
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

  const researchSystem =
    WEB_PIPELINE_NOTE +
    researcherInstructions +
    guideKeys.map(k => sec(k)).join("");

  const researchUser =
    `주제: ${topic}` +
    (userDraft ? `\n참고 초안 방향:\n${userDraft}` : "") +
    `\n\nresearch.md 형식으로 조사·분석 결과를 직접 출력하세요.`;

  console.log(`[pipeline] ${channel} Step 1: 리서치 시작`);
  const researchOutput = stripCodeFence(await step(researchSystem, researchUser, 4096, provider === "gemini"));
  console.log(`[pipeline] ${channel} Step 1: 리서치 완료 (${researchOutput.length}자)`);
  saveDebug("step1_research", researchOutput);

  // ── Step 2: Write ─────────────────────────────────────────
  if (statusCallback) await statusCallback("writing");

  const writerInstructions = fileContents["agents/writer-web.md"];

  let writeSystem: string;
  if (writerInstructions) {
    writeSystem =
      WEB_PIPELINE_NOTE +
      writerInstructions +
      guideKeys.map(k => sec(k)).join("");
  } else {
    const writerFileList = guideKeys
      .map((k, i) => `${i + 1}. ${k} → 아래 === 섹션에 전문 포함됨`)
      .join("\n");
    const writeFileReadyNote =
      `[웹 파이프라인 — 파일 제공 완료. 지금 바로 작성 시작]\n` +
      `writer.md의 '읽을 파일' 목록이 모두 이 시스템 프롬프트 안에 제공되어 있습니다:\n` +
      writerFileList + "\n" +
      `${guideKeys.length + 1}. output/[주제]/research.md → 사용자 메시지의 [이전 단계 출력] 섹션\n\n` +
      `→ 모든 파일 제공 완료. '하나라도 빠지면 작성하지 않는다' 조건 충족됨. 지금 바로 전체 글 작성 시작.\n\n`;
    writeSystem =
      writeFileReadyNote +
      (fileContents["agents/writer.md"] ?? "당신은 블로그 글쓰기 전문가입니다.") +
      guideKeys.map(k => sec(k)).join("");
  }

  const writeUser =
    `[주제]\n${topic}\n\n` +
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
  const draftRaw = stripCodeFence(await step(writeSystem, writeUser, 8000));
  console.log(`[pipeline] ${channel} Step 2: 글쓰기 완료 (${draftRaw.length}자)`);
  saveDebug("step2_writer_raw", draftRaw);

  if (!draftRaw.trim()) throw new Error("[pipeline] 글쓰기 단계 결과가 비어 있습니다.");

  const draftOutput = draftRaw.includes("<!-- PUBLISH:START -->")
    ? draftRaw
    : `<!-- PUBLISH:START -->\n${draftRaw}\n<!-- PUBLISH:END -->`;

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
      `- **두 번째 마커 이후 (인덱스 1 이상)**는 본문 요약 및 자료 카드들이므로, 반드시 800px 너비에 흰색 배경을 가진 **본문 이미지 브랜드 카드 프레임**을 사용하여 작성하십시오.\n\n` +
      `[입력 draft.md 전문]\n${draftOutput}`;

    console.log(`[pipeline] ${channel} Step 2.5: 이미지 카드 작성 시작 (${imageMarkers.length}개 감지)`);
    const finalDraftRaw = stripCodeFence(await step(imageMakerSystem, imageMakerUser, 8000, false, true));
    console.log(`[pipeline] ${channel} Step 2.5: 이미지 카드 작성 완료 (${finalDraftRaw.length}자)`);
    saveDebug("step2.5_imagemaker_raw", finalDraftRaw);

    // 카드들 추출
    const cards: string[] = [];
    const cardRegex = /<!-- CARD_START -->([\s\S]*?)<!-- CARD_END -->/g;
    let match;
    while ((match = cardRegex.exec(finalDraftRaw)) !== null) {
      cards.push(match[1].trim());
    }

    // 폴백: 만약 AI가 주석 마커를 빼먹었다면 div 스타일 감지로 카드 추출 시도
    if (cards.length === 0) {
      const divRegex = /<div style="font-family:[\s\S]*?<\/div>\s*<\/div>/g;
      let divMatch;
      while ((divMatch = divRegex.exec(finalDraftRaw)) !== null) {
        cards.push(divMatch[0].trim());
      }
    }

    // 원래 6,600자 draft에서 [IMAGE] 마커들을 플레이스홀더 <!-- HTML_CARD_X -->로 치환하고, 카드 배열에 저장
    let cardIndex = 0;
    finalDraft = draftOutput.replace(/\[IMAGE:\s*([^\]]+)\]/g, (match) => {
      const cardHtml = cards[cardIndex] || match; // AI가 생성하지 못했으면 원래 마커 유지
      replacedCards.push(cardHtml);
      const placeholder = `<!-- HTML_CARD_${cardIndex} -->`;
      cardIndex++;
      return placeholder;
    });
    saveDebug("step2.5_imagemaker_final_draft", finalDraft);
  }

  // ── Step 3: Assembler ──────────────────────────────────────
  if (statusCallback) await statusCallback("assembling");

  const assemblerInstructions =
    fileContents["agents/assembler-web.md"] ??
    fileContents["agents/assembler.md"] ??
    "당신은 어셈블러입니다. draft를 정제하여 완성형 HTML만 출력하세요.";

  const assemblerSystem =
    WEB_PIPELINE_NOTE +
    assemblerInstructions +
    sec("guide/01-writing-guide.md");

  const assemblerUser =
    `[주제]\n${topic}\n\n` +
    `[이전 단계 출력 — draft.md]\n${finalDraft}\n\n` +
    `위 draft.md를 정밀 파싱하고 가이드를 적용하여, 본문과 이미지 카드가 온전히 합쳐진 독립형 HTML만 출력하세요.`;

  console.log(`[pipeline] ${channel} Step 3: 조립 시작`);
  const finalHtmlRaw = await step(assemblerSystem, assemblerUser, 8000, false, true);
  let finalHtml = stripCodeFence(finalHtmlRaw);
  console.log(`[pipeline] ${channel} Step 3: 조립 완료 (${finalHtml.length}자)`);
  saveDebug("step3_assembler_raw", finalHtmlRaw);

  if (!finalHtml.trim() || !finalHtml.includes("<")) return draftOutput;

  // 조립된 최종 HTML에서 플레이스홀더들을 실제 HTML 카드 코드로 치환 복원!
  replacedCards.forEach((cardHtml, idx) => {
    finalHtml = finalHtml.replace(new RegExp(`<!--\\s*HTML_CARD_${idx}\\s*-->`, "g"), cardHtml);
  });
  saveDebug("step3_final_html", finalHtml);

  return finalHtml;
}
