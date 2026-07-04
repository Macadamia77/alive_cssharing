// 통합 파이프라인 엔진의 config 타입.
// 흐름(단계 순서·scope·토글)은 config로, 프롬프트·역할은 data 파일로 (하드코딩 금지 원칙).

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
  model?: string;             // provider 오버라이드 ("claude"|"openai"|"gemini")
  modelId?: string;
  maxTokens?: number;
  useSearch?: boolean;        // provider 내장 웹검색 사용
  disableThinking?: boolean;
  /** 특정 조건이면 이 단계 건너뜀 (예: "draftProvided") */
  skipIf?: "draftProvided";
  enabled?: boolean;          // 전역 기본 on/off (기본 true)
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
  maxTokens?: number;
  roles?: string[];
  guides?: string[];
}

/** 채널이 최종 결과물을 내는 형식 */
export type OutputFormat = "html" | "text" | "json";

/**
 * 엔진이 한 단계를 실행할 때 해석 완료된(전역+채널 오버라이드 병합) 설정.
 */
export interface ResolvedStage {
  id: string;
  scope: StageScope;
  persona?: string;
  roles: string[];
  model?: string;
  modelId?: string;
  maxTokens?: number;
  useSearch: boolean;
  disableThinking: boolean;
  skipIf?: "draftProvided";
  guides?: string[];
}
