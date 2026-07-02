# yura 브랜치 src/ 변경사항 요약

> merge 및 pull origin 이전에 진행된 변경사항입니다.

---

## 1. 채널 구조 변경 — facebook 제거 및 instagram 통합

**변경 파일**: `src/lib/channels.ts`, `src/app/api/channels/*/route.ts`, `src/app/guides/*/page.tsx`

- `ChannelKey` 타입에서 `"facebook"` 제거
- `instagram` 채널 label을 `"인스타그램/페이스북"`으로 통합
- VALID 채널 목록, 가이드 페이지, 아이콘 등 전체에서 facebook 항목 제거

---

## 2. Instagram 카드뉴스 미리보기 컴포넌트 신규 추가

**신규 파일**: `src/components/InstagramCardPreview.tsx`

- JSON 구조의 카드뉴스 결과를 웹에서 시각적으로 렌더링
- layout_type별 렌더러: `stacked_boxes`, `keyword_boxes`, `compare_2col`, `steps_vertical`, `flow_process`
- 캡션 / 해시태그 섹션 포함, 각 섹션 복사 버튼 제공

**연결 파일**: `src/components/ChannelResultCard.tsx`, `src/app/results/page.tsx`

- instagram 채널 결과에 카드뉴스 프리뷰 자동 연결
- 결과 목록 카드에서 채널 뱃지 클릭 시 콘텐츠 복사 기능 추가 (`CopyBadge`)

---

## 3. Instagram 생성 로직 개선

**변경 파일**: `src/lib/agentRunner.ts`

- instagram 최대 토큰 수 `4096 → 16000` (한국어 truncation 방지)
- instagram 채널에서 Gemini thinking 비활성화 (`thinkingBudget: 0`) — JSON 구조화 작업에 불필요, 속도 향상
- instagram 채널에서 HTML 이미지 카드 가이드 제외 (JSON 순수 출력 보장)

---

## 4. 로컬 백그라운드 생성 지원

**변경 파일**: `src/app/api/generate/route.ts`

- Supabase 미설정 환경(로컬 개발)에서도 콘텐츠 생성 가능하도록 로컬 파일 기반 태스크 큐 추가
- 태스크 상태(`pending` / `done` / `error`)를 `data/results/.tasks/` 폴더에 저장
- `maxDuration = 300` 설정

---

## 5. 페이지 UX 개선

**변경 파일**: `src/app/page.tsx`

- 페이지 이탈 후 복귀 시 주제·초안 자동 복원 (`sessionStorage` 활용)
- "초안으로 돌아가기" 버튼 추가 (결과 화면 → 초안 화면)
- "새 콘텐츠 생성" 버튼을 "새 주제로 시작"으로 변경, 세션 초기화 포함

---

## 6. 기타

**`src/lib/supabaseClient.ts`**: Supabase URL/Key 미설정 시 placeholder로 대체하여 초기화 에러 방지  
**`src/app/api/drafts/route.ts`**: Gemini 초안 생성 시 `thinkingBudget: 0` 추가
