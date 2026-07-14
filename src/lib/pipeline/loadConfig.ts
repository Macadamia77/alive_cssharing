// 전역 파이프라인 정의(data/pipeline.json) + 채널 오버라이드(_meta.json)를 병합해
// "이 채널에서 실제로 실행할 단계 목록(ResolvedStage[])"을 만든다.
import { readFileSync } from "fs";
import { join } from "path";
import { dataRoot } from "../dataRoot";
import type { PipelineConfig, ResolvedStage, Composition } from "./types";
import type { ChannelMeta } from "../channelFiles";
import type { ChannelKey } from "../channels";
import { compileComposition } from "./composition";

const FALLBACK_PIPELINE: PipelineConfig = { stages: [] };

/** 전역 파이프라인 정의 로드 (없으면 빈 파이프라인 — fail-soft) */
export function loadPipelineConfig(): PipelineConfig {
  try {
    const raw = readFileSync(join(dataRoot(), "data/pipeline.json"), "utf-8");
    return JSON.parse(raw.replace(/^﻿/, "")) as PipelineConfig;
  } catch (e) {
    console.warn(`[pipeline] pipeline.json 로드 실패, 빈 파이프라인 사용: ${e instanceof Error ? e.message : e}`);
    return FALLBACK_PIPELINE;
  }
}

/**
 * 전역 단계 + 채널 오버라이드를 병합해 활성 단계만 반환.
 * - enabled: 채널 오버라이드 > 전역 기본 > true
 * - skipIf: 조건 충족 시 제외 (예: 초안 제공 시 brainstorm)
 * - model/maxTokens 우선순위: 채널 단계 오버라이드 > 전역 단계 > 채널 기본(meta.model)
 */
export function resolveStages(
  channel: ChannelKey,
  meta: ChannelMeta,
  ctx: { draftProvided: boolean },
  // 채널에 composition(조립표)이 있으면 그걸로 단계를 만들고, 없으면(null) 아래 pipeline.json 경로로 폴백.
  composition?: Composition | null
): ResolvedStage[] {
  if (composition && Array.isArray(composition.blocks) && composition.blocks.length > 0) {
    return compileComposition(composition, meta);
  }
  const cfg = loadPipelineConfig();
  const resolved: ResolvedStage[] = [];
  for (const s of cfg.stages) {
    const ov = meta.pipeline?.[s.id];
    const enabled = ov?.enabled ?? s.enabled ?? true;
    if (!enabled) continue;
    if (s.skipIf === "draftProvided" && ctx.draftProvided) continue;
    resolved.push({
      id: s.id,
      scope: s.scope,
      persona: s.persona ?? s.id,
      roles: ov?.roles ?? s.roles ?? [],
      model: ov?.model ?? s.model ?? meta.model,
      modelId: ov?.modelId ?? s.modelId ?? meta.modelId,
      modelIdByProvider: ov?.modelIdByProvider ?? s.modelIdByProvider,
      maxTokens: ov?.maxTokens ?? s.maxTokens,
      useSearch: s.useSearch ?? false,
      disableThinking: s.disableThinking ?? false,
      skipIf: s.skipIf,
      guides: ov?.guides,
      maxRetries: ov?.maxRetries ?? s.maxRetries,
      thinking: s.thinking,
    });
  }
  return resolved;
}
