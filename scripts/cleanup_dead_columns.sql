-- 죽은 스키마 정리: 코드베이스 어디에서도 참조되지 않는 컬럼/RPC 제거.
-- Supabase 대시보드 → SQL Editor에 붙여 1회 실행. 재실행해도 안전(if exists).
--
-- 대상은 전부 scripts/*_schema.sql(트래킹된 마이그레이션)에도 없고, src/ · render-worker/
-- 어디에도 참조가 없는 것을 grep으로 확인함 — "주제 중복 필터"를 pg_trgm 유사도로 구현하려던
-- 실험이 라이브 DB에만 반영되고 커밋되지 않은 채 남은 것으로 보임(2026-07-12 코드 감사).
-- 실제 주제 중복 회피는 pipelineMemory.ts::getRecentResearch() + 브레인스토머 LLM의
-- overlap_check 필드로 이미 처리되고 있어, 이 컬럼/함수들은 지금 지워도 동작에 영향 없음.

-- 1) 브레인스토밍 파이프라인이 실제로 쓰지 않는 토글 컬럼
alter table brainstorm_runs drop column if exists topic_filter_accumulated;
alter table brainstorm_runs drop column if exists reimprove_topic_filter;
alter table tasks drop column if exists accumulated_topic_filter;

-- 2) 어디서도 호출되지 않는 커스텀 유사도 검색 RPC
drop function if exists match_research_by_topic;

-- 참고: /rpc/show_trgm, /rpc/show_limit 은 위 실험을 위해 활성화된 pg_trgm 확장(extension)이
-- 제공하는 내장 함수라 애플리케이션 코드가 아니다. 이 확장에 의존하는 인덱스/함수가 남아있지
-- 않다면(위 DROP FUNCTION 이후 match_research_by_topic이 유일한 사용처였을 가능성이 높음)
-- 아래 주석을 풀어 확장 자체를 정리할 수 있다 — 단, 이건 되돌리려면 재설치가 필요하니
-- 다른 용도로 pg_trgm(유사도 검색/트라이그램 인덱스)을 쓰는 곳이 없는지 확인 후 실행할 것.
-- drop extension if exists pg_trgm;
