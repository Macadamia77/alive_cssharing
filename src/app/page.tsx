"use client";

import { useState, useRef, useCallback } from "react";
import {
  Wand2, Sparkles, BookOpen, AlertCircle, ChevronRight,
  Edit3, Check, Loader2, RefreshCw, ArrowLeft, LayoutList,
} from "lucide-react";
import ChannelResultCard, { type ChannelKey } from "@/components/ChannelResultCard";
import { CHANNELS, CHANNEL_LABELS, CHANNEL_COLORS } from "@/lib/channels";
import Navbar from "@/components/Navbar";
import Link from "next/link";

// ── 타입 ────────────────────────────────────────────────────
type Phase = "input" | "drafts" | "channels";
type ChannelStatus = "idle" | "loading" | "done" | "error";

interface DraftItem { angle: string; title: string; body: string; }
interface ChannelResult { status: ChannelStatus; content?: string; }

// ── 예시 주제 ────────────────────────────────────────────────
const EXAMPLE_TOPICS = [
  "CS 아웃소싱으로 비용 절감하는 방법",
  "AI 고객센터 도입 효과",
  "고객 만족도를 높이는 VOC 분석",
  "스타트업 고객센터 구축 전략",
  "24시간 고객 대응 운영 노하우",
];

const ANGLE_COLORS: Record<string, string> = {
  "정보 전달형":     "bg-blue-50 text-blue-700 border-blue-200",
  "감성 스토리텔링형": "bg-rose-50 text-rose-700 border-rose-200",
  "문제 해결형":     "bg-emerald-50 text-emerald-700 border-emerald-200",
};
function angleBadge(angle: string) {
  return ANGLE_COLORS[angle] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

// ── 초안 카드 ────────────────────────────────────────────────
function DraftCard({
  draft, index, selected, onSelect, onChange,
}: {
  draft: DraftItem; index: number; selected: boolean;
  onSelect(): void; onChange(body: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);

  const commitEdit = () => {
    onChange(body);
    setEditing(false);
  };

  return (
    <div
      className={`relative rounded-2xl border-2 transition-all duration-200 ${
        selected
          ? "border-blue-500 shadow-md shadow-blue-100"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {/* 선택 체크 */}
      {selected && (
        <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shadow-md z-10">
          <Check className="w-4 h-4 text-white" />
        </div>
      )}

      {/* 헤더 */}
      <div
        className={`px-5 pt-5 pb-3 cursor-pointer select-none`}
        onClick={() => !editing && onSelect()}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${angleBadge(draft.angle)}`}>
            {draft.angle}
          </span>
          <span className="text-[10px] text-slate-400 font-medium shrink-0">초안 {index + 1}</span>
        </div>
        <h3 className="font-semibold text-slate-900 text-sm leading-snug">{draft.title}</h3>
      </div>

      {/* 본문 */}
      <div className="px-5 pb-4">
        {editing ? (
          <div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={7}
              autoFocus
              className="w-full text-sm text-slate-700 leading-relaxed border border-slate-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none font-[inherit]"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={commitEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 cursor-pointer">
                <Check className="w-3 h-3" />수정 완료
              </button>
              <button onClick={() => { setBody(draft.body); setEditing(false); }} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 cursor-pointer">
                취소
              </button>
            </div>
          </div>
        ) : (
          <div>
            <pre
              className="text-sm text-slate-600 whitespace-pre-wrap font-[inherit] leading-relaxed max-h-44 overflow-y-auto pr-1 scrollbar-thin"
              style={{ scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent" }}
            >
              {body}
            </pre>
            <button
              onClick={e => { e.stopPropagation(); setEditing(true); }}
              className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
            >
              <Edit3 className="w-3 h-3" />초안 수정하기
            </button>
          </div>
        )}
      </div>

      {/* 선택 버튼 */}
      <div className="px-5 pb-5">
        <button
          onClick={() => !editing && onSelect()}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
            selected
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
          }`}
        >
          {selected ? "✓ 선택됨" : "이 초안 선택"}
        </button>
      </div>
    </div>
  );
}

// ── 메인 페이지 ─────────────────────────────────────────────
export default function HomePage() {
  // ── 상태 ──
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");
  const [activeChannels, setActiveChannels] = useState<Set<ChannelKey>>(new Set(CHANNELS));

  // 초안 단계
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftBodies, setDraftBodies] = useState<string[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);

  // 채널 생성 단계
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<ChannelKey, ChannelResult>>(
    Object.fromEntries(CHANNELS.map(c => [c, { status: "idle" }])) as Record<ChannelKey, ChannelResult>
  );

  const resultsRef = useRef<HTMLDivElement>(null);

  const toggleChannel = (ch: ChannelKey) => {
    setActiveChannels(prev => {
      const next = new Set(prev);
      if (next.has(ch)) { if (next.size === 1) return prev; next.delete(ch); }
      else next.add(ch);
      return next;
    });
  };
  const selectedChannels = CHANNELS.filter(c => activeChannels.has(c));

  // ── Step 1: 초안 추천 ───────────────────────────────────────
  const handleGetDrafts = async () => {
    if (!topic.trim() || draftLoading) return;
    setDraftLoading(true); setDraftError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "초안 생성 실패"); }
      const data = await res.json();
      setDrafts(data.drafts);
      setDraftBodies(data.drafts.map((d: DraftItem) => d.body));
      setSelectedDraft(null);
      setPhase("drafts");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "초안 추천에 실패했습니다.");
    } finally {
      setDraftLoading(false);
    }
  };

  // ── Step 2: 채널 콘텐츠 생성 ────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (selectedDraft === null || generating || selectedChannels.length === 0) return;
    const draft = draftBodies[selectedDraft] ?? drafts[selectedDraft]?.body ?? "";

    setGenerating(true); setGenError(null);
    setResults(
      Object.fromEntries(
        CHANNELS.map(c => [c, selectedChannels.includes(c) ? { status: "loading" } : { status: "idle" }])
      ) as Record<ChannelKey, ChannelResult>
    );
    setPhase("channels");
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), draft, channels: selectedChannels }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "생성 실패"); }
      const data = await res.json();

      const newResults: Record<ChannelKey, ChannelResult> = { ...results };
      const channelsMap: Record<string, string> = {};
      for (const { channel, content } of data.results) {
        newResults[channel as ChannelKey] = { status: "done", content };
        channelsMap[channel] = content;
      }
      setResults(newResults);

      // 결과물 자동 저장
      void fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), channels: channelsMap }),
      });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResults(
        Object.fromEntries(
          CHANNELS.map(c => [c, selectedChannels.includes(c) ? { status: "error" } : { status: "idle" }])
        ) as Record<ChannelKey, ChannelResult>
      );
    } finally {
      setGenerating(false);
    }
  }, [selectedDraft, generating, selectedChannels, draftBodies, drafts, topic, results]);

  const allDone = selectedChannels.every(c => results[c].status === "done");
  const resetAll = () => { setPhase("input"); setDrafts([]); setSelectedDraft(null); setGenError(null); setDraftError(null); };

  // ── 렌더 ────────────────────────────────────────────────────
  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20 px-4">
        <div className="max-w-5xl mx-auto">

          {/* ─── Hero ─────────────────────────────────────── */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-4 uppercase tracking-wide">
              <Sparkles className="w-3.5 h-3.5" />CS쉐어링 AI 마케팅 자동화
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight tracking-tight mb-3">
              주제 하나로
              <span className="text-blue-600"> 5개 채널</span> 동시 생성
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-lg mx-auto">
              네이버 블로그 · 인스타그램 · 페이스북 · 링크드인 · 매거진<br />
              초안을 선택하면 AI가 채널별 가이드에 맞춰 완성합니다.
            </p>
          </div>

          {/* ─── Step 인디케이터 ───────────────────────────── */}
          {phase !== "input" && (
            <div className="flex items-center justify-center gap-2 mb-8 text-sm">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full font-medium bg-blue-100 text-blue-700">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                주제 입력
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-medium ${phase === "drafts" ? "bg-blue-600 text-white" : phase === "channels" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${phase === "drafts" ? "bg-white text-blue-600" : phase === "channels" ? "bg-blue-600 text-white" : "bg-slate-300 text-white"}`}>2</span>
                초안 선택
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-medium ${phase === "channels" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${phase === "channels" ? "bg-white text-blue-600" : "bg-slate-300 text-white"}`}>3</span>
                채널 생성
              </div>
            </div>
          )}

          {/* ─── Phase 1: 주제 입력 ───────────────────────── */}
          {(phase === "input" || phase === "drafts") && (
            <div className="glass-card rounded-3xl p-6 sm:p-8 mb-8 max-w-2xl mx-auto">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                주제 또는 핵심 문구 입력
              </label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="예: CS 아웃소싱으로 비용 절감하는 방법"
                rows={3}
                disabled={draftLoading || phase === "drafts"}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all disabled:opacity-60"
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && phase === "input") void handleGetDrafts(); }}
              />
              <p className="text-xs text-slate-400 mt-1.5 mb-4">Ctrl + Enter로 바로 초안 추천 받기</p>

              {/* 예시 주제 */}
              <div className="flex flex-wrap gap-2 mb-5">
                {EXAMPLE_TOPICS.map(ex => (
                  <button key={ex} onClick={() => { setTopic(ex); setPhase("input"); }}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer">
                    {ex}
                  </button>
                ))}
              </div>

              {/* 채널 선택 */}
              <div className="mb-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">생성할 채널 선택</p>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map(ch => {
                    const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];
                    const isActive = activeChannels.has(ch);
                    return (
                      <button key={ch} onClick={() => toggleChannel(ch)}
                        className={`relative px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${isActive ? `${bgColor} ${color} ${borderColor} shadow-sm` : "bg-slate-100 text-slate-400 border-slate-200 opacity-50 hover:opacity-70"}`}>
                        {CHANNEL_LABELS[ch]}
                        {isActive && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white" />}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">{selectedChannels.length}개 선택됨</p>
              </div>

              {draftError && (
                <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />{draftError}
                </div>
              )}

              {phase === "input" ? (
                <button onClick={() => void handleGetDrafts()} disabled={!topic.trim() || draftLoading || selectedChannels.length === 0}
                  className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold">
                  {draftLoading
                    ? <><Loader2 className="w-5 h-5 animate-spin" />초안 추천 중...</>
                    : <><Sparkles className="w-5 h-5" />초안 추천받기</>}
                </button>
              ) : (
                <button onClick={() => { setPhase("input"); setDrafts([]); setSelectedDraft(null); }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 cursor-pointer">
                  <RefreshCw className="w-4 h-4" />주제 다시 입력하기
                </button>
              )}
            </div>
          )}

          {/* ─── Phase 2: 초안 선택 ───────────────────────── */}
          {phase === "drafts" && drafts.length > 0 && (
            <div className="mb-8">
              <div className="text-center mb-6">
                <h2 className="text-lg font-bold text-slate-900 mb-1">AI가 추천한 초안 3가지</h2>
                <p className="text-sm text-slate-500">원하는 방향의 초안을 선택하거나 직접 수정한 후 채널 콘텐츠를 생성하세요</p>
              </div>

              {/* 채널 선택 */}
              <div className="glass-card rounded-2xl px-5 py-4 mb-6 max-w-2xl mx-auto">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">적용할 채널 선택</p>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map(ch => {
                    const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];
                    const isActive = activeChannels.has(ch);
                    return (
                      <button key={ch} onClick={() => toggleChannel(ch)}
                        className={`relative px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${isActive ? `${bgColor} ${color} ${borderColor} shadow-sm` : "bg-slate-100 text-slate-400 border-slate-200 opacity-50 hover:opacity-70"}`}>
                        {CHANNEL_LABELS[ch]}
                        {isActive && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white" />}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">{selectedChannels.length}개 선택됨</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {drafts.map((draft, i) => (
                  <DraftCard
                    key={i}
                    draft={{ ...draft, body: draftBodies[i] ?? draft.body }}
                    index={i}
                    selected={selectedDraft === i}
                    onSelect={() => setSelectedDraft(i)}
                    onChange={body => setDraftBodies(prev => { const next = [...prev]; next[i] = body; return next; })}
                  />
                ))}
              </div>

              {/* 생성 버튼 */}
              <div className="max-w-md mx-auto">
                {selectedDraft !== null ? (
                  <button onClick={() => void handleGenerate()} disabled={generating || selectedChannels.length === 0}
                    className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold">
                    <Wand2 className="w-5 h-5" />
                    선택한 초안으로 {selectedChannels.length}개 채널 생성하기
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="text-center py-4 text-sm text-slate-400">
                    위에서 초안을 선택해주세요
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Phase 3: 채널 결과 ───────────────────────── */}
          {phase === "channels" && (
            <div ref={resultsRef}>
              {/* 선택된 초안 요약 */}
              {selectedDraft !== null && drafts[selectedDraft] && (
                <div className="glass-card rounded-2xl p-4 mb-6 max-w-2xl mx-auto border border-blue-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${angleBadge(drafts[selectedDraft].angle)}`}>
                      {drafts[selectedDraft].angle}
                    </span>
                    <span className="text-xs text-slate-500">선택된 초안</span>
                  </div>
                  <p className="font-semibold text-slate-900 text-sm">{drafts[selectedDraft].title}</p>
                  <pre className="text-xs text-slate-500 mt-1 whitespace-pre-wrap font-[inherit] line-clamp-2">
                    {draftBodies[selectedDraft]}
                  </pre>
                </div>
              )}

              {allDone && !generating && (
                <div className="text-center mb-6 flex flex-col items-center gap-3">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    {selectedChannels.length}개 채널 생성 완료 — 각 콘텐츠를 확인하고 복사해서 사용하세요
                  </span>
                  <div className="flex gap-2">
                    <button onClick={resetAll}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 cursor-pointer">
                      <ArrowLeft className="w-3.5 h-3.5" />새 콘텐츠 생성
                    </button>
                    <Link href="/results"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-sm font-medium hover:bg-blue-100 cursor-pointer">
                      <LayoutList className="w-3.5 h-3.5" />결과물 보관함
                    </Link>
                  </div>
                </div>
              )}

              {genError && (
                <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 max-w-2xl mx-auto">
                  <AlertCircle className="w-4 h-4 shrink-0" />{genError}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {selectedChannels.map(channel => (
                  <div key={channel} className={channel === "magazine" || selectedChannels.length === 1 ? "lg:col-span-2" : ""}>
                    <ChannelResultCard channel={channel} status={results[channel].status} content={results[channel].content} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 가이드 단축 링크 */}
          {phase === "input" && (
            <div className="text-center mt-6">
              <a href="/guides" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 transition-colors cursor-pointer">
                <BookOpen className="w-4 h-4" />채널별 가이드 확인 및 수정하기
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
