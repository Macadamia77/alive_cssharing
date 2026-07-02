import { CHANNELS, type ChannelKey } from "./channels";
import { buildSystemPrompt, hasAgentPipeline, collectGuideFiles, readChannelFile } from "./channelFiles";
import { loadAIConfig, type Provider, type ProviderKey } from "./aiConfig";
import { DEFAULT_MODELS } from "./resolveProvider";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { callClaude, callOpenAI, callGemini, callGeminiWithSearch, callClaudeWithNativeSearch } from "./apiClients";
import { assembleNaverBlogHtml } from "./htmlAssembler";

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

  const imageCardGuide = readFileSync(join(__dirname, "../../data/channels/naver-blog/image-card-template.html"), "utf-8");

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

    if (provider === "claude") return callClaude(pc.apiKey, pc.model, systemPrompt, userMessage);
    if (provider === "openai") return callOpenAI(pc.apiKey, pc.model, systemPrompt, userMessage);
    if (provider === "gemini") return callGemini(pc.apiKey, pc.model, systemPrompt, userMessage);
  }

  return mockGenerate(channel, topic, systemPrompt ? `[가이드 ${Math.round(systemPrompt.length / 100)}백자]` : "");
}

// ─── 네이버 블로그 멀티에이전트 파이프라인 ───────────────────
const WEB_PIPELINE_NOTE = readFileSync(join(__dirname, "../../data/prompts/web-pipeline-note.md"), "utf-8");

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

  // 리서치 단계에는 서비스 카탈로그·SEO 가이드만 필요 (나머지는 컨텍스트 낭비)
  const RESEARCH_GUIDE_KEYS = new Set(["guide/06-brand-cta-reference.md", "guide/08-naver-seo.md"]);
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

  // 글쓰기 단계: 중요도 낮은 순 → 높은 순 정렬 (LLM은 프롬프트 뒷부분에 더 주목)
  const WRITE_GUIDE_ORDER = [
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
    const verifySystem =
      "당신은 콘텐츠 품질 검증 담당자입니다. 아래 원고를 하네스 기준으로 검증하고, " +
      "첫 줄에 정확히 'PASS' 또는 'FAIL'만 쓰고, FAIL인 경우 다음 줄부터 구체적 문제점을 불릿으로 나열하세요.\n\n" +
      rubric;
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
      `- **두 번째 마커 이후 (인덱스 1 이상)**는 본문 요약 및 자료 카드들이므로, 반드시 800px 너비에 흰색 배경을 가진 **본문 이미지 브랜드 카드 프레임**을 사용하여 작성하십시오.\n\n` +
      `[입력 draft.md 전문]\n${draftOutput}`;

    console.log(`[pipeline] ${channel} Step 2.5: 이미지 카드 작성 시작 (${imageMarkers.length}개 감지)`);
    const finalDraftRaw = stripCodeFence(await step(imageMakerSystem, imageMakerUser, 12000, false, true));
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

    // 원래 draft에서 [IMAGE] 마커들을 플레이스홀더 <!-- HTML_CARD_X -->로 치환하고, 카드 배열에 저장
    let cardIndex = 0;
    finalDraft = draftOutput.replace(/\[IMAGE:\s*([^\]]+)\]/g, (match) => {
      const cardHtml = cards[cardIndex] || match;
      replacedCards.push(cardHtml);
      const placeholder = `<!-- HTML_CARD_${cardIndex} -->`;
      cardIndex++;
      return placeholder;
    });
    saveDebug("step2.5_imagemaker_final_draft", finalDraft);
  }

  // ── Step 3: Assembler (코드 기반 — LLM 호출 없음, 토큰 한도 없음) ──
  if (statusCallback) await statusCallback("assembling");

  console.log(`[pipeline] ${channel} Step 3: 조립 시작 (코드 기반)`);
  const assembled = assembleNaverBlogHtml(finalDraft);
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
