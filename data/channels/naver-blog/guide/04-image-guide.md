# 05. 이미지 가이드 — image-maker 에이전트 전용

> 이미지 타입별 디자인 규격, HTML+CSS 구조, Playwright 캡처 방법.
> 글 한 편당 이미지 총 수량: **6~8장** (썸네일 1 + 소제목 카드 N + 본문 보조 이미지 1~2).

---

## 1. 대표 이미지 (썸네일) — 브랜드 템플릿 필수 재현

`assets/brand/cs쉐어링 썸네일.png`를 **공식 디자인 스펙**으로 반드시 동일하게 재현한다 (참고용 아님).

- **규격**: 720 × 720px (1:1 정사각형)
- **배경**: 단색 밝은 스카이블루. 제작 전 파일을 Read 도구로 열어 색상을 확인하고 동일하게 쓴다 (대략 `#18A0E8`~`#1CA8F0` — 추정 금지, 반드시 확인 후 맞춤).
- **레이아웃** (좌측 시안 기준, 매 글 동일):
  - 좌상단: 흰 모서리 장식선
  - 우상단: "CS Sharing" 로고 텍스트 (흰색)
  - 중앙 상단: 흰 캡슐 배지 (부제/카테고리)
  - 배지 아래: 글 제목 — 흰색, 굵게, 최대 2줄
  - 좌하단: `assets/brand/cs쉐어링 캐릭터.png`를 `<img>` 태그로 합성 (새로 그리지 않음)
- **폰트**: 시스템 기본 한글 폰트
- 템플릿 파일이 없을 때만: 단색 스카이블루 + 흰 텍스트 중앙 정렬 + 액센트 도형으로 대체

---

## 2. 본문 이미지 — 브랜드 카드 템플릿 (필수 적용)

**모든 본문 이미지는 아래 브랜드 카드 템플릿을 기본 프레임으로 사용한다.**
배경은 항상 흰색, 강조색은 파란색(`#1e90d6`). 이미지마다 배경·색조를 바꾸지 않는다.

### 2-1. 브랜드 카드 HTML 템플릿

```html
<div style="font-family:'Malgun Gothic','맑은 고딕',sans-serif;
            background:#ffffff; width:800px; padding:32px 36px 28px;
            box-sizing:border-box; border:1px solid #e8e8e8;">

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

  <!-- CS Sharing 워터마크 -->
  <div style="text-align:right; margin-top:12px;
              font-size:12px; color:#ccc; font-weight:600; letter-spacing:0.5px;">
    CS Sharing
  </div>

</div>
```

---

### 2-2. 콘텐츠 영역 타입 (5종 — 내용에 맞게 선택)

**타입별 용도**

| 타입 | 사용 시점 |
|---|---|
| **말풍선** | 고객 발화·내부 대화 시나리오 묘사 |
| **번호 카드** | Why?·원인·단계 3~5개 나열 |
| **배지 + 2열 카드** | 특장점·운영 옵션 조합 표현 |
| **비교 표** | 직접 방식 vs 자사 서비스 항목별 대조 |
| **소제목 요약 카드** | 소제목 직후 1장 필수 (소제목명 + 핵심 메시지) |

---

**① 말풍선 타입**

```html
<!-- 콘텐츠 영역 -->
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
<!-- 화살표 -->
<div style="text-align:center; font-size:22px; color:#1e90d6;
            margin-bottom:12px;">»</div>
<!-- 결론 강조 박스 -->
<div style="background:#e8f4fd; border-radius:8px;
            padding:14px 16px; font-size:14px; color:#1e90d6;
            font-weight:600; text-align:center;">
  [핵심 결론 1~2줄]
</div>
```

---

**② 번호 카드 타입**

```html
<!-- 콘텐츠 영역 -->
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

---

**③ 배지 + 2열 카드 타입**

```html
<!-- 콘텐츠 영역 -->
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

---

**④ 비교 표 타입**

```html
<!-- 콘텐츠 영역 -->
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
  <tr style="background:#f7f9fc;">
    <td style="padding:10px 12px; border:1px solid #e0e0e0;">[항목 2]</td>
    <td style="padding:10px 12px; text-align:center; border:1px solid #e0e0e0; color:#888;">[값]</td>
    <td style="padding:10px 12px; text-align:center; border:1px solid #e0e0e0; color:#1e90d6; font-weight:700;">[값]</td>
  </tr>
</table>
```

---

**⑤ 소제목 요약 카드 타입 (소제목당 1장 필수)**

소제목 요약 카드는 동일한 브랜드 카드 프레임을 사용하되, 콘텐츠 영역에 핵심 메시지 강조 박스를 넣는다.

```html
<!-- 콘텐츠 영역 -->
<div style="background:#f0f7ff; border-left:4px solid #1e90d6;
            border-radius:0 8px 8px 0; padding:16px 20px; font-size:15px;
            color:#1a1a1a; line-height:1.6;">
  [소제목의 핵심 메시지 — 1~2문장, 구체적 수치 포함]
</div>
```

---

### 2-3. 뷰포트 크기

- 본문 이미지: `width=800`, `height`는 콘텐츠에 맞게 (`auto` — `full_page=True` 사용)

---

## 3. 공통 제작 규칙

| 항목 | 규칙 |
|---|---|
| 제작 방식 | HTML + CSS → Python + Playwright PNG 캡처 |
| 폰트 | 시스템 기본 한글 폰트 (외부 로드 없이 동작) |
| 배경 | 항상 흰색(`#ffffff`). 어두운 배경 사용 금지 |
| 강조색 | `#1e90d6` (파란색) 단일 사용. 임의로 색상 추가 금지 |
| **아이콘 & 이미지** | **외부 이미지 URL 사용 절대 금지 (warning_icon.png 등 존재하지 않는 경로 엑스박스 유발). 아이콘은 📊, ⚠️, 👤, 📈 등 이모지나 인라인 SVG로 구현** |
| 뷰포트 — 썸네일 | 720 × 720px |
| 뷰포트 — 본문 이미지 | 800px × 콘텐츠 높이 (`full_page=True`) |
| 파일명 | 영문 키워드 파일명. `[슬러그]-thumbnail.png` / `[슬러그]-body-N.png` / `[슬러그]-sub-N.png` |
| 파일 용량 | 500KB 이내. 초과 시 `type="jpeg", quality=85` 압축 |
| 캡션 | 모든 이미지에 1줄 필수 (메인 키워드 자연 포함, 광고 톤 금지) |
| 검수 | 캡처 후 Read 도구로 **1회** 확인. 텍스트 잘림·빈 여백·레이아웃 깨짐만 점검. 문제 없으면 바로 다음으로 진행. |

---

## 4. Playwright 캡처 코드 템플릿

브라우저를 **1회만 실행해** 모든 이미지를 순차 캡처한 뒤 종료한다.

```python
from playwright.sync_api import sync_playwright
import tempfile, pathlib, os

def capture(page_factory, html_content: str, output_path: str,
            width: int = 800, height: int = None):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    viewport_h = height if height else 1200
    page = page_factory(width, viewport_h)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".html",
                                      delete=False, encoding="utf-8") as f:
        f.write(html_content)
        tmp_path = f.name
    page.goto(pathlib.Path(tmp_path).as_uri())
    page.wait_for_timeout(300)
    # height=None이면 콘텐츠 전체 캡처
    page.screenshot(path=output_path, full_page=(height is None))
    page.close()
    os.remove(tmp_path)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page_factory = lambda w, h: browser.new_page(viewport={"width": w, "height": h})

    # 썸네일 (고정 크기)
    capture(page_factory, thumbnail_html, "output/[주제]/images/[슬러그]-thumbnail.png", 720, 720)

    # 본문 이미지 (콘텐츠 높이에 맞게 자동)
    capture(page_factory, body1_html, "output/[주제]/images/[슬러그]-body-1.png", 800, None)
    # ... 나머지도 동일

    browser.close()
```

---

## 5. 산출물

```
output/[주제]/images/
├── [슬러그]-thumbnail.png   # 대표 이미지 (720×720)
├── [슬러그]-sub-1.png       # 소제목 요약 카드 (소제목 개수와 동일)
├── [슬러그]-sub-2.png
├── [슬러그]-body-1.png      # 보조 본문 이미지 (1~2장)
└── ...
```

총 수량 기준: **썸네일 1 + 소제목 카드 N장 + 보조 본문 1~2장 = 6~8장**
