"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CardItem {
  number?: string;
  title: string;
  body: string;
}

interface SNSCard {
  card_no: number;
  card_type: string;
  template_name: string;
  layout_type: string;
  cloud_label: string;
  series_title: string;
  title: string;
  highlight_text: string;
  subtitle: string;
  body: string;
  items: CardItem[];
  cta: string;
  design_point: string;
}

interface QcReport {
  auto_checks?: Record<string, "PASS" | "FAIL">;
  scores?: Record<string, number>;
  average?: number;
  verdict?: "PASS" | "조건부 PASS" | "FAIL";
  feedback?: string;
}

interface SNSJson {
  planning?: string;
  content_title?: string;
  cards: SNSCard[];
  caption?: string;
  hashtags?: string[];
  article_body?: string;
  qc_report?: QcReport;
}

function isValidSNS(parsed: Record<string, unknown>): parsed is Record<string, unknown> {
  return Array.isArray(parsed?.cards) && (parsed.cards as unknown[]).length > 0;
}

function tryParse(text: string): SNSJson | null {
  try {
    const p = JSON.parse(text.trim()) as Record<string, unknown>;
    return isValidSNS(p) ? (p as unknown as SNSJson) : null;
  } catch { return null; }
}

export function tryParseInstagramJson(content: string): SNSJson | null {
  const text = content.trim();

  const a1 = tryParse(text);
  if (a1) return a1;

  if (text.startsWith("```") || text.startsWith("~~~")) {
    const lines = text.split("\n");
    const closeIdx = lines.findIndex((l, i) => i > 0 && /^(?:```|~~~)\s*$/.test(l));
    const inner = (closeIdx > 0 ? lines.slice(1, closeIdx) : lines.slice(1)).join("\n").trim();
    const a2 = tryParse(inner);
    if (a2) return a2;
  }

  const fenceMatch = text.match(/(?:```|~~~)[\w-]*\r?\n([\s\S]*?)\r?\n(?:```|~~~)/);
  if (fenceMatch) {
    const a3 = tryParse(fenceMatch[1]);
    if (a3) return a3;
  }

  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { return tryParse(text.slice(start, i + 1)); } }
    }
  }

  return null;
}

// ── 복사 버튼 ────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handle}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-50 cursor-pointer transition-colors"
    >
      {copied
        ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-600">복사됨</span></>
        : <><Copy className="w-3 h-3" />복사</>}
    </button>
  );
}

// ── 아이템 필드 정규화 (AI가 다양한 필드명으로 출력 가능) ───────
function getItemFields(raw: unknown): { title: string; body: string } {
  const item = raw as Record<string, unknown>;
  const title = String(item.title ?? item.label ?? item.text ?? item.name ?? item.keyword ?? "");
  const body = String(item.body ?? item.description ?? item.detail ?? item.content ?? item.subtitle ?? "");
  return { title, body };
}

// ── block_container 레이아웃 렌더러 ──────────────────────────

/**
 * stacked_boxes: 파란 좌측 강조선이 있는 세로형 흰 박스 스택.
 * 박스 간 그림자로 레이어 깊이감 부여.
 */
function StackedBoxes({ items }: { items: CardItem[] }) {
  return (
    <div className="space-y-2 mt-2">
      {items.map((raw, i) => {
        const { title, body } = getItemFields(raw);
        return (
          <div key={i} className="flex overflow-hidden bg-white border border-slate-100 rounded-xl shadow-sm">
            <div className="w-1 bg-blue-500 flex-shrink-0" />
            <div className="px-3 py-2.5 flex-1">
              {title && <p className="text-sm font-bold text-slate-800 leading-tight">{title}</p>}
              {body && <p className="text-xs text-slate-500 mt-1 leading-snug">{body}</p>}
              {!title && !body && <p className="text-xs text-slate-400 italic">내용 없음</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * keyword_boxes: 파란 배경 타일 그리드.
 * 번호·선 없음. 키워드 중심의 밀집 배치.
 */
function KeywordBoxes({ items }: { items: CardItem[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((raw, i) => {
        const { title, body } = getItemFields(raw);
        return (
          <div
            key={i}
            className="flex-1 min-w-[42%] bg-blue-600 rounded-xl px-3 py-3 text-center"
          >
            <p className="text-xs font-bold text-white leading-tight">{title || `키워드 ${i + 1}`}</p>
            {body && <p className="text-[10px] text-blue-100 mt-1 leading-snug">{body}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * compare_2col: 좌(A)/우(B) 2칸 대비 구조.
 * 아이템 앞절반 → 왼쪽, 뒷절반 → 오른쪽으로 분리.
 * 강조색 대비로 두 그룹 구분.
 */
function Compare2Col({ items }: { items: CardItem[] }) {
  const mid = Math.ceil(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <div className="space-y-1.5">
        <div className="bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg text-center tracking-wider">
          A
        </div>
        {left.map((raw, i) => {
          const { title, body } = getItemFields(raw);
          return (
            <div key={i} className="bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
              {title && <p className="text-xs font-semibold text-blue-900 leading-tight">{title}</p>}
              {body && <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{body}</p>}
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <div className="bg-slate-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg text-center tracking-wider">
          B
        </div>
        {right.map((raw, i) => {
          const { title, body } = getItemFields(raw);
          return (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
              {title && <p className="text-xs font-semibold text-slate-700 leading-tight">{title}</p>}
              {body && <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{body}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * steps_vertical: 세로 타임라인. 파란 원형 번호 + 연결선.
 * 번호와 선이 시각적 흐름을 명확히 표시.
 */
function StepsVertical({ items }: { items: CardItem[] }) {
  return (
    <div className="mt-2">
      {items.map((raw, i) => {
        const { title, body } = getItemFields(raw);
        const isLast = i === items.length - 1;
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 shadow-sm">
                {i + 1}
              </div>
              {!isLast && (
                <div className="w-0.5 flex-1 bg-blue-200 my-1" style={{ minHeight: "14px" }} />
              )}
            </div>
            <div className={`flex-1 ${isLast ? "pb-0" : "pb-2.5"}`}>
              {title && <p className="text-sm font-bold text-slate-800 leading-tight mt-0.5">{title}</p>}
              {body && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{body}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * flow_process: 파란 그라디언트 박스 + ▼ 화살표로 처리 순서 표시.
 * 번호는 흐릿한 앞자리로 표시. 전체가 연결된 단일 흐름으로 읽힘.
 */
function FlowProcess({ items }: { items: CardItem[] }) {
  return (
    <div className="mt-2 space-y-1">
      {items.map((raw, i) => {
        const { title, body } = getItemFields(raw);
        const isLast = i === items.length - 1;
        return (
          <div key={i}>
            <div className="bg-gradient-to-r from-blue-700 to-blue-500 rounded-xl px-3 py-2.5 flex items-start gap-2.5">
              <span className="flex-shrink-0 text-blue-300 text-[11px] font-bold mt-0.5 w-4 text-right leading-none">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-1 min-w-0">
                {title && <p className="text-xs font-bold text-white leading-tight">{title}</p>}
                {body && <p className="text-[10px] text-blue-100 mt-0.5 leading-snug">{body}</p>}
              </div>
            </div>
            {!isLast && (
              <div className="flex justify-center text-blue-400 text-xs leading-none py-0.5">▼</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 기본 폴백: cover·cta 외 미분류 layout_type */
function DefaultItems({ items }: { items: CardItem[] }) {
  return (
    <div className="space-y-2 mt-1">
      {items.map((raw, i) => {
        const { title, body } = getItemFields(raw);
        return (
          <div key={i} className="flex gap-2.5 items-start">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              {title && <p className="text-sm font-semibold text-slate-800 leading-tight">{title}</p>}
              {body && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{body}</p>}
              {!title && !body && <p className="text-xs text-slate-400 italic">내용 없음</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderItems(layoutType: string, items: CardItem[]) {
  switch (layoutType) {
    case "stacked_boxes":   return <StackedBoxes items={items} />;
    case "keyword_boxes":   return <KeywordBoxes items={items} />;
    case "compare_2col":    return <Compare2Col items={items} />;
    case "steps_vertical":  return <StepsVertical items={items} />;
    case "flow_process":    return <FlowProcess items={items} />;
    default:                return <DefaultItems items={items} />;
  }
}

// ── 카드 1장 섹션 ────────────────────────────────────────────
function CardSection({ card }: { card: SNSCard }) {
  const isCover = card.layout_type === "cover";
  const isCta = card.layout_type === "cta";

  const renderTitle = () => {
    const { title, highlight_text } = card;
    if (!highlight_text || !title.includes(highlight_text)) {
      return <span style={{ whiteSpace: "pre-line" }}>{title}</span>;
    }
    const parts = title.split(highlight_text);
    return (
      <span style={{ whiteSpace: "pre-line" }}>
        {parts[0]}
        <span className="text-blue-600">{highlight_text}</span>
        {parts.slice(1).join(highlight_text)}
      </span>
    );
  };

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      {/* 카드 헤더 */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-slate-100 ${isCover ? "bg-blue-50" : isCta ? "bg-slate-50" : "bg-white"}`}>
        <span className="text-xs font-semibold text-slate-500">
          {card.card_no}장 · {card.card_type}
        </span>
        <span className="text-[10px] font-mono bg-slate-100 text-slate-400 px-2 py-0.5 rounded">
          {card.layout_type}
        </span>
      </div>

      <div className="px-4 py-3.5">
        {/* cloud_label */}
        {card.cloud_label && (
          <span className="inline-block text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 mb-2">
            {card.cloud_label}
          </span>
        )}

        {/* series_title */}
        {card.series_title && (
          <p className="text-[11px] text-slate-400 font-semibold mb-1">{card.series_title}</p>
        )}

        {/* title */}
        <h3 className="text-base font-bold text-slate-900 leading-snug mb-1.5">
          {renderTitle()}
        </h3>

        {/* subtitle */}
        {card.subtitle && (
          <p className="text-sm text-blue-600 leading-snug mb-3">{card.subtitle}</p>
        )}

        {/* block_container: layout_type별 렌더러 */}
        {card.items && card.items.length > 0 && renderItems(card.layout_type, card.items)}

        {/* CTA */}
        {card.cta && (
          <p className="mt-3 text-sm font-semibold text-blue-600">{card.cta}</p>
        )}
      </div>
    </div>
  );
}

// ── 섹션 래퍼 (제목 + 복사 버튼) ────────────────────────────
function Section({ label, copyText, children }: {
  label: string; copyText?: string; children: React.ReactNode;
}) {
  return (
    <section className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
        {copyText && <CopyBtn text={copyText} />}
      </div>
      {children}
    </section>
  );
}

// ── 검수 결과 ────────────────────────────────────────────────
function verdictStyle(verdict?: string) {
  if (verdict === "PASS") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (verdict === "조건부 PASS") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function QcReportView({ report }: { report: QcReport }) {
  const scores = report.scores ?? {};
  const autoChecks = report.auto_checks ?? {};
  const scoreEntries = Object.entries(scores);
  const sum = scoreEntries.reduce((acc, [, v]) => acc + (typeof v === "number" ? v : 0), 0);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${verdictStyle(report.verdict)}`}>
          {report.verdict ?? "미판정"}
        </span>
        <span className="text-sm font-bold text-slate-700">
          평균 {report.average ?? "-"}/5 <span className="text-slate-400 font-normal">(합계 {sum}/{scoreEntries.length * 5})</span>
        </span>
      </div>

      {scoreEntries.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {scoreEntries.map(([key, val]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{key.replace(/_/g, " ")}</span>
              <span className={`font-bold ${val >= 4 ? "text-emerald-600" : val >= 2 ? "text-amber-600" : "text-red-600"}`}>{val}/5</span>
            </div>
          ))}
        </div>
      )}

      {Object.keys(autoChecks).length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">자동 검수</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(autoChecks).map(([key, val]) => (
              <span
                key={key}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                  val === "PASS" ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-600 border-red-100"
                }`}
              >
                {key.replace(/_/g, " ")} {val}
              </span>
            ))}
          </div>
        </div>
      )}

      {report.feedback && (
        <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 leading-relaxed">{report.feedback}</p>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function InstagramCardPreview({ content }: { content: string }) {
  const data = tryParseInstagramJson(content);
  if (!data) return null;

  const { cards, caption, hashtags, content_title, article_body, qc_report } = data;
  const captionText = caption ?? article_body ?? "";

  return (
    <div className="space-y-3">
      {content_title && (
        <Section label="콘텐츠 제목" copyText={content_title}>
          <p className="px-4 py-3 font-bold text-slate-900 text-sm">{content_title}</p>
        </Section>
      )}

      {cards.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-0.5">카드뉴스 문구</p>
          <div className="space-y-2.5">
            {cards.map(card => (
              <CardSection key={card.card_no} card={card} />
            ))}
          </div>
        </div>
      )}

      {captionText && (
        <Section label="게시글 본문" copyText={captionText}>
          <p className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{captionText}</p>
        </Section>
      )}

      {hashtags && hashtags.length > 0 && (
        <Section label="해시태그" copyText={hashtags.join(" ")}>
          <div className="px-4 py-3 flex flex-wrap gap-1.5">
            {hashtags.map((tag, i) => (
              <span key={i} className="text-xs font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2.5 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}

      {qc_report && (
        <Section label="검수 결과">
          <QcReportView report={qc_report} />
        </Section>
      )}
    </div>
  );
}
