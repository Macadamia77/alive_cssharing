// 통합 파이프라인 엔진의 config 타입.
// 흐름(단계 순서·scope·토글)은 config로, 프롬프트·역할은 data 파일로 (하드코딩 금지 원칙).

/** 단계 실행 종류(오케스트레이션 패턴). composition이 명시하고, 아니면 runPipeline이 id로 추론. */
export type StageKind = "producer" | "writer" | "reviewer" | "image";

/** 단계의 실행 범위 */
export type StageScope = "shared" | "channel";
// shared  = 주제 단위, 1회만 실행해 모든 채널에 공급 (리서치·브레인스토밍·뼈대 등)
// channel = 채널마다 실행 (라이터·검수·이미지 등)

/** 전역 파이프라인 정의(data/pipeline.json)의 단계 한 개 */
export interface StageDef {
  id: string;                 // 단계 식별자 (예: "research", "writer", "tone-review")
  scope: StageScope;
  /** 이 단계 페르소나 파일의 역할 태그(frontmatter role). 없으면 id로 매칭 */
  persona?: string;
  /** 이 단계에 주입할 역할 조각(role) 태그 목록 (검수 등) */
  roles?: string[];
  model?: string;             // provider 오버라이드 ("claude"|"openai"|"gemini") — 주의: 이걸 쓰면
                               // 활성 provider 선택을 무시하고 항상 이 provider로 강제된다.
  modelId?: string;
  /** provider는 그대로 활성 선택(또는 리서치 전용 override/자동폴백)을 따르되, 최종 해석된
   *  provider가 이 맵의 키와 일치할 때만 modelId를 강제한다(예: {"claude":"claude-sonnet-5"} —
   *  결과적으로 claude가 쓰일 때만 sonnet 티어를 쓰고, gemini/openai가 선택돼 있으면 그대로 둔다).
   *  provider 자체를 바꾸지 않으므로 model 필드처럼 활성 선택을 깨뜨리지 않는다. */
  modelIdByProvider?: Record<string, string>;
  maxTokens?: number;
  useSearch?: boolean;        // provider 내장 웹검색 사용
  disableThinking?: boolean;
  /** 특정 조건이면 이 단계 건너뜀 (예: "draftProvided") */
  skipIf?: "draftProvided";
  enabled?: boolean;          // 전역 기본 on/off (기본 true)
  /** reviewer 단계 전용: 반려 시 최대 재작성 횟수 (기본 1 = 재작성 1회 후 재검수 없이 진행) */
  maxRetries?: number;
  /** 판단·논리 무거운 단계(brainstorm/skeleton/검수)에서만 Claude 네이티브 thinking을 켠다.
   *  이 필드가 있으면 call()이 callClaude에 budgetTokens를 넘겨 extended thinking을 활성화.
   *  형식 강제 단계(writer/image)엔 넣지 않아 원천 차단. Claude 경로에서만 유효. */
  thinking?: { budgetTokens: number };
}

/** 전역 파이프라인 정의 파일 구조 */
export interface PipelineConfig {
  stages: StageDef[];
}

/** 채널 _meta.json의 단계별 오버라이드 (웹 토글이 건드리는 값) */
export interface StageOverride {
  enabled?: boolean;
  model?: string;
  modelId?: string;
  modelIdByProvider?: Record<string, string>;
  maxTokens?: number;
  roles?: string[];
  guides?: string[];
  maxRetries?: number;
}

/** 채널이 최종 결과물을 내는 형식 */
export type OutputFormat = "html" | "text" | "json";

/**
 * 엔진이 한 단계를 실행할 때 해석 완료된(전역+채널 오버라이드 병합) 설정.
 */
export interface ResolvedStage {
  id: string;
  scope: StageScope;
  /** composition이 명시한 실행 종류. 없으면 runPipeline이 id로 추론(stageKind) — 하위호환. */
  kind?: StageKind;
  persona?: string;
  roles: string[];
  model?: string;
  modelId?: string;
  modelIdByProvider?: Record<string, string>;
  maxTokens?: number;
  useSearch: boolean;
  disableThinking: boolean;
  skipIf?: "draftProvided";
  guides?: string[];
  maxRetries?: number;
  /** reviewer 반려 재작성 방식. 없으면 채널 기본(naver=patch, 그 외 full). */
  rewriteMode?: "full" | "patch";
  /** image 단계 전용 — 생성된 카드 이미지를 눈으로 검수할 비전 리뷰어 페르소나(없으면 검수 안 함). */
  reviewer?: string | null;
  /** reviewer 단계 전용 — 검수 프롬프트에 참고 자료(리서치)를 함께 주입해 인용을 대조하게 한다.
   *  composition만 세운다(pipeline.json/legacy는 undefined → 기존 동작, 팀원 무영향). */
  injectContext?: boolean;
  thinking?: { budgetTokens: number };
}

// ─── 파이프라인 트레이스 — 각 단계 진행 상황을 관측용으로 기록(엔진→워커 콜백) ───
export interface TraceEvent {
  seq: number;                                        // 한 실행 내 순서(UI 정렬)
  stage: string;                                      // 단계 id('context' 포함)
  kind?: string;                                      // producer/writer/reviewer/image
  phase: "context" | "stage" | "output" | "verdict";
  data: Record<string, unknown>;                      // 요약+상세(persona/model/guides/counts/prompt/output/verdict)
}

// ─── composition (채널별 조립표) — 사용자가 UI로 짜는 per-channel 파이프라인 정의 ───
// pipeline.json+태그 매칭을 대체하는 "두 번째 입력원". 채널에 composition.json이 있으면
// resolveStages가 이걸 ResolvedStage[]로 컴파일하고, 없으면 pipeline.json으로 폴백.
export interface CompositionReviewer {
  agent: string;          // 검수 에이전트 파일명(빈 문자열이면 그 리뷰어 스킵)
  guides?: string[];      // 이 리뷰어에 붙일 가이드(순서 = 주입 순서)
}
export type CompositionBlock =
  | {
      type: "generate";     // 에이전트 1회 호출 → 결과 전달(리서치/스켈레톤/단순 생성)
      agent: string;
      guides?: string[];
      output?: "context" | "draft";   // context=뒤 단계 참고맥락(기본), draft=검수받을 본문
      useSearch?: boolean;
      model?: string; modelId?: string; modelIdByProvider?: Record<string, string>;
      maxTokens?: number; disableThinking?: boolean; thinking?: { budgetTokens: number };
    }
  | {
      // ★원자 리뷰어(1블록=리뷰어 1명). 바로 앞 어딘가의 draft 생성자가 만든 본문(draft)을 검수한다.
      // 여러 개면 순서대로 각각 현재 draft를 검수(runPipeline이 flat 스테이지로 그대로 반복).
      type: "reviewer";
      agent: string;
      guides?: string[];
      maxRetries?: number;
      rewriteMode?: "full" | "patch";
      model?: string; modelId?: string; modelIdByProvider?: Record<string, string>;
      maxTokens?: number; thinking?: { budgetTokens: number };
    }
  | {
      // (구) 하위호환 — writer + 리뷰어들을 묶은 번들 블록. 원자화 이전에 저장된 composition.json이
      // 계속 컴파일되도록 유지한다. 새 빌더는 generate(draft)+reviewer 원자 블록으로 저장한다.
      type: "review-loop";  // 생성(writer) + 리뷰어(들) + 반려 재작성 루프
      generateAgent: string;
      guides?: string[];    // writer 쪽 가이드
      reviewers?: CompositionReviewer[];
      maxRetries?: number;
      rewriteMode?: "full" | "patch";
      model?: string; modelId?: string; modelIdByProvider?: Record<string, string>;
      maxTokens?: number; thinking?: { budgetTokens: number };
    }
  | {
      type: "image-loop";   // 이미지 카드 생성(+ 선택적 비전 리뷰 — 비전 실행은 후속 Phase)
      generateAgent: string;
      reviewer?: string | null;
      guides?: string[];
      maxRetries?: number;
      model?: string; modelId?: string; modelIdByProvider?: Record<string, string>;
      maxTokens?: number;
    };
export interface Composition {
  version: number;
  blocks: CompositionBlock[];
}
