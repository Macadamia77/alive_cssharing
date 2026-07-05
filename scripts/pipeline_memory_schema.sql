-- 파이프라인 피드백/메모리 테이블 (Phase 4)
-- Supabase 대시보드 → SQL Editor에 붙여 1회 실행.
--
-- pipeline_feedback : 채널별 누적 피드백. 매 생성 시 최근 N개를 writer에 주입해 학습.
-- pipeline_examples : 채널별 "우수작" 결과물. 매 생성 시 최근 N개를 퓨샷(참고작)으로 주입.

create table if not exists pipeline_feedback (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null,
  text       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_feedback_channel
  on pipeline_feedback (channel, created_at desc);

create table if not exists pipeline_examples (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null,
  content    text not null,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_examples_channel
  on pipeline_examples (channel, created_at desc);

-- pipeline_bad_examples : 검수에서 기각된 글 + 사유. 매 생성 시 "이렇게 쓰면 기각됨"으로 주입(부정 퓨샷).
create table if not exists pipeline_bad_examples (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null,
  content    text not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_bad_examples_channel
  on pipeline_bad_examples (channel, created_at desc);

-- 보안: channel_files와 동일하게 service_role만 접근(RLS on + 공개 정책 없음).
-- ⚠️ Vercel에 SUPABASE_SERVICE_ROLE_KEY가 있어야 웹에서 피드백 저장이 됩니다.
--    (없으면 channel_files처럼 웹 쓰기가 막힘 → 그 경우 아래 alter를 disable로)
alter table pipeline_feedback enable row level security;
alter table pipeline_examples enable row level security;
alter table pipeline_bad_examples enable row level security;

-- (임시로 익명 접근을 허용해야 한다면 위 두 줄 대신 아래를 사용 — 보안↓)
-- alter table pipeline_feedback disable row level security;
-- alter table pipeline_examples disable row level security;
