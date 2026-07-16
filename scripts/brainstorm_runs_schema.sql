-- 브레인스토밍/공유 리서치 런 테이블 (M2)
-- Supabase 대시보드 → SQL Editor에 붙여 1회 실행. 재실행해도 안전(if not exists / if exists).
--
-- 동작(전부 워커 비동기):
--  1) /api/brainstorm → brainstorm_runs insert(status='pending') + tasks에 job_type='brainstorm' 등록
--  2) 워커 brainstorm 잡 → research+research-voice+brainstorm 실행 → candidates 채움(status='brainstormed')
--  3) 사용자 후보 선택 → /api/generate → tasks에 job_type='finalize' 등록
--  4) 워커 finalize 잡 → research-deep+skeleton 실행(status='finalized') → 채널별 job_type='generate' task insert
--  5) 워커 generate 잡 → run_id로 brainstorm_runs를 읽어 sharedContext 조립해 runPipeline 호출
--
-- 보안: pipeline_* 테이블과 동일하게 RLS on + 공개 정책 없음(=service_role 전용).
--  ⚠️ Vercel/Railway 양쪽에 SUPABASE_SERVICE_ROLE_KEY가 있어야 서버가 이 테이블을 읽고 씁니다.

create table if not exists brainstorm_runs (
  id                     uuid primary key default gen_random_uuid(),
  topic_seed             text,              -- 사용자가 처음 입력한 주제 문구(모드 A)
  user_draft             text,              -- 완성 초안을 붙여넣은 경우(모드 B)
  provider               text not null,     -- 이 run의 기본 provider(활성 provider)
  research_content       jsonb,             -- { research, researchVoice } 산출물
  candidates             jsonb,             -- brainstormer가 낸 후보 배열(순위·사유 포함)
  selected_candidate_idx int,               -- 사용자가 고른 후보 인덱스
  selected_topic         text,              -- 확정 주제
  research_deep_content  text,              -- 심화 리서치 산출물
  skeleton_content       text,              -- 뼈대(스켈레톤) 산출물
  improve_mode           boolean not null default false, -- 모드 B(충실한 개선) 여부
  do_research            boolean not null default true,  -- 모드 B에서 research-deep 실행 여부(토글)
  channels               jsonb,             -- 최종 생성 대상 채널 목록
  status                 text not null default 'pending', -- pending|brainstormed|finalized|failed
  error                  text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_brainstorm_runs_created on brainstorm_runs (created_at desc);
alter table brainstorm_runs enable row level security;

-- tasks 테이블 확장: run 참조 + 워커 작업 종류 구분
alter table tasks add column if not exists run_id uuid references brainstorm_runs(id) on delete set null;
alter table tasks add column if not exists job_type text not null default 'generate'; -- 'generate'|'brainstorm'|'finalize'
-- [M5 추가] brainstorm/finalize 잡은 채널 배정 이전이라 channel이 없다(null). 기존엔 매 row가
-- 항상 채널을 가졌으므로 NOT NULL이었을 수 있다 — 이미 nullable이면 아래는 안전한 no-op.
alter table tasks alter column channel drop not null;

-- [결정 #10] 리서치 전용 provider 독립 선택 — null이면 기존처럼 활성 provider를 따름(하위호환)
alter table brainstorm_runs add column if not exists research_provider text;

-- 브라우저에서 고른 모델(예: gemini-3.5-flash)을 워커까지 전달 — null이면 워커의 GEMINI_MODEL
-- env/코드 기본값을 따름(하위호환). 이전엔 이 값이 버려져 브라우저 모델 선택이 새 브레인스토밍
-- 파이프라인(워커 비동기)에 전혀 반영되지 않았다.
alter table tasks add column if not exists model text;
alter table brainstorm_runs add column if not exists model text;

-- [M8 #3] 모드 A 1차 리서치(research/research-voice) 생략 — 켜면 누적 데이터만으로 브레인스토밍
alter table brainstorm_runs add column if not exists skip_initial_research boolean not null default false;

-- [M8 재개선] 결과가 맘에 안 들 때 방향을 주고 채널별로 다시 개선
alter table tasks add column if not exists improve_direction text;           -- writer에 주입할 개선 방향
alter table tasks add column if not exists use_accumulated boolean not null default false; -- 재개선 시 누적 리서치도 참조
alter table brainstorm_runs add column if not exists improve_direction text;
alter table brainstorm_runs add column if not exists reimprove_channels jsonb;  -- 이번 재개선 대상 채널(부분집합)
alter table brainstorm_runs add column if not exists reimprove_research_mode text; -- 'reuse'|'accumulated'|'fresh'

-- [M8 ④] 컨텍스트 참조 예산: 'light'|'normal'|'heavy' (피드백/우수작/기각/리서치 주입량 조절)
alter table tasks add column if not exists context_budget text;
alter table brainstorm_runs add column if not exists context_budget text;

-- 퓨샷 요약본(문체 오염 방지용 소재/앵글/확장전략) 저장 컬럼
alter table pipeline_examples add column if not exists summary_json jsonb;

-- 공유 리서치는 특정 채널에 속하지 않으므로 channel nullable로 완화 + run 연결
alter table pipeline_research alter column channel drop not null;
alter table pipeline_research add column if not exists run_id uuid references brainstorm_runs(id) on delete set null;

-- [리서치 3종 A/B 토글] 예전엔 skip_initial_research 하나가 research+research-voice를 함께
-- 껐다 — 코스트 대비 품질 기여도를 단계별로 비교하기 위해 3개로 분리(skip_initial_research는
-- 과거 row 보존용으로 남겨두고 코드에서는 더 안 읽음).
alter table brainstorm_runs add column if not exists skip_research boolean not null default false;
alter table brainstorm_runs add column if not exists skip_research_voice boolean not null default false;
alter table brainstorm_runs add column if not exists skip_research_deep boolean not null default false; -- 모드 A 전용(모드 B는 기존 do_research 사용)
-- [스켈레톤 토글] 모드 A에서 뼈대 설계 단계 on/off. 기본 false=실행(미설정 시 기존 동작 그대로).
alter table brainstorm_runs add column if not exists skip_skeleton boolean not null default false;

-- [누적 리서치 topic 유사도 필터 토글] 모드 A 브레인스토밍 자체의 누적 참고, 그리고 재개선
-- "누적 데이터도 참고" 두 경로 각각에 독립적으로 적용(용도가 달라 컬럼도 분리).
alter table brainstorm_runs add column if not exists topic_filter_accumulated boolean not null default true; -- 모드 A 브레인스토밍용
alter table brainstorm_runs add column if not exists reimprove_topic_filter boolean not null default true;   -- 재개선(누적 데이터 참고)용
alter table tasks add column if not exists accumulated_topic_filter boolean not null default true; -- generate task에 승계되는 값

-- [Q4 누적 충분 시 웹검색 자동 스킵] 웹검색(research/research-voice) 전에 pg_trgm으로 관련 누적
-- 리서치 개수를 세서, 임계값 이상이면 새 웹검색을 건너뛰고 누적만 쓴다(시간·비용 절약).
-- 기본 OFF(미설정 시 기존 동작 그대로 — 팀원 무영향). match_research_by_topic RPC에 의존.
alter table brainstorm_runs add column if not exists auto_skip_if_accumulated boolean not null default false;
alter table brainstorm_runs add column if not exists auto_skip_threshold int not null default 10;
