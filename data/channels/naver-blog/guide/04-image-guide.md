---
type: guide
role: image
stages: [image-gen]
---

# 04. 이미지 카드 가이드

> **역할**: 이미지 카드 타입별 디자인 규격과 HTML+CSS 구조.
> 이미지를 배치할지 말지의 판단 기준(개수·위치)은 writer 단계 책임(`01-writing-guide.md` 9절) —
> 이 문서는 "카드를 어떻게 만드는가"만 다룬다.
> 글 한 편당 카드 총 수량: **4~6장** (썸네일 1 + 본문 카드 N).
> 각 카드는 실제 이미지 파일이 아니라 **인라인 HTML/CSS 마크업**으로 완성해 본문에 직접 삽입된다
> (스크린샷 캡처 과정 없음 — 작성한 HTML이 곧 최종 결과물).

---

## 1. 대표 카드 (썸네일) — image-gen이 작성하지 않는다

**첫 번째 `[IMAGE: ...]` 마커(대표 썸네일)는 image-gen 단계가 손으로 그리지 않는다.** 색상·레이아웃이
매번 조금씩 달라지며 반복적으로 문제가 생겨서(디자인 편차, 마커 문법 혼동으로 인한 텍스트 노출 등),
`templates/thumbnail-template.html` 마크업을 코드가 그대로 불러와 제목·부제·마스코트만 결정적으로
채워 넣는 방식으로 바뀌었다. **image-gen에게 오는 요청에는 이미 이 사실이 명시되어 있으므로, 첫 번째
마커분 카드는 작성하지 말고 두 번째 마커부터 작성한다.**

디자인 자체를 바꾸고 싶으면(색상·레이아웃 등) `templates/thumbnail-template.html` 파일을 직접
수정한다 — 그 파일 하나만 고치면 이후 생성되는 모든 글에 동일하게 적용된다.

---

## 1-1. B2B 맥락 필수 준수 (절대 규칙, 모든 카드 공통)

이 블로그는 B2B 마케팅 콘텐츠다. 독자는 기업 담당자(운영팀장·CS팀장·대표)이며, 목표는 "CS쉐어링
서비스를 도입해야겠다"는 판단을 유도하는 것이다.

- **허용**: 콜센터 상담 화면·헤드셋·CRM 대시보드, 업무 그래프·KPI 수치 카드, 비용 비교표,
  플로우차트(CS 운영 흐름), 기업 담당자 아이콘, CS쉐어링 서비스 명칭·로고
- **금지**: 소비재 제품 이미지(에어컨·선풍기·가전·의류 등), 소비자(B2C) 쇼핑 장면, 계절
  풍경·날씨 아이콘, 일반 생활 사진 소재
- 카드 안에 들어가는 텍스트·아이콘·도식은 모두 **CS 업무·콜센터·기업 운영** 맥락으로만 구성한다.

---

## 2. 본문 카드 — 브랜드 카드 템플릿 (필수 적용)

**본문에 들어가는 카드는 아래 브랜드 카드 템플릿을 기본 프레임으로 사용한다.**
배경은 항상 옅은 회색 계열 그라디언트(2-1절 템플릿 고정값), 강조색은 딥 네이비블루(`#234b73`). 카드마다 배경·색조를 바꾸지 않는다.
(순백 `#ffffff`은 쓰지 않는다 — 네이버 블로그 본문 배경·컨테이너도 흰색이라 카드 경계가 안 보이게 된다.)

**모든 소제목마다 카드를 만드는 것이 목적이 아니다.** 카드는 시각적 요약·강조가 실제로 도움이 되는
지점에만 선택적으로 배치한다 (전체 카드 4~6장 예산 안에서 배분).

- **비교표·수치 나열형 정보**(요금·항목별 대조·전후 수치 등)는 카드로 만들지 않고 **본문 마크다운
  표**로 작성하도록 writer 단계에서 이미 처리되어 있어야 한다 — image-gen은 이런 정보를 카드로
  다시 만들지 않는다.
- 카드는 소제목 요약, 인용, 임팩트 있는 대조, 플로우 등 **표로 담기 어려운 내용**에 우선 사용한다.
  비교·강조할 게 없는 평범한 서술형 소제목에는 카드를 억지로 만들지 않는다 — 카드는 "매 문단마다"가
  아니라 "정말 강조할 포인트가 있는 곳"에만 쓴다.

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

**여백은 8px 배수(8·16·24·32·44px)만 쓴다 — 임의 수치 금지.** "세련됨"은 장식을 더하는 게 아니라
여백·정렬이 일관될 때 나온다. 패딩·마진·gap 값을 이 스케일 밖에서 임의로 정하면 카드마다 미묘하게
다른 여백이 쌓여 전체적으로 정돈되지 않은 인상을 준다.

**아이콘/숫자와 한 줄짜리 텍스트가 나란히 배치되는 요소는 세로 중앙 정렬을 명시한다.**
`display:flex`로 묶고 `align-items:center`를 지정한다 — 지정하지 않으면 브라우저 기본값
(stretch/baseline) 때문에 텍스트가 아이콘·박스 안에서 위나 아래로 치우쳐 보인다(PM 피드백: "카드
텍스트가 도형 안에서 아래로 쏠려 보인다"). 배지·태그·CTA 버튼처럼 아이콘/숫자와 텍스트의 줄 수가
같은 경우에 적용한다. 반대로 번호 카드(2-2절 ②)처럼 숫자 옆에 제목+설명 등 **여러 줄 텍스트**가
오면 `align-items:flex-start`로 상단 정렬하는 게 맞다 — 숫자를 첫 줄 높이에 맞추는 의도적 디자인
이니 이 경우까지 center로 바꾸지 않는다.

### 2-1. 브랜드 카드 HTML 템플릿

> 2026-07-07 업데이트: PM 피드백(디자인이 급조된 느낌·가독성) 반영 — 플랫 배경을 미세한
> 그라디언트로, 딱딱한 테두리를 부드러운 그림자로 바꾸고, 보조 텍스트 색을 진하게 조정해
> 가독성을 확보했다. 800px 고정폭 등 나머지 브랜드 규칙은 그대로다.
> 2026-07-08 업데이트: 강조색을 스카이블루(#1e90d6)에서 딥 네이비블루(#234b73)로 교체하고,
> 배경 그라디언트를 살짝 더 진하게, CTA 버튼을 평면 채우기 대신 그라디언트+그림자로 바꿨다.

```html
<div style="font-family:'Malgun Gothic','맑은 고딕',sans-serif;
            background:linear-gradient(175deg, #f1f3f7 0%, #e3e8ee 100%);
            width:800px; padding:44px 44px 36px; box-sizing:border-box;
            border-radius:18px;
            box-shadow:0 1px 2px rgba(20,32,46,.06), 0 20px 48px rgba(20,32,46,.11);">

  <!-- 상단 컨텍스트 바 -->
  <div style="display:flex; align-items:center; gap:9px; margin-bottom:24px;">
    <div style="width:3px; height:13px; background:#234b73; flex-shrink:0;"></div>
    <span style="font-size:12px; color:#7d8792; letter-spacing:0.4px;">
      [글 제목 축약 — 10~20자]
    </span>
  </div>

  <!-- 메인 헤드라인 (검정 + 네이비블루 2단) -->
  <div style="margin-bottom:10px; line-height:1.32;">
    <div style="font-size:29px; font-weight:700; color:#141d29;">[1행 — 맥락 설명, 검정]</div>
    <div style="font-size:29px; font-weight:700; color:#234b73;">[2행 — 핵심 메시지, 네이비블루]</div>
  </div>

  <!-- 보조 설명 (선택) -->
  <div style="font-size:14.5px; color:#626d78; line-height:1.6; margin-bottom:34px;">[한 줄 서브텍스트]</div>

  <!-- ===== 콘텐츠 영역 — 아래 타입 중 택일 ===== -->
  [콘텐츠 영역]

  <!-- CTA 버튼 (모든 카드 필수, 2줄 중 2행에만 강조 — 화살표 등 장식 기호 없이 텍스트만).
       평면 단색 채우기는 밋밋해 보인다는 피드백으로 같은 색 계열 그라디언트+그림자로 입체감을 준다 -->
  <div style="background:linear-gradient(160deg, #4a80ab 0%, #16324f 100%);
              color:#fff; text-align:center;
              padding:17px 20px; border-radius:11px; font-size:15px;
              margin-top:30px; line-height:1.5;
              box-shadow:0 14px 24px -12px rgba(15,42,66,.55), inset 0 1px 0 rgba(255,255,255,.18);">
    <span style="font-weight:600;">[행동 유도 문장 1행]</span><br>
    <span style="font-weight:700;">[행동 유도 문장 2행]</span>
  </div>

  <!-- CS쉐어링 워터마크 -->
  <div style="text-align:right; margin-top:16px;
              font-size:11.5px; color:#9aa2ad; font-weight:600; letter-spacing:0.6px;">
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
<div style="text-align:center; font-size:22px; color:#234b73; margin-bottom:12px;">»</div>
<div style="background:#eef1f5; border-radius:8px;
            padding:14px 16px; font-size:14px; color:#234b73;
            font-weight:600; text-align:center;">
  [핵심 결론 1~2줄]
</div>
```

**② 번호 카드 타입**

> 회색 박스 + 원형 숫자 배지 대신, 연한 대형 숫자("고스트 넘버")를 여백 장치로 쓰는 방식으로
> 바꿨다 — 박스 나열형은 흔한 AI 인포그래픽 패턴처럼 보이기 쉽고, 이 방식이 더 에디토리얼하게
> 읽힌다. 항목 사이는 박스 대신 얇은 구분선(첫 항목 제외)으로 나눈다. 구분선 색(`#c9d2dc`)은
> 카드 배경(2-1절)보다 한 단계 더 진하게 잡아야 한다 — 배경과 거의 같은 톤이면 구분선이 묻혀서
> 안 보이게 된다.

```html
<div style="display:flex; flex-direction:column;">
  <div style="display:flex; align-items:flex-start; gap:18px; padding:18px 0;">
    <div style="font-size:40px; font-weight:700; color:#234b73; opacity:.18;
                line-height:1; flex-shrink:0; width:46px;">01</div>
    <div>
      <div style="font-size:14.5px; color:#234b73; font-weight:700; margin-bottom:4px;">[항목 제목]</div>
      <div style="font-size:14px; color:#414b56; line-height:1.55;">[이유 설명 1줄 — 강조할 부분은 <b style="color:#2f3942;">굵게</b>]</div>
    </div>
  </div>
  <div style="display:flex; align-items:flex-start; gap:18px; padding:18px 0; border-top:1px solid #c9d2dc;">
    <div style="font-size:40px; font-weight:700; color:#234b73; opacity:.18;
                line-height:1; flex-shrink:0; width:46px;">02</div>
    <div>
      <div style="font-size:14.5px; color:#234b73; font-weight:700; margin-bottom:4px;">[항목 제목]</div>
      <div style="font-size:14px; color:#414b56; line-height:1.55;">[이유 설명 1줄]</div>
    </div>
  </div>
  <!-- 3~5번도 동일 구조로 반복 (border-top 유지, 숫자만 03/04/05로) -->
</div>
```

**③ 배지 + 2열 카드 타입**
```html
<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
  <span style="display:flex; align-items:center; height:26px; background:#eef1f5; color:#234b73;
               border:1px solid rgba(35,75,115,.18); border-radius:20px;
               padding:0 13px; font-size:13px; font-weight:600;">[태그 1]</span>
  <span style="display:flex; align-items:center; height:26px; background:#eef1f5; color:#234b73;
               border:1px solid rgba(35,75,115,.18); border-radius:20px;
               padding:0 13px; font-size:13px; font-weight:600;">[태그 2]</span>
</div>
<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
  <div style="background:#f7f9fc; border-radius:8px; padding:14px;">
    <div style="font-size:13px; font-weight:700; color:#234b73; margin-bottom:4px;">[특징 A]</div>
    <div style="font-size:12px; color:#555;">[설명 1줄]</div>
  </div>
  <div style="background:#f7f9fc; border-radius:8px; padding:14px;">
    <div style="font-size:13px; font-weight:700; color:#234b73; margin-bottom:4px;">[특징 B]</div>
    <div style="font-size:12px; color:#555;">[설명 1줄]</div>
  </div>
</div>
```

**④ 비교 표 타입**
```html
<table style="width:100%; border-collapse:collapse; font-size:13px;">
  <tr style="background:#234b73; color:#fff;">
    <th style="padding:10px 12px; text-align:left; border:1px solid #1a3a58;">구분</th>
    <th style="padding:10px 12px; text-align:center; border:1px solid #1a3a58;">[대상 A]</th>
    <th style="padding:10px 12px; text-align:center; border:1px solid #1a3a58;">[대상 B]</th>
  </tr>
  <tr>
    <td style="padding:10px 12px; border:1px solid #e0e0e0;">[항목 1]</td>
    <td style="padding:10px 12px; text-align:center; border:1px solid #e0e0e0; color:#888;">[값]</td>
    <td style="padding:10px 12px; text-align:center; border:1px solid #e0e0e0; color:#234b73; font-weight:700;">[값]</td>
  </tr>
</table>
```

**⑤ 소제목 요약 카드 타입**
```html
<div style="background:#eef1f5; border-left:4px solid #234b73;
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
| 배경 | 항상 옅은 회색 계열 미세 그라디언트(`linear-gradient(175deg, #f1f3f7, #e3e8ee)`, 2-1절 템플릿 고정값). 순백(`#ffffff`)·어두운 배경 모두 금지 |
| 강조색 | `#234b73` (딥 네이비블루) 단일 사용. 임의로 색상 추가 금지 — 단, CTA 버튼은 이 색 계열 안에서 그라디언트를 쓸 수 있다(2-1절 참고) |
| 카드 크기 | 폭 800px 고정 + 카드 타입별 목표 높이(1절 표) 준수 |
| 여백 스케일 | 8px 배수(8·16·24·32·44px)만 사용 — 스케일 밖 임의 수치 금지 (2절 참고) |
| 썸네일 크기 | 720 × 720px |
