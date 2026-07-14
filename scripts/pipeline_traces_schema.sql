-- 파이프라인 트레이스: 채널 생성(runPipeline)과 shared 단계의 각 단계/이벤트를 기록해
-- 웹에서 "어떤 persona·model·가이드 순서·프롬프트·산출물이 실제로 쓰였는지"를 검수하게 한다.
-- 워커가 fire-and-forget로 append(생성 로직은 절대 이 쓰기를 기다리지 않음), 웹은 task_id/run_id로
-- 조회한다(요약 리스트는 폴링, 프롬프트 전문 등 상세는 클릭 시 1회 로드).
create table if not exists pipeline_traces (
  id uuid primary key default gen_random_uuid(),
  task_id uuid,               -- 채널 generate task (channel 경로). shared 단계는 null일 수 있음
  run_id uuid,                -- brainstorm run (shared 경로/채널-공통 연결용)
  channel text,               -- 채널 생성일 때 채널명, shared면 null
  seq int not null default 0, -- 한 task/run 내 이벤트 순서(UI 정렬용)
  stage text,                 -- 단계 id('context' 포함)
  kind text,                  -- producer/writer/reviewer/image
  phase text,                 -- context | stage | output | verdict
  data jsonb,                 -- 요약(persona/model/guides[]/counts/verdict) + 상세(prompt/output)
  created_at timestamptz not null default now()
);
alter table pipeline_traces enable row level security;
create index if not exists pipeline_traces_task_idx on pipeline_traces(task_id, seq);
create index if not exists pipeline_traces_run_idx  on pipeline_traces(run_id, seq);

-- ⚠️ RLS: 이 프로젝트는 현재 RLS를 임시 롤백해 운영 중일 수 있다(다른 테이블과 동일하게 맞출 것).
--   - 워커는 service_role 키라 RLS를 우회한다.
--   - 웹 조회가 anon 키로 돈다면, RLS를 끄거나(다른 테이블과 동일) select 정책을 추가해야 읽힌다.
-- alter table pipeline_traces disable row level security;   -- 다른 테이블이 롤백 상태면 이걸로 맞춤

-- [TTL 청소] 트레이스는 생성마다 여러 행씩 무한정 쌓인다 — 주기적으로 오래된 것을 지운다(권장: 14일).
--   Supabase SQL Editor에서 주기 실행하거나 cron/pg_cron으로:
-- delete from pipeline_traces where created_at < now() - interval '14 days';
