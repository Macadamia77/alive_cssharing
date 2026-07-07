---
type: guide
role: figma-contract
stages: [writer, content-review]
---

# Instagram / Facebook Figma 출력 계약

## 고정 필드
- 최종 결과는 JSON만 출력한다.
- planning은 문자열, hashtags는 문자열 배열, cards는 카드 배열이다.
- 1번 카드 template_name은 Instagram post - first, 중간 카드는 Instagram post - middle, 마지막 카드는 Instagram post - CTA다.
- 첫 장 layout_type은 cover, CTA 장 layout_type은 cta다.
- 1번 카드만 cloud_label을 사용하고 값은 Insight, Service, CS 기본상식 중 하나다.
- 중간 카드와 CTA 카드의 cloud_label은 빈 문자열이다.

## 카드 필드
- title, subtitle, items는 Figma 카드에 직접 들어간다.
- body는 웹 미리보기·검수용 요약이며 Figma 카드에 직접 넣지 않는다.
- series_title은 중간 카드 상단 시리즈명이다.
- first와 CTA 카드 items는 빈 배열이다.
- first와 CTA 카드 highlight_text는 빈 문자열이다.
- middle 카드 highlight_text는 title 안에 실제 포함된 문구일 때만 사용한다.
- cta 필드는 카드 하단에 파란 글씨로 표시되는 보조 문구다. 마지막(CTA) 카드에서는 실제 행동 유도 문구(연락처 등)로 쓰고, 중간 카드에서는 그 카드에 인용한 수치의 출처로 쓴다.
- 중간 카드의 title/subtitle/highlight_text/items 어디든 "N%"나 "N배" 같은 구체적 성과 수치를 썼다면, 그 카드의 cta에 반드시 출처를 남긴다. 예: `"cta": "(출처: cssharing.com 인사이트 - 고객센터 반복문의, 인력 아닌 구조로 줄이는 법)"`. 수치를 인용하지 않은 중간 카드는 cta를 빈 문자열로 둔다 — 억지로 채우지 않는다.

## layout_type과 items
- steps_vertical: 2~4개
- compare_2col: 반드시 2개
- flow_process: 3~4개, 실제 처리 순서가 있을 때만
- keyword_boxes: 3~4개
- stacked_boxes: 2~3개
- 일반 흐름인 문의 접수 → 유형 분류 → 정책 확인 → 맞춤 응대를 flow_process로 만들지 않는다.

## 길이
- 중간 카드 title은 반드시 2줄이다. 줄바꿈(\n)은 정확히 1번만 사용한다. 3줄 이상 절대 금지. 각 줄은 반드시 15자 이내(공백 포함). 예시: "비용 부담과\n운영 난이도 상승"
- 중간 카드 subtitle은 줄바꿈 없이 1줄이다.
- 1번 카드 subtitle은 빈 문자열("")이 아닌 실제 소제목을 반드시 작성해야 한다. title을 보완하는 한 줄 소제목 (10자 이내, 줄바꿈 없음).
- item.body는 길게 해설하지 않고 박스 안에 들어가는 짧은 설명형 문장으로 작성한다.

## JSON 골격
```json
{
  "planning": "",
  "content_title": "",
  "cards": [
    {
      "card_no": 1,
      "card_type": "후킹 카드",
      "template_name": "Instagram post - first",
      "layout_type": "cover",
      "cloud_label": "Insight",
      "series_title": "",
      "title": "",
      "highlight_text": "",
      "subtitle": "주제 소제목",
      "body": "",
      "items": [],
      "cta": "",
      "design_point": ""
    },
    {
      "card_no": 2,
      "card_type": "중간 카드",
      "template_name": "Instagram post - middle",
      "layout_type": "stacked_boxes",
      "cloud_label": "",
      "series_title": "시리즈 제목",
      "title": "카드 제목\n두 번째 줄",
      "highlight_text": "강조 문구",
      "subtitle": "카드 부제목 한 줄",
      "body": "웹 미리보기용 요약 (Figma에 직접 넣지 않음)",
      "items": [
        { "title": "아이템 제목", "body": "아이템 설명 짧은 문장" },
        { "title": "아이템 제목", "body": "아이템 설명 짧은 문장" },
        { "title": "아이템 제목", "body": "아이템 설명 짧은 문장" }
      ],
      "cta": "",
      "design_point": ""
    }
  ],
  "caption": "",
  "hashtags": []
}
```

## items 필드 규칙
- items 배열 내 각 객체는 기본적으로 `title`과 `body` 두 필드만 사용한다.
- `title`: 박스 안 핵심 키워드 또는 짧은 제목 (1줄)
- `body`: 박스 안 설명 문장 (1~2줄, 짧게)
- 다른 필드명(text, label, description, content 등)은 사용하지 않는다.
- 예외: compare_2col은 기본적으로 나쁨/좋음이 갈리는 대비 구도로 간주하며, 이 경우 각 item에 `tone` 필드("bad" 또는 "good")를 붙인다. Figma·미리보기에서 bad는 빨간 X 배지, good은 파란 O 배지로 표시된다. 역할 분담이나 병렬 긍정 나열처럼 나쁨/좋음이 없는 예외적인 경우에만 tone을 생략한다(06-content-rules.md 참고).
