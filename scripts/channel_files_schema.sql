-- 채널 파일 저장용 테이블 (guide/agents/_meta.json/템플릿/이미지 등)
-- Supabase SQL Editor에 붙여넣고 1회 실행.

create table if not exists channel_files (
  channel     text        not null,           -- 예: "naver-blog", "instagram"
  path        text        not null,           -- 예: "guide/01-writing-guide.md", "_meta.json"
  content     text,                            -- 텍스트 내용 (바이너리는 base64 문자열)
  is_binary   boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (channel, path)
);

-- 보안: RLS 켜고 정책 없음 = service_role(서버/워커)만 접근, 브라우저(anon) 완전 차단.
-- 브라우저는 채널 파일을 직접 읽지 않고 API 라우트(service_role)를 경유하므로 anon 정책 불필요.
alter table channel_files enable row level security;

-- (channel, path)가 기본키라 단일 파일 조회는 인덱스로 빠름.
-- 채널별 목록 조회(where channel = ...)도 기본키 선두 컬럼이라 인덱스 활용됨.
