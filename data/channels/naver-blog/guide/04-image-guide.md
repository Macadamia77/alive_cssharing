---
type: guide
role: image
stages: [image-gen]
---

# 04. 이미지 카드 가이드

> **역할**: 이미지 카드 타입별 디자인 규격과 HTML+CSS 구조.
> 이미지를 배치할지 말지의 판단 기준(개수·위치)은 writer 단계 책임(`01-writing-guide.md` 9절) —
> 이 문서는 "카드를 어떻게 만드는가"만 다룬다.
> 글 한 편당 카드 총 수량: **6~8장** (썸네일 1 + 본문 카드 N).
> 각 카드는 실제 이미지 파일이 아니라 **인라인 HTML/CSS 마크업**으로 완성해 본문에 직접 삽입된다
> (스크린샷 캡처 과정 없음 — 작성한 HTML이 곧 최종 결과물).

---

## 1. 대표 카드 (썸네일)

- **규격**: 720 × 720px (1:1 정사각형)
- **배경**: 단색 밝은 스카이블루(`#18A0E8`)
- **레이아웃**:
  - 좌상단: 흰 모서리 장식선
  - 우상단: 로고 자리 — 로고 이미지가 없으면 국문 텍스트 "CS쉐어링"(흰색). **영문 "CS Sharing" 임의
    사용 금지** (공식 로고 미승인 표기이므로)
  - 중앙 상단: 흰 캡슐 배지 (부제/카테고리)
  - 배지 아래: 글 제목 — 흰색, 굵게, 최대 2줄. **본문 최종 확정 제목(PUBLISH 블록 첫 줄)과 문구를
    일치시킨다.** 길이상 줄일 때도 핵심 키워드·의미는 그대로 유지한다.
- **폰트**: 시스템 기본 한글 폰트

---

## 2. 본문 카드 — 브랜드 카드 템플릿 (필수 적용)

**본문에 들어가는 카드는 아래 브랜드 카드 템플릿을 기본 프레임으로 사용한다.**
배경은 항상 옅은 회색(`#F3F3F3`), 강조색은 파란색(`#1e90d6`). 카드마다 배경·색조를 바꾸지 않는다.
(순백 `#ffffff`은 쓰지 않는다 — 네이버 블로그 본문 배경·컨테이너도 흰색이라 카드 경계가 안 보이게 된다.)

**모든 소제목마다 카드를 만드는 것이 목적이 아니다.** 카드는 시각적 요약·강조가 실제로 도움이 되는
지점에만 선택적으로 배치한다 (전체 카드 6~8장 예산 안에서 배분).

- **비교표·수치 나열형 정보**(요금·항목별 대조·전후 수치 등)는 카드로 만들지 않고 **본문 마크다운
  표**로 작성하도록 writer 단계에서 이미 처리되어 있어야 한다 — image-gen은 이런 정보를 카드로
  다시 만들지 않는다.
- 카드는 소제목 요약, 인용, 임팩트 있는 대조, 플로우 등 **표로 담기 어려운 내용**에 우선 사용한다.

**카드 하나만 봐도 내용이 이해되게 쓴다.** 본문 문장을 그대로 잘라 붙이지 말고, 카드 자체가
독립적으로 완결된 메시지(주장 + 핵심 수치/이유)를 전달하도록 카피를 새로 쓴다.

**카드 크기는 모두 동일하게 맞춘다.** 폭은 800px로 고정하고, 같은 타입의 카드끼리는 높이 편차가
크게 나지 않도록 콘텐츠 분량(리스트 항목 수·문장 길이)을 미리 맞춘다.

| 카드 타입 | 목표 높이 |
|---|---|
| 소제목 요약 카드 | 420~500px |
| 말풍선 / 번호 카드 / 배지+2열 카드 | 480~580px |
| 비교 표 카드(표로 대체 못 하는 경우만) | 480~600px |

글 전체 카드(썸네일 제외) 높이의 편차가 너무 크면 "카드 크기가 들쭉날쭉하다"는 인상을 준다 —
콘텐츠 분량(리스트 항목 수·문장 길이)을 위 목표 높이에 맞게 조절한다.

### 2-1. 브랜드 카드 HTML 템플릿

```html
<div style="font-family:'Malgun Gothic','맑은 고딕',sans-serif;
            background:#F3F3F3; width:800px; padding:32px 36px 28px;
            box-sizing:border-box; border:1px solid #e0e0e0;">

  <!-- 상단 컨텍스트 바 -->
  <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px;">
    <div style="width:3px; height:14px; background:#1e90d6; flex-shrink:0;"></div>
    <span style="font-size:12px; color:#aaa; letter-spacing:0.3px;">
      [글 제목 축약 — 10~20자]
    </span>
  </div>

  <!-- 메인 헤드라인 (검정 + 파랑 2단) -->
  <div style="margin-bottom:8px; line-height:1.3;">
    <div style="font-size:26px; font-weight:700; color:#1a1a1a;">[1행 — 맥락 설명, 검정]</div>
    <div style="font-size:26px; font-weight:700; color:#1e90d6;">[2행 — 핵심 메시지, 파랑]</div>
  </div>

  <!-- 보조 설명 (선택) -->
  <div style="font-size:14px; color:#777; margin-bottom:24px;">[한 줄 서브텍스트]</div>

  <!-- ===== 콘텐츠 영역 — 아래 타입 중 택일 ===== -->
  [콘텐츠 영역]

  <!-- 파란 CTA 버튼 (모든 카드 필수) -->
  <div style="background:#1e90d6; color:#fff; text-align:center;
              padding:14px 20px; border-radius:8px; font-size:15px;
              font-weight:700; margin-top:24px; line-height:1.4;">
    [행동 유도 문장 — 1~2줄]
  </div>

  <!-- CS쉐어링 워터마크 -->
  <div style="text-align:right; margin-top:12px;
              font-size:12px; color:#ccc; font-weight:600; letter-spacing:0.5px;">
    CS쉐어링
  </div>

</div>
```

### 2-2. 콘텐츠 영역 타입 (5종 — 내용에 맞게 선택)

| 타입 | 사용 시점 |
|---|---|
| **말풍선** | 고객 발화·내부 대화 시나리오 묘사 |
| **번호 카드** | Why?·원인·단계 3~5개 나열 |
| **배지 + 2열 카드** | 특장점·운영 옵션 조합 표현 |
| **비교 표(카드)** | 항목이 2~3개뿐이라 본문 마크다운 표보다 카드 한 장이 더 임팩트 있는 경우만 |
| **소제목 요약 카드** | 시각 요약이 도움이 되는 소제목에 선택적으로 |

**① 말풍선 타입**
```html
<div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
  <div style="background:#f0f0f0; border-radius:16px 16px 16px 4px;
              padding:12px 16px; font-size:14px; color:#333;
              max-width:75%; align-self:flex-start;">
    "[고객 발화 1]"
  </div>
  <div style="background:#f0f0f0; border-radius:16px 16px 16px 4px;
              padding:12px 16px; font-size:14px; color:#333;
              max-width:75%; align-self:flex-start;">
    "[고객 발화 2]"
  </div>
</div>
<div style="text-align:center; font-size:22px; color:#1e90d6; margin-bottom:12px;">»</div>
<div style="background:#e8f4fd; border-radius:8px;
            padding:14px 16px; font-size:14px; color:#1e90d6;
            font-weight:600; text-align:center;">
  [핵심 결론 1~2줄]
</div>
```

**② 번호 카드 타입**
```html
<div style="display:flex; flex-direction:column; gap:8px;">
  <div style="display:flex; align-items:flex-start; gap:12px;
              background:#f7f9fc; border-radius:8px; padding:12px 16px;">
    <div style="width:24px; height:24px; background:#1e90d6; border-radius:50%;
                display:flex; align-items:center; justify-content:center;
                color:#fff; font-size:12px; font-weight:700; flex-shrink:0;">1</div>
    <div>
      <div style="font-size:12px; color:#1e90d6; font-weight:600; margin-bottom:2px;">Why?</div>
      <div style="font-size:14px; color:#333;">[이유 설명 1줄]</div>
    </div>
  </div>
  <!-- 2번, 3번도 동일 구조 -->
</div>
```

**③ 배지 + 2열 카드 타입**
```html
<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
  <span style="background:#e8f4fd; color:#1e90d6; border-radius:20px;
               padding:6px 14px; font-size:13px; font-weight:600;">[태그 1]</span>
  <span style="background:#e8f4fd; color:#1e90d6; border-radius:20px;
               padding:6px 14px; font-size:13px; font-weight:600;">[태그 2]</span>
</div>
<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
  <div style="background:#f7f9fc; border-radius:8px; padding:14px;">
    <div style="font-size:13px; font-weight:700; color:#1e90d6; margin-bottom:4px;">[특징 A]</div>
    <div style="font-size:12px; color:#555;">[설명 1줄]</div>
  </div>
  <div style="background:#f7f9fc; border-radius:8px; padding:14px;">
    <div style="font-size:13px; font-weight:700; color:#1e90d6; margin-bottom:4px;">[특징 B]</div>
    <div style="font-size:12px; color:#555;">[설명 1줄]</div>
  </div>
</div>
```

**④ 비교 표 타입**
```html
<table style="width:100%; border-collapse:collapse; font-size:13px;">
  <tr style="background:#1e90d6; color:#fff;">
    <th style="padding:10px 12px; text-align:left; border:1px solid #1a7bc4;">구분</th>
    <th style="padding:10px 12px; text-align:center; border:1px solid #1a7bc4;">[대상 A]</th>
    <th style="padding:10px 12px; text-align:center; border:1px solid #1a7bc4;">[대상 B]</th>
  </tr>
  <tr>
    <td style="padding:10px 12px; border:1px solid #e0e0e0;">[항목 1]</td>
    <td style="padding:10px 12px; text-align:center; border:1px solid #e0e0e0; color:#888;">[값]</td>
    <td style="padding:10px 12px; text-align:center; border:1px solid #e0e0e0; color:#1e90d6; font-weight:700;">[값]</td>
  </tr>
</table>
```

**⑤ 소제목 요약 카드 타입**
```html
<div style="background:#f0f7ff; border-left:4px solid #1e90d6;
            border-radius:0 8px 8px 0; padding:16px 20px; font-size:15px;
            color:#1a1a1a; line-height:1.6;">
  [소제목의 핵심 메시지 — 1~2문장, 구체적 수치 포함]
</div>
```

---

## 3. 공통 제작 규칙

| 항목 | 규칙 |
|---|---|
| 제작 방식 | 인라인 HTML + CSS (외부 리소스 로드 없음) |
| 폰트 | 시스템 기본 한글 폰트 |
| 배경 | 항상 옅은 회색(`#F3F3F3`). 순백(`#ffffff`)·어두운 배경 모두 금지 |
| 강조색 | `#1e90d6` (파란색) 단일 사용. 임의로 색상 추가 금지 |
| 카드 크기 | 폭 800px 고정 + 카드 타입별 목표 높이(1절 표) 준수 |
| 썸네일 크기 | 720 × 720px |
