-- 전역 앱 설정 키-값 저장소 (Supabase 대시보드 → SQL Editor에서 1회 실행, 재실행해도 안전)
--
-- 배경: "리서치 전용 provider" 설정은 지금 쿠키에만 저장돼 있어, 브라우저/쿠키를 지우면
-- 유실된다(activeProvider는 GitHub ai-config.json에 백업되지만 researchProvider는 그런
-- 백업이 없었음). GitHub 파일 쓰기 대신 이미 서비스 저장소로 쓰고 있는 Supabase에 작은
-- 키-값 테이블을 하나 둬서, 쿠키(빠른 1순위) → 이 테이블(내구성 있는 폴백) 순으로 읽는다.
-- 이 앱은 팀 전체가 공유하는 단일 설정이라(사용자별 행 아님) key-value 한 테이블로 충분하다.
--
-- 보안: pipeline_* 테이블과 동일하게 RLS on + 공개 정책 없음(=service_role 전용).
create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
