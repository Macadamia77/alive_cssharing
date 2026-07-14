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

-- pipeline_research : 웹서치(리서치) 단계 산출물 아카이브. 생성 시 자동 저장, 자료실에서 열람.
create table if not exists pipeline_research (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null,
  stage      text not null,   -- research | research-voice
  topic      text,
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_research_channel
  on pipeline_research (channel, created_at desc);

-- 보안: channel_files와 동일하게 service_role만 접근(RLS on + 공개 정책 없음).
-- ⚠️ Vercel에 SUPABASE_SERVICE_ROLE_KEY가 있어야 웹에서 피드백 저장이 됩니다.
--    (없으면 channel_files처럼 웹 쓰기가 막힘 → 그 경우 아래 alter를 disable로)
alter table pipeline_feedback enable row level security;
alter table pipeline_examples enable row level security;
alter table pipeline_bad_examples enable row level security;
alter table pipeline_research enable row level security;

-- (임시로 익명 접근을 허용해야 한다면 위 두 줄 대신 아래를 사용 — 보안↓)
-- alter table pipeline_feedback disable row level security;
-- alter table pipeline_examples disable row level security;

-- [누적 리서치 topic 유사도 필터] 브레인스토밍/재개선이 참고하는 "누적 리서치"가 지금까지는
-- 최신순으로만 뽑혀서 주제와 무관한 과거 자료가 섞여 들어갈 수 있었다. pg_trgm 문자열 유사도로
-- 1차 필터한다(임베딩 없이 가장 싼 방식 — 정확한 의미 기반은 아니지만 완전 무관한 주제는 걸러줌).
create extension if not exists pg_trgm;
create index if not exists idx_pipeline_research_topic_trgm
  on pipeline_research using gin (topic gin_trgm_ops);

-- set_config로 이 호출에서만(transaction-local, is_local=true) pg_trgm.similarity_threshold를
-- 낮춰서 "%" 연산자가 호출자가 넘긴 min_similarity를 쓰게 한다 — similarity() 함수를 WHERE에서
-- 직접 비교하면 위 GIN 인덱스를 못 타므로, 인덱스가 실제로 먹히려면 "%" 연산자를 써야 한다.
create or replace function match_research_by_topic(
  query_topic text,
  min_similarity float default 0.25,
  match_limit int default 5,
  max_age_days int default 30
)
returns setof pipeline_research
language plpgsql
stable
as $$
begin
  perform set_config('pg_trgm.similarity_threshold', min_similarity::text, true);
  return query
    select *
    from pipeline_research
    where topic is not null
      and stage in ('research', 'research-voice')
      and created_at >= now() - (max_age_days || ' days')::interval
      and topic % query_topic
    order by similarity(topic, query_topic) desc
    limit match_limit;
end;
$$;
