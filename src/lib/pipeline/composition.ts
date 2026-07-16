// composition(채널별 조립표) → 실행기가 그대로 소비하는 ResolvedStage[]로 컴파일.
// 순수 함수(I/O 없음)라 테스트·검증이 쉽다. composition.json 로딩(비동기 파일 읽기)은
// runPipeline이 담당하고, 여기엔 "블록 → 단계" 변환 로직과 저장/실행 전 구조 검증만 둔다.
import type { Composition, CompositionBlock, ResolvedStage } from "./types";
import type { ChannelMeta } from "../channelFiles";

// 모델/토큰 관련 공통 필드를 블록에서 ResolvedStage로 옮긴다(채널 기본값 meta.model/modelId 폴백).
// maxTokens는 블록이 명시하지 않으면 kind별 기본값을 넣는다 — 안 넣으면 runPipeline이 4096으로
// 폴백해(pipeline.json의 writer 24000·검수 6000·image 12000 예산을 잃음) 출력이 잘리는 회귀가 난다.
function modelFields(
  block: { model?: string; modelId?: string; modelIdByProvider?: Record<string, string>; maxTokens?: number },
  meta: ChannelMeta,
  defaultMaxTokens: number
) {
  return {
    model: block.model ?? meta.model,
    modelId: block.modelId ?? meta.modelId,
    modelIdByProvider: block.modelIdByProvider,
    maxTokens: block.maxTokens ?? defaultMaxTokens,
  };
}

// kind별 기본 토큰 예산(pipeline.json과 동일 계열). 블록이 maxTokens를 명시하면 그게 우선.
const DEFAULT_MAX_TOKENS = { writer: 24000, reviewer: 6000, image: 12000, producer: 16000 } as const;

/**
 * composition의 블록들을 순서대로 ResolvedStage[]로 펼친다.
 * - generate     → 단계 1개(output:"draft"면 writer, 아니면 producer)
 * - review-loop  → writer 단계 + (빈 슬롯 제외한) 리뷰어마다 reviewer 단계
 * - image-loop   → image 단계 1개
 * guides는 항상 명시 배열(없으면 [])로 넣어, selectGuides가 태그매칭이 아니라 이 목록·순서를 쓰게 한다.
 */
export function compileComposition(comp: Composition, meta: ChannelMeta): ResolvedStage[] {
  const out: ResolvedStage[] = [];
  for (const block of comp.blocks) {
    if (block.type === "generate") {
      out.push({
        id: block.agent,
        scope: "channel",
        kind: block.output === "draft" ? "writer" : "producer",
        persona: block.agent,
        roles: [],
        ...modelFields(block, meta, block.output === "draft" ? DEFAULT_MAX_TOKENS.writer : DEFAULT_MAX_TOKENS.producer),
        useSearch: block.useSearch ?? false,
        disableThinking: block.disableThinking ?? false,
        guides: block.guides ?? [],
        thinking: block.thinking,
      });
    } else if (block.type === "review-loop") {
      out.push({
        id: block.generateAgent,
        scope: "channel",
        kind: "writer",
        persona: block.generateAgent,
        roles: [],
        ...modelFields(block, meta, DEFAULT_MAX_TOKENS.writer),
        useSearch: false,
        disableThinking: false,
        guides: block.guides ?? [],
        thinking: block.thinking,
      });
      for (const r of block.reviewers ?? []) {
        if (!r.agent?.trim()) continue; // 빈 슬롯(예: 톤 미할당) → 그 리뷰어 스킵
        out.push({
          id: r.agent,
          scope: "channel",
          kind: "reviewer",
          persona: r.agent,
          roles: [],
          ...modelFields(block, meta, DEFAULT_MAX_TOKENS.reviewer),
          useSearch: false,
          disableThinking: false,
          guides: r.guides ?? [],
          maxRetries: block.maxRetries,
          rewriteMode: block.rewriteMode,
          // 내용 리뷰어만 검수 시 리서치를 함께 받아 인용을 대조한다(톤 리뷰어는 제외 — 인용 대조 불필요).
          injectContext: !/tone/i.test(r.agent),
          thinking: block.thinking,
        });
      }
    } else if (block.type === "reviewer") {
      // ★원자 리뷰어 블록 → reviewer 스테이지 1개. review-loop이 내부 반복으로 만들던 것과 동일하게,
      // runPipeline이 flat 스테이지로 소비한다(여러 reviewer 블록 = 순서대로 각각 현재 draft 검수).
      if (block.agent?.trim()) {
        out.push({
          id: block.agent,
          scope: "channel",
          kind: "reviewer",
          persona: block.agent,
          roles: [],
          ...modelFields(block, meta, DEFAULT_MAX_TOKENS.reviewer),
          useSearch: false,
          disableThinking: false,
          guides: block.guides ?? [],
          maxRetries: block.maxRetries,
          rewriteMode: block.rewriteMode,
          // 내용 리뷰어만 검수 시 리서치를 함께 받아 인용을 대조한다(톤 리뷰어는 제외 — 인용 대조 불필요).
          injectContext: !/tone/i.test(block.agent),
          thinking: block.thinking,
        });
      }
    } else if (block.type === "image-loop") {
      out.push({
        id: block.generateAgent,
        scope: "channel",
        kind: "image",
        persona: block.generateAgent,
        roles: [],
        ...modelFields(block, meta, DEFAULT_MAX_TOKENS.image),
        useSearch: false,
        disableThinking: false,
        guides: block.guides ?? [],
        maxRetries: block.maxRetries,
        reviewer: block.reviewer ?? null, // 비전 검수 리뷰어(있으면 image 단계가 카드 이미지를 검수)
      });
    }
  }
  return out;
}

/**
 * 저장/실행 전 구조 검증 — "조용한 실패"를 시끄러운 에러로 바꾸는 게 목적.
 * 파일 실존 여부(에이전트/가이드 파일이 실제로 있는지)는 파일 목록이 필요하므로 선택 인자로 받는다.
 * 반환: 사람이 읽을 에러 메시지 배열(빈 배열이면 통과).
 */
export function validateComposition(comp: Composition, availableFiles?: {
  agents: string[];   // 배정 가능한 에이전트 이름(확장자 없이, 예: "writer")
  guides: string[];   // 배정 가능한 가이드 경로(예: "guide/00-tone.md")
}): string[] {
  const errors: string[] = [];
  if (!comp || !Array.isArray(comp.blocks)) return ["composition에 blocks 배열이 없습니다."];
  if (comp.blocks.length === 0) errors.push("블록이 하나도 없습니다.");

  const agentSet = availableFiles ? new Set(availableFiles.agents) : null;
  const guideSet = availableFiles ? new Set(availableFiles.guides) : null;
  const checkAgent = (label: string, name?: string | null) => {
    if (!name?.trim()) { errors.push(`${label}: 에이전트가 배정되지 않았습니다.`); return; }
    if (agentSet && !agentSet.has(name)) errors.push(`${label}: 에이전트 파일 '${name}'을 찾을 수 없습니다.`);
  };
  const checkGuides = (label: string, guides?: string[]) => {
    if (!guideSet || !guides) return;
    for (const g of guides) if (!guideSet.has(g)) errors.push(`${label}: 가이드 파일 '${g}'을 찾을 수 없습니다.`);
  };

  // 순서 검증용: reviewer/image 블록은 앞에 draft(검수·이미지 대상 본문)를 만드는 블록이 있어야 한다.
  // draft 생성원 = generate(output:"draft") 또는 review-loop(내부 writer가 draft를 만듦).
  let sawDraft = false;
  comp.blocks.forEach((block: CompositionBlock, i) => {
    const at = `블록 ${i + 1}(${block.type})`;
    if (block.type === "generate") {
      checkAgent(at, block.agent); checkGuides(at, block.guides);
      if (block.output === "draft") sawDraft = true;
    } else if (block.type === "reviewer") {
      checkAgent(at, block.agent); checkGuides(at, block.guides);
      if (!sawDraft) errors.push(`${at}: 검수할 draft가 없습니다 — 앞에 draft를 만드는 생성자(generate·output:draft) 블록이 있어야 합니다.`);
    } else if (block.type === "review-loop") {
      checkAgent(`${at} 생성`, block.generateAgent); checkGuides(`${at} 생성`, block.guides);
      const active = (block.reviewers ?? []).filter(r => r.agent?.trim());
      if (active.length === 0) errors.push(`${at}: 검수 에이전트가 하나도 없습니다(사실상 generate 블록).`);
      active.forEach((r, j) => { checkAgent(`${at} 리뷰어 ${j + 1}`, r.agent); checkGuides(`${at} 리뷰어 ${j + 1}`, r.guides); });
      sawDraft = true; // 내부 writer가 draft를 만든다
    } else if (block.type === "image-loop") {
      checkAgent(`${at} 생성`, block.generateAgent);
      if (block.reviewer) checkAgent(`${at} 리뷰어`, block.reviewer);
      checkGuides(at, block.guides);
      if (!sawDraft) errors.push(`${at}: 이미지 대상 draft가 없습니다 — 앞에 [IMAGE:] 마커를 담은 본문을 만드는 writer 블록이 있어야 합니다.`);
    }
  });
  return errors;
}
