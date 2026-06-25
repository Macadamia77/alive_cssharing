# CS쉐어링 블로그 자동화 시스템

CS쉐어링 네이버 블로그 마케팅 글 작성을 자동화하는 멀티 에이전트 시스템.

---

## 폴더 구조

```
agents/   — 각 단계별 서브 에이전트 지침
guide/    — 글쓰기·SEO·이미지·발행 가이드 (에이전트가 참조, 07/08은 발행서식·CTA·브랜드 자산 레퍼런스)
output/   — 주제별 산출물 (research.md / draft.md / images / final.*)
assets/   — 주제와 무관한 영구 브랜드 자산 (assets/brand/ — 로고·마스코트·템플릿 이미지, image-maker가 자동 스캔)
```

---

## 작업 흐름 (사용자가 주제를 주면 순서대로 실행)

**Step 1 — 리서치** (`agents/researcher.md`)
→ `output/[주제]/research.md` 생성
→ 완료 후 사용자에게 알림: "리서치 완료. 글쓰기를 시작합니다."

**Step 2 — 글쓰기** (`agents/writer.md`)
→ `output/[주제]/draft.md` 생성
→ 완료 후 사용자에게 알림: "초안 완료. 이미지 제작을 시작합니다."

**Step 3 — 이미지 제작** (`agents/image-maker.md`)
→ `output/[주제]/images/` 생성 + `draft.md` 마커 치환
→ 완료 후 사용자에게 알림: "이미지 완료. 최종 파일을 조립합니다."

**Step 4 — 조립** (`agents/assembler.md`)
→ `output/[주제]/final.md` + `output/[주제]/final.html` 생성
→ 완료 후 사용자에게 알림: "완료. final.html을 브라우저로 확인하세요."

---

## 절대 규칙

- 메인(오케스트레이터)은 **직접 리서치·글쓰기·이미지 제작을 하지 않는다.**
- 모든 작업은 서브 에이전트에게 위임한다.
- 각 단계 완료 시 반드시 사용자에게 한 줄로 진행 상황을 알린다.
