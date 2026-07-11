"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Wand2, Sparkles, BookOpen, AlertCircle, ChevronRight, ChevronLeft,
  Check, Loader2, RefreshCw, ArrowLeft, LayoutList, Lightbulb, PenLine,
} from "lucide-react";
import ChannelResultCard, { type ChannelKey } from "@/components/ChannelResultCard";
import { CHANNELS, CHANNEL_LABELS, CHANNEL_COLORS } from "@/lib/channels";
import type { CardAsset } from "@/lib/pipeline/cardStorage";
import Navbar from "@/components/Navbar";
import Link from "next/link";

// ── AI 제공사 정보 ────────────────────────────────────────────
type AIProvider = "mock" | "claude" | "openai" | "gemini";

const AI_PROVIDERS: { id: AIProvider; label: string; activeClass: string }[] = [
  { id: "claude",  label: "Claude",  activeClass: "bg-orange-50 border-orange-300 text-orange-700" },
  { id: "openai",  label: "OpenAI",  activeClass: "bg-emerald-50 border-emerald-300 text-emerald-700" },
  { id: "gemini",  label: "Gemini",  activeClass: "bg-blue-50 border-blue-300 text-blue-700" },
  { id: "mock",    label: "Mock",    activeClass: "bg-slate-100 border-slate-300 text-slate-700" },
];

// ── 타입 ────────────────────────────────────────────────────
type InputMode = "topic" | "draft";               // 모드 A(주제로 시작) / 모드 B(내 초안 개선, M8)
type Phase = "input" | "candidates" | "channels" | "results";
type ChannelStatus = "idle" | "loading" | "done" | "error";

// brainstormer.md가 내는 후보 JSON 구조(일부 필드는 없을 수 있어 전부 옵셔널로 방어)
interface Candidate {
  rank?: number;
  topic: string;
  core_question?: string;
  core_claim?: string;
  angle?: string;
  reason?: string;
  cited_research?: string[];
  overlap_check?: string;
  outline?: string;
}
interface ChannelResult { status: ChannelStatus; content?: string; stage?: string; cardAssets?: CardAsset[]; }

const EXAMPLE_TOPICS = [
  "CS 아웃소싱으로 비용 절감하는 방법",
  "AI 고객센터 도입 효과",
  "고객 만족도를 높이는 VOC 분석",
  "스타트업 고객센터 구축 전략",
  "24시간 고객 대응 운영 노하우",
];

// [M8 ④] 카테고리별 컨텍스트 참조 예산 (LLM이 참조하는 자료실 항목 주입량)
interface CtxBudget { feedback: number; examples: number; bad: number; research: number; researchDays: number; cap: number; }
const DEFAULT_BUDGET: CtxBudget = { feedback: 10, examples: 3, bad: 3, research: 5, researchDays: 30, cap: 600 };
const BUDGET_FIELDS: { key: keyof CtxBudget; label: string }[] = [
  { key: "feedback", label: "피드백" },
  { key: "examples", label: "우수작" },
  { key: "bad", label: "기각 사례" },
  { key: "research", label: "누적 리서치" },
  { key: "researchDays", label: "리서치 최신(일)" },
  { key: "cap", label: "항목 길이(자)" },
];

const PAGE_SIZE = 3;           // 후보를 3개씩 넘겨본다(클라이언트 슬라이싱, 추가 fetch 없음)
const POLL_INTERVAL_MS = 2500;
// 25분 — 워커 stale 워치독(20분, render-worker/index.ts STALE_TIMEOUT_MS)보다 살짝 길게.
// 정상 케이스는 워치독이 20분에 run을 failed로 전파해 그 전에 실패를 받으므로, 이 값은 순수 백스톱.
// naver-blog는 검수 재작성이 겹치면 실측상 20분 가까이도 걸릴 수 있어(2026-07-11 실측 사례),
// 예전 12분은 너무 짧아 정상적으로 끝나는 생성까지 "실패"로 잘못 표시하는 일이 실제로 있었다.
// (참고: 이 값이 만료돼도 결과 자체는 유실되지 않는다 — 워커가 작업 종료 시 서버에서 직접
// results에 저장하므로, 여기 타임아웃은 순수히 "화면에 언제까지 기다릴지"만 결정한다.)
const POLL_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_TIMEOUT_MIN = POLL_TIMEOUT_MS / 60000;

const emptyResults = () =>
  Object.fromEntries(CHANNELS.map(c => [c, { status: "idle" }])) as Record<ChannelKey, ChannelResult>;

// ── 후보 카드 ────────────────────────────────────────────────
function CandidateCard({
  candidate, index, selected, onSelect,
}: {
  candidate: Candidate;
  index: number;
  selected: boolean;
  onSelect(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left relative rounded-2xl border-2 transition-all duration-200 flex flex-col cursor-pointer h-full ${
        selected ? "border-blue-500 shadow-md shadow-blue-100 bg-blue-50/30" : "border-slate-200 hover:border-slate-300 bg-white"
      }`}
    >
      {selected && (
        <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shadow-md z-10">
          <Check className="w-4 h-4 text-white" />
        </div>
      )}

      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
            {candidate.angle || "관점"}
          </span>
          {typeof candidate.rank === "number" && (
            <span className="text-[10px] text-slate-400 font-semibold shrink-0">추천 {candidate.rank}위</span>
          )}
        </div>
        <h3 className="font-semibold text-slate-900 text-sm leading-snug">{candidate.topic}</h3>
      </div>

      <div className="px-5 pb-3 flex-1 space-y-2">
        {candidate.core_claim && (
          <p className="text-sm text-slate-700 leading-relaxed">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">핵심 주장</span>
            {candidate.core_claim}
          </p>
        )}
        {candidate.core_question && (
          <p className="text-xs text-slate-500 leading-relaxed">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">중심 질문</span>
            {candidate.core_question}
          </p>
        )}

        {expanded && (
          <div className="pt-2 mt-2 border-t border-slate-100 space-y-2">
            {candidate.outline && (
              <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-wrap">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">개요</span>
                {candidate.outline}
              </p>
            )}
            {candidate.reason && (
              <p className="text-xs text-slate-500 leading-relaxed">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">선정 사유</span>
                {candidate.reason}
              </p>
            )}
            {Array.isArray(candidate.cited_research) && candidate.cited_research.length > 0 && (
              <div className="text-xs text-slate-500">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">인용 근거</span>
                <ul className="list-disc list-inside space-y-0.5">
                  {candidate.cited_research.map((r, i) => <li key={i} className="leading-relaxed">{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 pb-4">
        <span
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
        >
          {expanded ? "간략히" : "근거·개요 보기"}
          <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </span>
      </div>
    </button>
  );
}

// ── 메인 페이지 ─────────────────────────────────────────────
export default function HomePage() {
  const [inputMode, setInputMode] = useState<InputMode>("topic");
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");

  // AI 선택
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("mock");
  const [availableProviders, setAvailableProviders] = useState<AIProvider[]>(["mock"]);
  const hasClaudeKey = availableProviders.includes("claude");

  // 브레인스토밍(후보) 단계
  const [runId, setRunId] = useState<string | null>(null);
  const [bsLoading, setBsLoading] = useState(false);
  const [bsError, setBsError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);

  // 채널 선택 단계
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>([]);

  // 모드 A: 1차 리서치(research/voice) 생략 — 누적 데이터만으로 브레인스토밍
  const [skipInitialResearch, setSkipInitialResearch] = useState(false);
  // [M8 ④] 컨텍스트 참조 예산 — 카테고리별 개별 제어
  const [ctxBudget, setCtxBudget] = useState<CtxBudget>(DEFAULT_BUDGET);
  const [budgetOpen, setBudgetOpen] = useState(false);

  // 모드 B(내 초안 개선) 입력
  const [userDraft, setUserDraft] = useState("");
  const [doResearch, setDoResearch] = useState(true);

  // 재개선(결과 화면)
  const [improveDir, setImproveDir] = useState("");
  const [researchMode, setResearchMode] = useState<"reuse" | "accumulated" | "fresh">("reuse");
  const [reimproveSel, setReimproveSel] = useState<ChannelKey[]>([]);

  // 생성/결과 단계
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [finalizeStage, setFinalizeStage] = useState<string>("");
  const [results, setResults] = useState<Record<ChannelKey, ChannelResult>>(emptyResults());
  const [resultChannels, setResultChannels] = useState<ChannelKey[]>([]);

  const resultsRef = useRef<HTMLDivElement>(null);
  const generatingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => clearPoll(), []);

  const blogNeedsClaudeKey = selectedChannels.includes("naver-blog") && selectedProvider !== "mock" && !hasClaudeKey;

  // ── 사용 가능한 AI 제공사 로드 ──────────────────────────────
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

        const lsProvider = localStorage.getItem("csai_provider") as AIProvider | null;
        const configProvider = data.activeProvider as AIProvider | undefined;
        const firstReal = available.find(p => p !== "mock");
        setSelectedProvider(
          (lsProvider && available.includes(lsProvider)) ? lsProvider :
          (configProvider && configProvider !== "mock" && available.includes(configProvider)) ? configProvider :
          firstReal ?? "mock"
        );
      } catch {
        setAvailableProviders(["mock"]);
        setSelectedProvider("mock");
      }
    })();
  }, []);

  // ── 이탈 후 복귀 시: 비싼 브레인스토밍 결과(후보)만 복원 ────────
  useEffect(() => {
    try {
      const savedTopic = sessionStorage.getItem("csai_topic");
      const savedRun = sessionStorage.getItem("csai_runId");
      const savedCands = sessionStorage.getItem("csai_candidates");
      if (savedTopic) setTopic(savedTopic);
      if (savedRun && savedCands) {
        const parsed = JSON.parse(savedCands) as Candidate[];
        if (parsed.length > 0) {
          setRunId(savedRun);
          setCandidates(parsed);
          setPhase("candidates");
        }
      }
    } catch {}
    setSessionRestored(true);
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    try {
      sessionStorage.setItem("csai_topic", topic);
      sessionStorage.setItem("csai_runId", runId ?? "");
      sessionStorage.setItem("csai_candidates", JSON.stringify(candidates));
    } catch {}
  }, [topic, runId, candidates, sessionRestored]);

  // ── Step 1: 브레인스토밍 시작 + 후보 폴링 ───────────────────
  const pollBrainstorm = useCallback((id: string) => {
    clearPoll();
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        clearPoll(); setBsLoading(false);
        setBsError(`브레인스토밍이 너무 오래 걸려 중단했습니다(${POLL_TIMEOUT_MIN}분 초과). 잠시 후 다시 시도해주세요.`);
        return;
      }
      try {
        const res = await fetch(`/api/brainstorm?runId=${id}`);
        const data = await res.json() as { status?: string; candidates?: Candidate[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "상태 조회 실패");
        if (data.status === "brainstormed") {
          clearPoll();
          setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
          setSelectedIdx(null);
          setPageOffset(0);
          setBsLoading(false);
          setPhase("candidates");
        } else if (data.status === "failed") {
          clearPoll(); setBsLoading(false);
          setBsError(data.error ?? "브레인스토밍에 실패했습니다.");
        }
        // pending → 계속 폴링
      } catch (e) {
        clearPoll(); setBsLoading(false);
        setBsError(e instanceof Error ? e.message : "상태 조회 실패");
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const startBrainstorm = useCallback(async () => {
    if (!topic.trim() || bsLoading) return;
    setBsLoading(true); setBsError(null); setCandidates([]); setSelectedIdx(null);
    try {
      const res = await fetch("/api/brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), provider: selectedProvider, skipInitialResearch, contextBudget: JSON.stringify(ctxBudget) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "브레인스토밍 시작 실패");
      setRunId(data.runId);
      pollBrainstorm(data.runId);
    } catch (e) {
      setBsError(e instanceof Error ? e.message : "브레인스토밍 시작에 실패했습니다.");
      setBsLoading(false);
    }
  }, [topic, bsLoading, selectedProvider, skipInitialResearch, ctxBudget, pollBrainstorm]);

  // ── Step 3: 채널 생성 + finalize/결과 폴링 ──────────────────
  const pollResults = useCallback((id: string, targeted: ChannelKey[]) => {
    clearPoll();
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        clearPoll(); setGenerating(false); generatingRef.current = false;
        setGenError(`응답이 너무 오래 걸려 화면 표시를 중단했습니다(${POLL_TIMEOUT_MIN}분 초과). 생성 자체는 서버에서 계속 진행되며, 완료되면 결과물 보관함에 자동으로 저장됩니다.`);
        setResults(prev => { const n = { ...prev }; for (const ch of targeted) if (n[ch].status === "loading") n[ch] = { status: "error" }; return n; });
        return;
      }
      try {
        const res = await fetch(`/api/generate?runId=${id}`);
        const data = await res.json() as {
          runStatus: string; runError?: string; selectedTopic?: string | null; finalizeStage?: string;
          tasks: Array<{ taskId: string; channel: ChannelKey; status: string; result?: string; error?: string; cardAssets?: CardAsset[] }>;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "상태 조회 실패");

        if (data.runStatus === "failed") {
          clearPoll(); setGenerating(false); generatingRef.current = false;
          setGenError(data.runError ?? "리서치/기획 단계에서 실패했습니다.");
          setResults(prev => { const n = { ...prev }; for (const ch of targeted) if (n[ch].status === "loading") n[ch] = { status: "error" }; return n; });
          return;
        }

        // [M8 Q3] finalize 진행 상태를 매 틱 갱신 — 재개선 fresh(다른 채널 task가 남아있는 상태)
        // 에서도 심화 리서치 배너가 뜨게 한다. finalize task가 끝나면 status='completed'라 배너 자동 소멸.
        setFinalizeStage(data.finalizeStage ?? "");

        // finalize가 아직 채널 task를 안 만든 상태(초기 생성 시)
        if (!data.tasks || data.tasks.length === 0) {
          return;
        }

        setResults(prev => {
          const n = { ...prev };
          for (const t of data.tasks) {
            if (t.status === "completed") {
              n[t.channel] = { status: "done", content: t.result, cardAssets: t.cardAssets };
            } else if (t.status === "failed") {
              n[t.channel] = { status: "error" };
            } else {
              n[t.channel] = { status: "loading", stage: t.status };
            }
          }
          return n;
        });

        const allSettled = data.tasks.length >= targeted.length
          && data.tasks.every(t => t.status === "completed" || t.status === "failed");
        if (allSettled) {
          // 결과물 저장(results 아카이브)은 더 이상 여기서 하지 않는다 — 워커가 작업을 종료
          // 처리하는 시점에 서버에서 직접 저장한다(archiveRunResultsIfSettled, render-worker/index.ts).
          // 프론트가 폴링 타임아웃으로 먼저 포기해도(naver-blog처럼 오래 걸리는 채널) 워커가
          // 나중에 완성한 결과가 항상 남게 하기 위함 — 여기서 같이 저장하면 정상적으로 빨리
          // 끝나는 경우 서버와 중복 저장된다.
          clearPoll(); setGenerating(false); generatingRef.current = false;
        }
      } catch (e) {
        clearPoll(); setGenerating(false); generatingRef.current = false;
        setGenError(e instanceof Error ? e.message : "상태 조회 실패");
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (generatingRef.current || generating || selectedIdx === null || selectedChannels.length === 0 || !runId) return;
    generatingRef.current = true;
    setGenerating(true); setGenError(null); setFinalizeStage("");
    const targeted = selectedChannels;
    setResultChannels(targeted);
    setResults(
      Object.fromEntries(
        CHANNELS.map(c => [c, { status: targeted.includes(c) ? "loading" : "idle", stage: "pending" }])
      ) as Record<ChannelKey, ChannelResult>
    );
    setPhase("results");
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          selectedCandidateIndex: selectedIdx,
          channels: targeted,
          provider: selectedProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 요청 실패");
      pollResults(runId, targeted);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "생성 요청에 실패했습니다.");
      setGenerating(false); generatingRef.current = false;
    }
  }, [generating, selectedIdx, selectedChannels, runId, selectedProvider, pollResults]);

  // ── 모드 B: 초안 개선 생성 (input → results 직행) ──────────────
  const handleGenerateDraft = useCallback(async () => {
    if (generatingRef.current || generating || !userDraft.trim() || selectedChannels.length === 0) return;
    generatingRef.current = true;
    setGenerating(true); setGenError(null); setFinalizeStage("");
    const targeted = selectedChannels;
    setResultChannels(targeted);
    setResults(
      Object.fromEntries(
        CHANNELS.map(c => [c, { status: targeted.includes(c) ? "loading" : "idle", stage: "pending" }])
      ) as Record<ChannelKey, ChannelResult>
    );
    setPhase("results");
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userDraft: userDraft.trim(),
          doResearch,
          topic: topic.trim(), // 선택적 핵심 주제(제목/추출 대체용). 비면 워커가 초안서 추출.
          channels: targeted,
          provider: selectedProvider,
          contextBudget: JSON.stringify(ctxBudget),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 요청 실패");
      setRunId(data.runId);
      pollResults(data.runId, targeted);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "생성 요청에 실패했습니다.");
      setGenerating(false); generatingRef.current = false;
    }
  }, [generating, userDraft, doResearch, topic, selectedChannels, selectedProvider, ctxBudget, pollResults]);

  const toggleChannel = (ch: ChannelKey) =>
    setSelectedChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);

  const allDone = resultChannels.length > 0 && resultChannels.every(c => results[c].status === "done");

  // 결과가 다 나오면 재개선 대상 채널을 결과 채널로 기본 채움
  useEffect(() => { if (allDone) setReimproveSel(resultChannels); }, [allDone, resultChannels]);

  // ── 재개선: 선택 채널만 방향을 주고 다시 개선 ────────────────
  const handleReimprove = useCallback(async () => {
    if (generatingRef.current || generating || !runId || reimproveSel.length === 0) return;
    generatingRef.current = true;
    setGenerating(true); setGenError(null); setFinalizeStage("");
    setResults(prev => { const n = { ...prev }; for (const ch of reimproveSel) n[ch] = { status: "loading", stage: "pending" }; return n; });
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reimprove: true, runId, channels: reimproveSel,
          improveDirection: improveDir.trim(), researchMode, provider: selectedProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "재개선 요청 실패");
      pollResults(runId, resultChannels);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "재개선 요청에 실패했습니다.");
      setGenerating(false); generatingRef.current = false;
    }
  }, [generating, runId, reimproveSel, improveDir, researchMode, resultChannels, selectedProvider, pollResults]);

  const clearSession = () => ["csai_topic", "csai_runId", "csai_candidates"].forEach(k => sessionStorage.removeItem(k));
  const resetAll = () => {
    clearPoll(); clearSession();
    setPhase("input"); setTopic(""); setRunId(null); setCandidates([]);
    setSelectedIdx(null); setPageOffset(0); setSelectedChannels([]);
    setUserDraft(""); setDoResearch(true); setSkipInitialResearch(false); setCtxBudget(DEFAULT_BUDGET);
    setImproveDir(""); setResearchMode("reuse"); setReimproveSel([]);
    setBsError(null); setGenError(null); setFinalizeStage(""); setResultChannels([]);
    setResults(emptyResults());
  };

  const pageCands = candidates.slice(pageOffset, pageOffset + PAGE_SIZE);
  const providerLabel = AI_PROVIDERS.find(p => p.id === selectedProvider)?.label ?? selectedProvider;

  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20 px-4">
        <div className="max-w-5xl mx-auto">

          {/* ─── Hero ─────────────────────────────────────── */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-4 uppercase tracking-wide">
              <Sparkles className="w-3.5 h-3.5" />CS쉐어링 AI 마케팅 자동화
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight tracking-tight mb-3">
              리서치 기반 <span className="text-blue-600">주제 브레인스토밍</span>
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-xl mx-auto">
              주제를 넣으면 웹 리서치로 근거 있는 후보를 여러 개 제안하고,<br />
              하나를 고르면 심화 리서치·뼈대 설계까지 마쳐 채널별로 생성합니다.
            </p>
          </div>

          {/* ─── Step 인디케이터 ───────────────────────────── */}
          {phase !== "input" && (
            <div className="flex items-center justify-center gap-2 mb-8 text-sm">
              {[
                { key: "input", n: 1, label: "주제 입력" },
                { key: "candidates", n: 2, label: "후보 선택" },
                { key: "gen", n: 3, label: "채널 생성" },
              ].map((s, i) => {
                const stageOf = phase === "candidates" ? "candidates" : "gen";
                const active = (s.key === "candidates" && phase === "candidates")
                  || (s.key === "gen" && (phase === "channels" || phase === "results"));
                const done = (s.key === "input") || (s.key === "candidates" && stageOf === "gen");
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    {i > 0 && <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-medium ${active ? "bg-blue-600 text-white" : done ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${active ? "bg-white text-blue-600" : done ? "bg-blue-600 text-white" : "bg-slate-300 text-white"}`}>{s.n}</span>
                      {s.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Phase: 입력(주제) ─────────────────────────── */}
          {phase === "input" && (
            <div className="glass-card rounded-3xl p-6 sm:p-8 mb-8 max-w-2xl mx-auto">

              {/* 모드 선택 탭 */}
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setInputMode("topic")}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
                    inputMode === "topic" ? "bg-blue-600 border-blue-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  <Lightbulb className="w-4 h-4" />주제로 시작
                </button>
                <button
                  onClick={() => setInputMode("draft")}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
                    inputMode === "draft" ? "bg-blue-600 border-blue-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  <PenLine className="w-4 h-4" />내 초안 개선
                </button>
              </div>

              {/* AI 선택 바 */}
              <div className="mb-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">리서치 및 콘텐츠 생성 AI</p>
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
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
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
                <p className="text-[10px] text-slate-400 mt-2">리서치 전용 provider는 설정 페이지에서 따로 지정할 수 있습니다.</p>
              </div>

              {/* [M8 ④] 컨텍스트 참조량 — 카테고리별 개별 제어(양 모드 공용, 접기) */}
              <div className="mb-5">
                <button onClick={() => setBudgetOpen(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700">
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${budgetOpen ? "rotate-90" : ""}`} />
                  컨텍스트 참조량 (토큰 예산 · 고급)
                </button>
                {budgetOpen && (
                  <>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {BUDGET_FIELDS.map(f => (
                        <label key={f.key} className="text-[11px] text-slate-500">
                          {f.label}
                          <input type="number" min={0} value={ctxBudget[f.key]} disabled={bsLoading || generating}
                            onChange={e => setCtxBudget(prev => ({ ...prev, [f.key]: Math.max(0, Number(e.target.value) || 0) }))}
                            className="w-full mt-0.5 px-2 py-1 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60" />
                        </label>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5">자료실 각 카테고리를 몇 건·며칠 이내·몇 자까지 참고할지. 적을수록 빠르고 토큰 절약.</p>
                  </>
                )}
              </div>

              {inputMode === "topic" ? (
                <>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    주제 또는 핵심 문구 입력
                  </label>
                  <textarea
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    placeholder="예: CS 아웃소싱으로 비용 절감하는 방법"
                    rows={3}
                    disabled={bsLoading}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all disabled:opacity-60"
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void startBrainstorm(); }}
                  />
                  <p className="text-xs text-slate-400 mt-1.5 mb-4">Ctrl + Enter로 바로 브레인스토밍 시작</p>

                  <div className="flex flex-wrap gap-2 mb-5">
                    {EXAMPLE_TOPICS.map(ex => (
                      <button key={ex} onClick={() => setTopic(ex)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer">
                        {ex}
                      </button>
                    ))}
                  </div>

                  {/* [M8 #3] 1차 리서치 생략 토글 */}
                  <button
                    onClick={() => setSkipInitialResearch(v => !v)}
                    disabled={bsLoading}
                    className="mb-4 w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 cursor-pointer disabled:opacity-60">
                    <span className="text-left">
                      <span className="text-sm font-medium text-slate-700 block">1차 웹 리서치 생략 (누적 데이터만)</span>
                      <span className="text-[11px] text-slate-400">켜면 새 웹서치 없이 그동안 쌓인 리서치·우수작만으로 후보 발산(빠름·저비용). 누적이 없으면 근거가 약할 수 있음.</span>
                    </span>
                    <span className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${skipInitialResearch ? "bg-blue-600" : "bg-slate-300"}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${skipInitialResearch ? "left-[1.125rem]" : "left-0.5"}`} />
                    </span>
                  </button>

                  {bsError && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 shrink-0" />{bsError}
                    </div>
                  )}

                  <button onClick={() => void startBrainstorm()} disabled={!topic.trim() || bsLoading}
                    className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold">
                    {bsLoading
                      ? <><Loader2 className="w-5 h-5 animate-spin" />리서치하며 후보 발산 중... (최대 1~2분)</>
                      : <><Sparkles className="w-5 h-5" />{providerLabel}로 브레인스토밍 시작</>}
                  </button>
                  {bsLoading && (
                    <p className="text-xs text-slate-400 text-center mt-3">웹 리서치 → 현장 목소리 → 후보 발산을 워커가 처리합니다. 이 창을 닫아도 진행됩니다.</p>
                  )}
                </>
              ) : (
                // 모드 B(내 초안 개선): 초안 + 리서치 토글 + 선택 주제 + 채널 → 바로 생성
                <>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">개선할 초안 붙여넣기</label>
                  <textarea
                    value={userDraft}
                    onChange={e => setUserDraft(e.target.value)}
                    placeholder="완성했거나 초안 상태인 글을 그대로 붙여넣으세요. 원문의 구조·목소리를 보존한 채 약한 부분만 보강합니다."
                    rows={8}
                    disabled={generating}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all disabled:opacity-60"
                  />

                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mt-4 mb-2">핵심 주제(한 줄, 선택)</label>
                  <input
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    placeholder="비워두면 초안에서 자동 추출 (보관함 제목·리서치 참고용)"
                    disabled={generating}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-60"
                  />

                  {/* 리서치 토글 */}
                  <button
                    onClick={() => setDoResearch(v => !v)}
                    disabled={generating}
                    className="mt-4 w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 cursor-pointer disabled:opacity-60"
                  >
                    <span className="text-left">
                      <span className="text-sm font-medium text-slate-700 block">심화 리서치로 근거 보강</span>
                      <span className="text-[11px] text-slate-400">켜면 초안의 논지에 맞는 근거를 웹에서 찾아 보강 / 끄면 표현·논리만 다듬음</span>
                    </span>
                    <span className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${doResearch ? "bg-blue-600" : "bg-slate-300"}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${doResearch ? "left-[1.125rem]" : "left-0.5"}`} />
                    </span>
                  </button>

                  {/* 채널 선택 */}
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2">개선본을 만들 채널</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {CHANNELS.map(ch => {
                      const isMine = selectedChannels.includes(ch);
                      const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];
                      return (
                        <button key={ch} onClick={() => toggleChannel(ch)} disabled={generating}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none disabled:opacity-60 ${
                            isMine ? `${bgColor} ${color} ${borderColor} shadow-sm` : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600"
                          }`}>
                          {isMine && <Check className="inline w-3 h-3 mr-0.5 -mt-px" />}{CHANNEL_LABELS[ch]}
                          {ch === "naver-blog" && <span className="ml-0.5 opacity-60">·Claude</span>}
                        </button>
                      );
                    })}
                  </div>

                  {blogNeedsClaudeKey && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 shrink-0" />네이버 블로그 생성에는 Claude API 키가 필요합니다.
                      <a href="/settings" className="font-semibold underline hover:text-amber-900">설정 →</a>
                    </div>
                  )}
                  {genError && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 shrink-0" />{genError}
                    </div>
                  )}

                  <button onClick={() => void handleGenerateDraft()}
                    disabled={generating || !userDraft.trim() || selectedChannels.length === 0 || blogNeedsClaudeKey}
                    className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold mt-5 disabled:opacity-50">
                    <Wand2 className="w-5 h-5" />
                    {!userDraft.trim() ? "초안을 붙여넣으세요"
                      : selectedChannels.length === 0 ? "채널을 선택하세요"
                      : `${selectedChannels.length}개 채널 · ${providerLabel}로 개선`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ─── Phase: 후보 선택 ──────────────────────────── */}
          {phase === "candidates" && (
            <div className="mb-8">
              <div className="text-center mb-6">
                <h2 className="text-lg font-bold text-slate-900 mb-1">리서치 기반 주제 후보 {candidates.length}개</h2>
                <p className="text-sm text-slate-500">근거가 가장 탄탄한 순으로 정렬했습니다. 하나를 골라 채널 생성으로 진행하세요.</p>
              </div>

              {candidates.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-400">후보를 불러오지 못했습니다. 다시 시도해주세요.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-stretch">
                    {pageCands.map((c, i) => {
                      const realIdx = pageOffset + i;
                      return (
                        <CandidateCard
                          key={realIdx}
                          candidate={c}
                          index={realIdx}
                          selected={selectedIdx === realIdx}
                          onSelect={() => setSelectedIdx(realIdx)}
                        />
                      );
                    })}
                  </div>

                  {/* 페이지네이션(클라이언트 슬라이싱 — 추가 fetch 없음) */}
                  {candidates.length > PAGE_SIZE && (
                    <div className="flex items-center justify-center gap-3 mb-6">
                      <button
                        onClick={() => setPageOffset(o => Math.max(0, o - PAGE_SIZE))}
                        disabled={pageOffset === 0}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default cursor-pointer">
                        <ChevronLeft className="w-3.5 h-3.5" />이전
                      </button>
                      <span className="text-xs text-slate-400">
                        {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, candidates.length)} / {candidates.length}
                      </span>
                      <button
                        onClick={() => setPageOffset(o => Math.min(candidates.length - 1, o + PAGE_SIZE))}
                        disabled={pageOffset + PAGE_SIZE >= candidates.length}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default cursor-pointer">
                        다음 {PAGE_SIZE}개<ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="max-w-lg mx-auto flex flex-col items-center gap-3">
                    <button
                      onClick={() => { if (selectedIdx !== null) { setSelectedChannels([]); setPhase("channels"); } }}
                      disabled={selectedIdx === null}
                      className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold disabled:opacity-50">
                      {selectedIdx === null ? "후보를 하나 선택하세요" : "이 주제로 채널 생성하기"}
                      {selectedIdx !== null && <ChevronRight className="w-4 h-4" />}
                    </button>
                    <button onClick={resetAll}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-sm hover:bg-slate-50 cursor-pointer">
                      <RefreshCw className="w-3.5 h-3.5" />새 주제로 다시 시작
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Phase: 채널 선택 ──────────────────────────── */}
          {phase === "channels" && selectedIdx !== null && candidates[selectedIdx] && (
            <div className="mb-8 max-w-2xl mx-auto">
              <div className="glass-card rounded-3xl p-6 sm:p-8">
                {/* 선택한 주제 요약 */}
                <div className="mb-5 pb-5 border-b border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">선택한 주제</p>
                  <h3 className="font-semibold text-slate-900 text-base leading-snug">{candidates[selectedIdx].topic}</h3>
                  {candidates[selectedIdx].core_claim && (
                    <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{candidates[selectedIdx].core_claim}</p>
                  )}
                </div>

                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">생성할 채널 선택</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {CHANNELS.map(ch => {
                    const isMine = selectedChannels.includes(ch);
                    const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];
                    return (
                      <button
                        key={ch}
                        onClick={() => toggleChannel(ch)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none ${
                          isMine ? `${bgColor} ${color} ${borderColor} shadow-sm` : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600"
                        }`}
                      >
                        {isMine && <Check className="inline w-3 h-3 mr-0.5 -mt-px" />}
                        {CHANNEL_LABELS[ch]}
                        {ch === "naver-blog" && <span className="ml-0.5 opacity-60">·Claude</span>}
                      </button>
                    );
                  })}
                </div>

                {blogNeedsClaudeKey && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    네이버 블로그 생성에는 Claude API 키가 필요합니다.
                    <a href="/settings" className="font-semibold underline hover:text-amber-900">설정에서 연결하기 →</a>
                  </div>
                )}

                <div className="flex gap-2 mt-6">
                  <button onClick={() => setPhase("candidates")}
                    className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 cursor-pointer">
                    <ArrowLeft className="w-4 h-4" />후보로
                  </button>
                  <button onClick={() => void handleGenerate()} disabled={generating || selectedChannels.length === 0 || blogNeedsClaudeKey}
                    className="btn-cta flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-base font-semibold disabled:opacity-50">
                    <Wand2 className="w-5 h-5" />
                    {selectedChannels.length > 0 ? `${selectedChannels.length}개 채널 · ${providerLabel}로 생성` : "채널을 선택하세요"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Phase: 결과 ───────────────────────────────── */}
          {phase === "results" && (
            <div ref={resultsRef}>
              {/* finalize(심화 리서치·뼈대 설계) 진행 표시 — 초기 생성·재개선 fresh 모두. [M8 Q3] */}
              {(finalizeStage === "research-deep" || finalizeStage === "skeleton" || finalizeStage.startsWith("소스")) && !allDone && !genError && (
                <div className="max-w-lg mx-auto mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>
                    {finalizeStage === "research-deep" ? "선택한 주제로 심화 리서치 중..."
                      : finalizeStage === "skeleton" ? "콘텐츠 뼈대(구조) 설계 중..."
                      : finalizeStage?.startsWith("소스") ? `${finalizeStage}...`
                      : "심화 리서치·뼈대 설계 준비 중..."}
                  </span>
                </div>
              )}

              {allDone && !generating && (
                <div className="text-center mb-6 flex flex-col items-center gap-3">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    {resultChannels.length}개 채널 생성 완료
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => { clearPoll(); setPhase("candidates"); setGenError(null); setResultChannels([]); setResults(emptyResults()); }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 cursor-pointer">
                      <ArrowLeft className="w-3.5 h-3.5" />후보로 돌아가기
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

              {/* ── 재개선 패널 (모드 B 전용) ── */}
              {allDone && !generating && inputMode === "draft" && (
                <div className="glass-card rounded-2xl p-5 mb-6 max-w-2xl mx-auto">
                  <p className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-blue-600" />맘에 안 들면 방향을 주고 다시 개선</p>
                  <textarea
                    value={improveDir}
                    onChange={e => setImproveDir(e.target.value)}
                    placeholder="개선 방향 (예: 더 데이터 중심으로 / 톤을 캐주얼하게 / 도입부를 강하게)"
                    rows={2}
                    className="w-full mt-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />

                  {/* 리서치 방식 3지선다 */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {([
                      { v: "reuse", label: "기존 근거 재사용", desc: "빠름" },
                      { v: "accumulated", label: "누적 데이터도 참고", desc: "폭넓게" },
                      { v: "fresh", label: "리서치 새로", desc: "느림·최신" },
                    ] as const).map(o => (
                      <button key={o.v} onClick={() => setResearchMode(o.v)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${researchMode === o.v ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                        {o.label}<span className="ml-1 opacity-60 font-normal">· {o.desc}</span>
                      </button>
                    ))}
                  </div>

                  {/* 재개선할 채널 */}
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-4 mb-1.5">다시 개선할 채널</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {resultChannels.map(ch => {
                      const on = reimproveSel.includes(ch);
                      const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];
                      return (
                        <button key={ch} onClick={() => setReimproveSel(prev => on ? prev.filter(c => c !== ch) : [...prev, ch])}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${on ? `${bgColor} ${color} ${borderColor}` : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"}`}>
                          {on && <Check className="inline w-2.5 h-2.5 mr-0.5 -mt-px" />}{CHANNEL_LABELS[ch]}
                        </button>
                      );
                    })}
                  </div>

                  <button onClick={() => void handleReimprove()} disabled={reimproveSel.length === 0}
                    className="btn-cta w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                    <Wand2 className="w-4 h-4" />{reimproveSel.length === 0 ? "채널을 선택하세요" : `${reimproveSel.length}개 채널 다시 개선`}
                  </button>
                </div>
              )}

              {genError && (
                <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 max-w-2xl mx-auto">
                  <AlertCircle className="w-4 h-4 shrink-0" />{genError}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {resultChannels.map(channel => (
                  <div key={channel} className={resultChannels.length === 1 ? "lg:col-span-2" : ""}>
                    <ChannelResultCard channel={channel} status={results[channel].status} content={results[channel].content} stage={results[channel].stage} cardAssets={results[channel].cardAssets} />
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
