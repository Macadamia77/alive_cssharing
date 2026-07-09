// 채널 배정 이전(shared scope) producer 단계 1개 실행 — runPipeline.ts에서 분리하지 않고
// M5 신규 작성(M0에서 "실소비자와 함께 처리"로 미뤘던 부분). 브레인스토밍(M5)의
// research/research-voice, finalize(M6)의 research-deep이 이 함수를 공통으로 재사용한다.
// (channel 배정 이후 producer 단계는 runPipeline.ts 내부 로직을 그대로 유지 — 별도 관심사)
import type { StageDef } from "./types";
import { loadPersona, stripCodeFence } from "./promptAssembly";
import { callProvider } from "../apiClients";
import { addResearch } from "../pipelineMemory";
import type { Provider } from "../aiConfig";

export type StageModelResolver = (opts: {
  model?: string; modelId?: string; useSearch?: boolean; stageId?: string;
}) => Promise<{ p: Provider; apiKey: string; model: string }>;

/**
 * 페르소나는 채널 없이(공용) 로드하고, useSearch 단계는 성공 시(출처 있을 때)만 아카이브한다.
 * 페르소나 파일이 없으면 빈 문자열을 반환(fail-soft — 그 단계만 건너뛴 것처럼 동작).
 */
export async function runSharedProducerStage(
  def: StageDef,
  topic: string,
  resolveModelFor: StageModelResolver,
  token: string | undefined,
  runId: string | undefined,
  onSearchSource?: (n: number) => void,
  providerOverride?: Provider,
  // [M8] 아카이브(pipeline_research.topic)에 저장할 값. 입력(topic)과 다르게 두고 싶을 때 사용.
  // 예: 모드 B research-deep는 입력이 "초안 전문"이지만 아카이브 topic엔 한 줄 주제를 넣는다.
  archiveTopic?: string
): Promise<string> {
  const persona = await loadPersona(null, def.persona ?? def.id, token);
  if (!persona) {
    console.warn(`[engine] shared/${def.id}: 페르소나 '${def.persona ?? def.id}' 없음 → 건너뜀`);
    return "";
  }
  // [결정 #10] 리서치 전용 provider가 지정되면 이 단계만 강제 오버라이드(modelId는 승계 안 함 — 교차-프로바이더 크래시 방지)
  const auth = await resolveModelFor({
    model: providerOverride ?? def.model,
    modelId: providerOverride ? undefined : def.modelId,
    useSearch: def.useSearch,
    stageId: def.id,
  });
  const user = `[주제]\n${topic}\n\n위 정보를 바탕으로 이 단계의 역할을 수행해 결과를 직접 출력하세요.`;
  const out = stripCodeFence(await callProvider(auth.p, auth.apiKey, auth.model, persona, user, def.maxTokens ?? 8192, {
    useSearch: def.useSearch,
    onSearchSource,
  }));
  if (def.useSearch) warnIfProse(def.id, out);
  // 실검색·출처가 있을 때만 아카이브(품질 게이트). M-1.6에서 출력이 `- 요약 | 출처: URL`
  // 한 줄 형식으로 바뀌어 옛 `[출처]` 블록 문자열이 사라졌으므로, 형식에 무관하게 실제 URL이
  // 하나라도 들어있으면 저장한다(그래야 산문 드리프트가 나도 근거 있는 결과는 아카이브됨).
  if (def.useSearch && /https?:\/\//.test(out)) void addResearch(null, def.id, archiveTopic ?? topic, out, runId);
  return out;
}

/**
 * 산문화 드리프트 감지(막지 않음, fail-soft) — "- "/"|"로 시작하지 않는 본문 줄 비율이
 * 높으면 산문으로 되돌아갔을 가능성이 크다는 신호. M-1.6에서 실제로 재발했던 걸 로그로
 * 바로 알아채기 위한 관측성 장치.
 */
function warnIfProse(stageId: string, text: string): void {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("#") && !l.startsWith(">") && l !== "---");
  if (lines.length < 3) return;
  const lineItems = lines.filter(l => l.startsWith("-") || l.startsWith("|") || l.startsWith("["));
  const ratio = lineItems.length / lines.length;
  if (ratio < 0.5) {
    console.warn(`[engine] shared/${stageId}: 산문화 의심 — 줄 형식 준수 비율 ${(ratio * 100).toFixed(0)}% (${lineItems.length}/${lines.length})`);
  }
}
