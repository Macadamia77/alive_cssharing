"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Wand2, Sparkles, BookOpen, AlertCircle, ChevronRight,
  Edit3, Check, Loader2, RefreshCw, ArrowLeft, LayoutList,
} from "lucide-react";
import ChannelResultCard, { type ChannelKey } from "@/components/ChannelResultCard";
import { CHANNELS, CHANNEL_LABELS, CHANNEL_COLORS } from "@/lib/channels";
import Navbar from "@/components/Navbar";
import Link from "next/link";

// ── AI 제공사 정보 ────────────────────────────────────────────
type AIProvider = "mock" | "claude" | "openai" | "gemini";

const AI_PROVIDERS: { id: AIProvider; label: string; shortLabel: string; color: string; activeClass: string }[] = [
  { id: "claude",  label: "Claude",  shortLabel: "Claude",  color: "text-orange-600", activeClass: "bg-orange-50 border-orange-300 text-orange-700" },
  { id: "openai",  label: "OpenAI",  shortLabel: "OpenAI",  color: "text-emerald-600", activeClass: "bg-emerald-50 border-emerald-300 text-emerald-700" },
  { id: "gemini",  label: "Gemini",  shortLabel: "Gemini",  color: "text-blue-600", activeClass: "bg-blue-50 border-blue-300 text-blue-700" },
  { id: "mock",    label: "Mock",    shortLabel: "Mock",    color: "text-slate-500", activeClass: "bg-slate-100 border-slate-300 text-slate-700" },
];

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
  "정보 전달형":      "bg-blue-50 text-blue-700 border-blue-200",
  "감성 스토리텔링형": "bg-rose-50 text-rose-700 border-rose-200",
  "문제 해결형":      "bg-emerald-50 text-emerald-700 border-emerald-200",
};
function angleBadge(angle: string) {
  return ANGLE_COLORS[angle] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

// ── 초안 카드 ────────────────────────────────────────────────
function DraftCard({
  draft, index, channelMap, onToggleChannel, onChange,
}: {
  draft: DraftItem;
  index: number;
  // 전체 채널→초안 배정 맵 (undefined = 미배정)
  channelMap: Partial<Record<ChannelKey, number>>;
  onToggleChannel(ch: ChannelKey): void;
  onChange(body: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);

  const myChannels = CHANNELS.filter(c => channelMap[c] === index);
  const hasChannels = myChannels.length > 0;

  const commitEdit = () => { onChange(body); setEditing(false); };

  return (
    <div
      className={`relative rounded-2xl border-2 transition-all duration-200 flex flex-col ${
        hasChannels
          ? "border-blue-500 shadow-md shadow-blue-100"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {/* 활성 뱃지 */}
      {hasChannels && (
        <div className="absolute -top-3 -right-3 min-w-7 h-7 px-2 rounded-full bg-blue-600 flex items-center justify-center shadow-md z-10">
          <span className="text-white text-[10px] font-bold">{myChannels.length}</span>
        </div>
      )}

      {/* 헤더 */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${angleBadge(draft.angle)}`}>
            {draft.angle}
          </span>
          <span className="text-[10px] text-slate-400 font-medium shrink-0">초안 {index + 1}</span>
        </div>
        <h3 className="font-semibold text-slate-900 text-sm leading-snug">{draft.title}</h3>
      </div>

      {/* 본문 */}
      <div className="px-5 pb-3 flex-1">
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
              className="text-sm text-slate-600 whitespace-pre-wrap font-[inherit] leading-relaxed max-h-44 overflow-y-auto pr-1"
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

      {/* 채널 배정 토글 */}
      <div className="px-5 pb-5 pt-3 border-t border-slate-100">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">적용할 채널</p>
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map(ch => {
            const assignedTo = channelMap[ch];
            const isMine = assignedTo === index;
            const isTaken = assignedTo !== undefined && !isMine;
            const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];

            return (
              <button
                key={ch}
                onClick={() => onToggleChannel(ch)}
                title={isTaken ? `초안 ${(assignedTo ?? 0) + 1}에 배정됨` : undefined}
                className={`relative px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer select-none ${
                  isMine
                    ? `${bgColor} ${color} ${borderColor} shadow-sm`
                    : isTaken
                    ? "bg-slate-50 text-slate-300 border-slate-100 line-through"
                    : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600"
                }`}
              >
                {isMine && <Check className="inline w-2.5 h-2.5 mr-0.5 -mt-px" />}
                {CHANNEL_LABELS[ch]}
                {isTaken && (
                  <span className="ml-1 text-[9px] text-slate-300 no-underline font-normal">
                    ({(assignedTo ?? 0) + 1})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 메인 페이지 ─────────────────────────────────────────────
export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");

  // AI 선택
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("mock");
  const [availableProviders, setAvailableProviders] = useState<AIProvider[]>(["mock"]);

  // 초안 단계
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftBodies, setDraftBodies] = useState<string[]>([]);
  // 채널 → 초안 인덱스 (undefined = 미배정)
  const [channelMap, setChannelMap] = useState<Partial<Record<ChannelKey, number>>>({});

  // sessionStorage 복원 완료 여부 (복원 전에 저장 effect가 초기값으로 덮어쓰는 것을 방지)
  const [sessionRestored, setSessionRestored] = useState(false);

  // 채널 생성 단계
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<ChannelKey, ChannelResult>>(
    Object.fromEntries(CHANNELS.map(c => [c, { status: "idle" }])) as Record<ChannelKey, ChannelResult>
  );
  const [resultChannels, setResultChannels] = useState<ChannelKey[]>([]);

  const resultsRef = useRef<HTMLDivElement>(null);

  // 사용 가능한 AI 제공사 목록 로드
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json() as {
          activeProvider: AIProvider;
          providers: Record<string, { apiKeySet: boolean }>;
        };
        const available: AIProvider[] = [];
        for (const p of ["claude", "openai", "gemini"] as const) {
          if (data.providers[p]?.apiKeySet) available.push(p);
        }
        available.push("mock");
        setAvailableProviders(available);

        // localStorage > 저장된 activeProvider > 첫 번째 실 API 제공사 > mock
        const lsProvider = localStorage.getItem("csai_provider") as AIProvider | null;
        const configProvider = data.activeProvider as AIProvider | undefined;
        const firstReal = available.find(p => p !== "mock");
        const defaultProvider =
          (lsProvider && available.includes(lsProvider)) ? lsProvider :
          (configProvider && configProvider !== "mock" && available.includes(configProvider)) ? configProvider :
          firstReal ?? "mock";
        setSelectedProvider(defaultProvider);
      } catch {
        setAvailableProviders(["mock"]);
        setSelectedProvider("mock");
      }
    })();
  }, []);

  // 페이지 이탈 후 복귀 시 초안/주제 복원
  useEffect(() => {
    try {
      const savedTopic = sessionStorage.getItem("csai_topic");
      const savedPhase = sessionStorage.getItem("csai_phase");
      const savedDrafts = sessionStorage.getItem("csai_drafts");
      const savedBodies = sessionStorage.getItem("csai_draftBodies");
      const savedMap = sessionStorage.getItem("csai_channelMap");
      if (savedTopic) setTopic(savedTopic);
      if (savedDrafts) {
        const parsedDrafts = JSON.parse(savedDrafts) as DraftItem[];
        if (parsedDrafts.length > 0) {
          setDrafts(parsedDrafts);
          setDraftBodies(savedBodies ? (JSON.parse(savedBodies) as string[]) : parsedDrafts.map(d => d.body));
          setChannelMap(savedMap ? (JSON.parse(savedMap) as Partial<Record<ChannelKey, number>>) : {});
          // channels 단계에서 이탈했어도 drafts로 복원
          if (savedPhase === "drafts" || savedPhase === "channels") setPhase("drafts");
        }
      }
    } catch {}
    setSessionRestored(true);
  }, []);

  // 상태 변경 시 sessionStorage에 저장
  useEffect(() => {
    if (!sessionRestored) return;
    try {
      sessionStorage.setItem("csai_topic", topic);
      sessionStorage.setItem("csai_phase", phase);
      sessionStorage.setItem("csai_drafts", JSON.stringify(drafts));
      sessionStorage.setItem("csai_draftBodies", JSON.stringify(draftBodies));
      sessionStorage.setItem("csai_channelMap", JSON.stringify(channelMap));
    } catch {}
  }, [topic, phase, drafts, draftBodies, channelMap, sessionRestored]);

  const toggleChannelForDraft = (draftIndex: number, ch: ChannelKey) => {
    setChannelMap(prev => {
      if (prev[ch] === draftIndex) {
        const next = { ...prev };
        delete next[ch];
        return next;
      }
      return { ...prev, [ch]: draftIndex };
    });
  };

  const assignedChannels = CHANNELS.filter(c => channelMap[c] !== undefined);

  // ── Step 1: 초안 추천 ───────────────────────────────────────
  const handleGetDrafts = async () => {
    if (!topic.trim() || draftLoading) return;
    setDraftLoading(true); setDraftError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), provider: selectedProvider }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "초안 생성 실패"); }
      const data = await res.json();
      setDrafts(data.drafts);
      setDraftBodies(data.drafts.map((d: DraftItem) => d.body));
      setChannelMap({});
      setPhase("drafts");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "초안 추천에 실패했습니다.");
    } finally {
      setDraftLoading(false);
    }
  };

  // ── Step 2: 채널 콘텐츠 생성 ────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (generating || assignedChannels.length === 0) return;

    // 초안별 배정 채널 묶기
    const draftAssignments: Array<{ draftIndex: number; channels: ChannelKey[] }> = [];
    for (let i = 0; i < drafts.length; i++) {
      const chs = CHANNELS.filter(c => channelMap[c] === i);
      if (chs.length > 0) draftAssignments.push({ draftIndex: i, channels: chs });
    }
    if (draftAssignments.length === 0) return;

    setGenerating(true); setGenError(null);
    const targeted = assignedChannels;
    setResultChannels(targeted);
    setResults(
      Object.fromEntries(
        CHANNELS.map(c => [c, { status: targeted.includes(c) ? "loading" : "idle" }])
      ) as Record<ChannelKey, ChannelResult>
    );
    setPhase("channels");
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

    const channelsMap: Record<string, string> = {};

    try {
      for (const { draftIndex, channels } of draftAssignments) {
        const draft = draftBodies[draftIndex] ?? drafts[draftIndex]?.body ?? "";
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: topic.trim(), draft, channels, provider: selectedProvider }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "생성 실패");
        for (const { channel, content } of data.results) {
          setResults(prev => ({ ...prev, [channel as ChannelKey]: { status: "done", content } }));
          channelsMap[channel] = content;
        }
      }

      void fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), channels: channelsMap }),
      });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResults(prev => {
        const next = { ...prev };
        for (const ch of targeted) {
          if (next[ch].status === "loading") next[ch] = { status: "error" };
        }
        return next;
      });
    } finally {
      setGenerating(false);
    }
  }, [generating, assignedChannels, drafts, draftBodies, channelMap, topic]);

  const allDone = resultChannels.length > 0 && resultChannels.every(c => results[c].status === "done");
  const clearSession = () => {
    ["csai_topic","csai_phase","csai_drafts","csai_draftBodies","csai_channelMap"].forEach(k => sessionStorage.removeItem(k));
  };
  const resetAll = () => {
    clearSession();
    setPhase("input"); setTopic(""); setDrafts([]); setDraftBodies([]); setChannelMap({});
    setGenError(null); setDraftError(null); setResultChannels([]);
  };

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
              초안별로 채널을 배정하면 AI가 각 채널 가이드에 맞춰 완성합니다.
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

              {/* AI 선택 바 */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">초안 및 콘텐츠 생성 AI</p>
                  {phase === "drafts" && (
                    <span className="text-[10px] text-slate-400">초안 생성 후 변경 불가</span>
                  )}
                </div>
                {availableProviders.length <= 1 ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                    <span>AI API 키가 설정되지 않았습니다.</span>
                    <a href="/settings" className="font-semibold underline hover:text-amber-900">설정 페이지에서 연결하기 →</a>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {AI_PROVIDERS.filter(p => availableProviders.includes(p.id)).map(p => {
                      const isActive = selectedProvider === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedProvider(p.id); localStorage.setItem("csai_provider", p.id); }}
                          disabled={phase === "drafts"}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-default ${
                            isActive ? p.activeClass : "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                          }`}
                        >
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

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

              <div className="flex flex-wrap gap-2 mb-5">
                {EXAMPLE_TOPICS.map(ex => (
                  <button key={ex} onClick={() => { setTopic(ex); setPhase("input"); }}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer">
                    {ex}
                  </button>
                ))}
              </div>

              {draftError && (
                <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />{draftError}
                </div>
              )}

              {phase === "input" ? (
                <button onClick={() => void handleGetDrafts()} disabled={!topic.trim() || draftLoading}
                  className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold">
                  {draftLoading
                    ? <><Loader2 className="w-5 h-5 animate-spin" />{AI_PROVIDERS.find(p => p.id === selectedProvider)?.label ?? selectedProvider}(으)로 초안 생성 중...</>
                    : <><Sparkles className="w-5 h-5" />{AI_PROVIDERS.find(p => p.id === selectedProvider)?.label ?? selectedProvider}로 초안 생성하기</>}
                </button>
              ) : (
                <button onClick={() => { clearSession(); setPhase("input"); setDrafts([]); setDraftBodies([]); setChannelMap({}); }}
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
                <p className="text-sm text-slate-500">각 초안 하단에서 적용할 채널을 클릭해 배정하세요. 초안마다 다른 채널을 지정할 수 있습니다.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {drafts.map((draft, i) => (
                  <DraftCard
                    key={i}
                    draft={{ ...draft, body: draftBodies[i] ?? draft.body }}
                    index={i}
                    channelMap={channelMap}
                    onToggleChannel={ch => toggleChannelForDraft(i, ch)}
                    onChange={body => setDraftBodies(prev => { const next = [...prev]; next[i] = body; return next; })}
                  />
                ))}
              </div>

              {/* 배정 요약 + 생성 버튼 */}
              <div className="max-w-lg mx-auto">
                {assignedChannels.length > 0 ? (
                  <div>
                    {/* 배정 요약 */}
                    <div className="mb-3 space-y-1">
                      {drafts.map((draft, i) => {
                        const chs = CHANNELS.filter(c => channelMap[c] === i);
                        if (chs.length === 0) return null;
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-500 justify-center flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${angleBadge(draft.angle)}`}>
                              초안 {i + 1}
                            </span>
                            <span className="text-slate-300">→</span>
                            {chs.map(ch => (
                              <span key={ch} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${CHANNEL_COLORS[ch].bgColor} ${CHANNEL_COLORS[ch].color} ${CHANNEL_COLORS[ch].borderColor}`}>
                                {CHANNEL_LABELS[ch]}
                              </span>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={() => void handleGenerate()} disabled={generating}
                      className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold">
                      <Wand2 className="w-5 h-5" />
                      {assignedChannels.length}개 채널 · {AI_PROVIDERS.find(p => p.id === selectedProvider)?.label ?? selectedProvider}로 생성
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-4 text-sm text-slate-400">
                    각 초안 하단에서 적용할 채널을 선택해주세요
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Phase 3: 채널 결과 ───────────────────────── */}
          {phase === "channels" && (
            <div ref={resultsRef}>
              {allDone && !generating && (
                <div className="text-center mb-6 flex flex-col items-center gap-3">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    {resultChannels.length}개 채널 생성 완료
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => { setPhase("drafts"); setGenError(null); setResultChannels([]); }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 cursor-pointer">
                      <ArrowLeft className="w-3.5 h-3.5" />초안으로 돌아가기
                    </button>
                    <button onClick={resetAll}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 cursor-pointer">
                      <RefreshCw className="w-3.5 h-3.5" />새 주제로 시작
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
                {resultChannels.map(channel => (
                  <div key={channel} className={channel === "magazine" || resultChannels.length === 1 ? "lg:col-span-2" : ""}>
                    <ChannelResultCard channel={channel} status={results[channel].status} content={results[channel].content} />
                  </div>
                ))}
              </div>
            </div>
          )}

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
