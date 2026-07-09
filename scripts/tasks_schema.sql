-- 워커 작업 큐 테이블 (tasks)
-- Supabase 대시보드 → SQL Editor에 붙여 1회 실행. 재실행해도 안전(if not exists).
--
-- 그동안 이 테이블은 원본 Supabase에서 수동 생성돼 레포에 DDL이 없었다. 새 프로젝트
-- (예: 프리뷰 전용 Supabase)를 세팅할 때 이 파일을 "가장 먼저" 실행해야 이후
-- brainstorm_runs_schema.sql의 `alter table tasks ...`가 성공한다.
--
-- 동작: Vercel(API)이 pending row를 insert → 워커(render-worker)가 폴링해 집어감
--       (pending→processing 낙관적 락) → 결과를 result/card_assets/status에 기록.
--
-- 컬럼은 코드(render-worker/index.ts, src/app/api/{generate,brainstorm}/route.ts)에서
-- 실제로 읽고 쓰는 필드를 전수 조사해 복원했다.
--  * run_id / job_type 은 여기서 만들지 않는다 — run_id는 brainstorm_runs를 참조하는
--    FK라 brainstorm_runs가 먼저 있어야 하므로, brainstorm_runs_schema.sql이
--    `alter table tasks add column ... run_id/job_type`로 추가한다(순서 의존성).

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  channel       text,                              -- 생성 대상 채널. brainstorm/finalize 잡은 null
  topic         text,
  draft         text,
  status        text not null default 'pending',   -- pending → processing/(스테이지명) → completed|failed
  provider      text,                              -- claude|openai|gemini|mock
  api_key       text,                              -- 워커가 집어간 직후 null로 지움(보안)
  github_token  text,                              -- 위와 동일하게 사용 후 null 처리
  suggestions   jsonb,                             -- 사용자 제안(선택)
  result        text,                              -- 생성된 본문/HTML(워커가 채움)
  card_assets   jsonb,                             -- 이미지 카드 PNG 에셋(image-gen 채널만)
  error         text,                              -- 실패 사유
  created_at    timestamptz not null default now()
);
create index if not exists idx_tasks_status_created on tasks (status, created_at);

-- 보안: 다른 테이블과 동일하게 RLS on + 공개 정책 없음(=service_role 전용).
-- ⚠️ Vercel/Railway 양쪽에 SUPABASE_SERVICE_ROLE_KEY가 있어야 읽고 씁니다(anon 키 아님).
alter table tasks enable row level security;
