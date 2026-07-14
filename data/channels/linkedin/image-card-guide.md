---
type: guide
role: image
stages: [image-gen]
---

[이미지 카드]
콘텐츠에 이미지/인포그래픽이 필요한 위치에는 아래 형식의 HTML 카드를 직접 삽입하세요.
(CS쉐어링 B2B 맥락: 콜센터·CS 운영·기업 담당자 소재만 사용, 소비재·생활 이미지 금지)
<figure style="font-family:'맑은 고딕','Malgun Gothic',sans-serif;background:#fff;border:1px solid #e0e8f0;border-radius:10px;padding:24px 28px;margin:20px 0;box-shadow:0 2px 8px rgba(30,144,214,0.07);">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
    <div style="width:3px;height:14px;background:#1e90d6;border-radius:2px;"></div>
    <span style="font-size:12px;color:#aaa;">CS쉐어링</span>
  </div>
  <div style="font-size:22px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">[헤드라인 1행]</div>
  <div style="font-size:22px;font-weight:700;color:#1e90d6;margin-bottom:16px;">[핵심 메시지 2행]</div>
  [내용: 번호 목록 / 비교표 / 소제목 요약 등 — 내용에 맞게 선택]
  <div style="background:#1e90d6;color:#fff;text-align:center;padding:13px;border-radius:7px;font-size:15px;font-weight:700;margin-top:20px;">CS쉐어링 문의 ☎ 1522-5539</div>
  <div style="text-align:right;font-size:11px;color:#ccc;margin-top:10px;letter-spacing:0.5px;">CS Sharing</div>
</figure>

[도표·비교·프로세스는 inline SVG로]
카드 `[내용]` 자리에 **비교표·프로세스 흐름·화살표·막대 수치 비교**가 필요하면, 카드 `<figure>` 안에 inline `<svg>`를 그대로 써 넣으세요 — 별도 처리 없이 그대로 이미지로 렌더됩니다. (단순 2~3열 표는 HTML `<table>`도 무방. 화살표·흐름·도형이 들어가면 SVG가 정확합니다.)

규칙:
- `viewBox`를 반드시 지정하고 `width="100%"`로 카드 안쪽 폭(약 750px)에 맞춥니다.
- 색: 강조 `#1e90d6`, 본문 `#1a1a1a`, 보조 회색 `#64748b`/`#cbd5e1`. 폰트 `'맑은 고딕','Malgun Gothic',sans-serif`, 크기 13px 이상.
- 텍스트가 도형 밖으로 넘치지 않게 `text-anchor`로 정렬하고 문구는 짧게. 리서치 근거 없는 수치는 그래프화 금지.

예시 1 — 프로세스 흐름(화살표):
```html
<svg viewBox="0 0 750 90" width="100%" style="font-family:'맑은 고딕',sans-serif;">
  <defs><marker id="arw" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#1e90d6"/></marker></defs>
  <rect x="8" y="25" width="200" height="44" rx="8" fill="#eaf4fc" stroke="#1e90d6"/>
  <text x="108" y="52" text-anchor="middle" font-size="15" fill="#1a1a1a">문의 접수</text>
  <line x1="214" y1="47" x2="286" y2="47" stroke="#1e90d6" stroke-width="2" marker-end="url(#arw)"/>
  <rect x="292" y="25" width="200" height="44" rx="8" fill="#eaf4fc" stroke="#1e90d6"/>
  <text x="392" y="52" text-anchor="middle" font-size="15" fill="#1a1a1a">AI 1차 분류</text>
  <line x1="498" y1="47" x2="570" y2="47" stroke="#1e90d6" stroke-width="2" marker-end="url(#arw)"/>
  <rect x="576" y="25" width="166" height="44" rx="8" fill="#1e90d6"/>
  <text x="659" y="52" text-anchor="middle" font-size="15" fill="#fff">전문 상담사</text>
</svg>
```

예시 2 — 막대 수치 비교:
```html
<svg viewBox="0 0 750 96" width="100%" style="font-family:'맑은 고딕',sans-serif;">
  <text x="0" y="34" font-size="14" fill="#1a1a1a">도입 전</text>
  <rect x="88" y="20" width="200" height="18" rx="3" fill="#cbd5e1"/>
  <text x="298" y="34" font-size="13" fill="#64748b">32%</text>
  <text x="0" y="76" font-size="14" fill="#1a1a1a">도입 후</text>
  <rect x="88" y="62" width="430" height="18" rx="3" fill="#1e90d6"/>
  <text x="528" y="76" font-size="13" fill="#1e90d6">71%</text>
</svg>
```
