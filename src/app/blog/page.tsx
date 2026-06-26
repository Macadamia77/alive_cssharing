"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  ChevronDown,
  ChevronUp,
  Copy,
  RefreshCw,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Link from "next/link";

type AIProvider = "mock" | "claude" | "openai" | "gemini";
type StepId = "research" | "write" | "assemble";
type StepStatus = "idle" | "loading" | "done" | "error";

const AI_PROVIDERS: {
  id: AIProvider;
  label: string;
  activeClass: string;
  dotColor: string;
}[] = [
  {
    id: "claude",
    label: "Claude",
    activeClass: "bg-orange-50 border-orange-300 text-orange-700",
    dotColor: "bg-orange-400",
  },
  {
    id: "openai",
    label: "OpenAI",
    activeClass: "bg-emerald-50 border-emerald-300 text-emerald-700",
    dotColor: "bg-emerald-400",
  },
  {
    id: "gemini",
    label: "Gemini",
    activeClass: "bg-blue-50 border-blue-300 text-blue-700",
    dotColor: "bg-blue-400",
  },
];

const STEPS: { id: StepId; label: string; desc: string; emoji: string }[] = [
  {
    id: "research",
    label: "리서치",
    desc: "주제 분석, 키워드 선정, 자사 서비스 연결점 파악",
    emoji: "🔍",
  },
  {
    id: "write",
    label: "초안 작성",
    desc: "가이드 기반 2,800자+ 블로그 초안 (PUBLISH/NOTES 구조)",
    emoji: "✍️",
  },
  {
    id: "assemble",
    label: "HTML 조립",
    desc: "네이버 블로그 스타일 최종 HTML 생성",
    emoji: "🏗️",
  },
];

interface StepState {
  status: StepStatus;
  output: string;
  error: string;
  expanded: boolean;
}

function makeInitialSteps(): Record<StepId, StepState> {
  return {
    research: { status: "idle", output: "", error: "", expanded: false },
    write: { status: "idle", output: "", error: "", expanded: false },
    assemble: { status: "idle", output: "", error: "", expanded: false },
  };
}

const EXAMPLE_TOPICS = [
  "CS 아웃소싱으로 비용 절감하는 방법",
  "AI 고객센터 도입 효과",
  "고객 만족도를 높이는 VOC 분석",
  "스타트업 고객센터 구축 전략",
];

export default function BlogPipelinePage() {
  const [topic, setTopic] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("gemini");
  const [availableProviders, setAvailableProviders] = useState<AIProvider[]>(["gemini"]);
  const [steps, setSteps] = useState<Record<StepId, StepState>>(makeInitialSteps());
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  // Load available providers from settings
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = (await res.json()) as {
          activeProvider: AIProvider;
          providers: Record<string, { apiKeySet: boolean }>;
        };
        const available: AIProvider[] = [];
        for (const p of ["claude", "openai", "gemini"] as const) {
          if (data.providers[p]?.apiKeySet) available.push(p);
        }
        setAvailableProviders(available.length > 0 ? available : ["gemini"]);

        const lsProvider = localStorage.getItem("csai_provider") as AIProvider | null;
        const firstReal = available[0];
        const defaultProvider =
          lsProvider && available.includes(lsProvider)
            ? lsProvider
            : firstReal ?? "gemini";
        setSelectedProvider(defaultProvider);
      } catch {
        /* keep default */
      }
    })();
  }, []);

  const updateStep = (id: StepId, patch: Partial<StepState>) => {
    setSteps((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const runStep = async (
    stepId: StepId,
    topic: string,
    context?: string
  ): Promise<string> => {
    updateStep(stepId, { status: "loading", error: "", output: "" });
    const res = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        channel: "naver-blog",
        step: stepId,
        context,
        provider: selectedProvider,
      }),
    });
    const data = (await res.json()) as { output?: string; error?: string };
    if (!res.ok || data.error) {
      const errMsg = data.error ?? "알 수 없는 오류";
      updateStep(stepId, { status: "error", error: errMsg });
      throw new Error(errMsg);
    }
    const output = data.output ?? "";
    updateStep(stepId, { status: "done", output, expanded: false });
    return output;
  };

  const handleStart = async () => {
    if (!topic.trim() || isRunning) return;
    setIsRunning(true);
    setSteps(makeInitialSteps());

    try {
      const researchOut = await runStep("research", topic.trim());
      const writeOut = await runStep("write", topic.trim(), researchOut);
      await runStep("assemble", topic.trim(), writeOut);
    } catch {
      // error already set on the failing step
    } finally {
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setSteps(makeInitialSteps());
    setTopic("");
  };

  const assembleOutput = steps.assemble.output;
  const isDone = steps.assemble.status === "done";

  const handleCopyHtml = async () => {
    if (!assembleOutput) return;
    await navigator.clipboard.writeText(assembleOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!assembleOutput) return;
    const blob = new Blob([assembleOutput], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic.trim().slice(0, 20).replace(/\s+/g, "-")}-blog.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stepStatusIcon = (status: StepStatus) => {
    if (status === "loading")
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    if (status === "done")
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    if (status === "error")
      return <XCircle className="w-5 h-5 text-red-500" />;
    return <Circle className="w-5 h-5 text-slate-300" />;
  };

  const overallHasError = STEPS.some((s) => steps[s.id].status === "error");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 pt-28 pb-16">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">네이버 블로그 자동화</h1>
          </div>
          <p className="text-sm text-slate-500 ml-10">
            리서치 → 초안 작성 → HTML 조립까지 멀티 에이전트 파이프라인으로 자동 생성합니다.
          </p>
        </div>

        {/* Topic Input */}
        <div className="glass-card rounded-2xl p-5 mb-4">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            블로그 주제
          </label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="예: CS 아웃소싱으로 비용 절감하는 방법"
            rows={2}
            disabled={isRunning}
            className="w-full text-sm text-slate-900 placeholder-slate-400 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none font-[inherit] disabled:opacity-60 disabled:cursor-not-allowed"
          />
          {/* Example chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EXAMPLE_TOPICS.map((t) => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                disabled={isRunning}
                className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Provider Selector */}
        <div className="glass-card rounded-2xl p-4 mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            AI 제공사
          </p>
          <div className="flex gap-2 flex-wrap">
            {AI_PROVIDERS.filter((p) => availableProviders.includes(p.id)).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedProvider(p.id);
                  localStorage.setItem("csai_provider", p.id);
                }}
                disabled={isRunning}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedProvider === p.id
                    ? p.activeClass
                    : "bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${p.dotColor}`} />
                {p.label}
              </button>
            ))}
            {availableProviders.length === 0 && (
              <p className="text-sm text-slate-400">
                API 키가 설정되지 않았습니다.{" "}
                <Link href="/settings" className="text-blue-600 underline">
                  설정 페이지
                </Link>
                에서 API 키를 추가하세요.
              </p>
            )}
          </div>
          {selectedProvider === "gemini" && (
            <p className="text-[11px] text-blue-500 mt-1.5">
              ✨ Gemini는 리서치 단계에서 Google Search를 통해 실시간 웹 검색을 수행합니다.
            </p>
          )}
        </div>

        {/* Start Button */}
        <button
          onClick={isDone || overallHasError ? handleReset : handleStart}
          disabled={isRunning || (!isDone && !overallHasError && !topic.trim())}
          className={`w-full py-3 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2 mb-6 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            isDone || overallHasError
              ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
              : "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-200"
          }`}
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              생성 중...
            </>
          ) : isDone ? (
            <>
              <RefreshCw className="w-4 h-4" />
              새로 만들기
            </>
          ) : overallHasError ? (
            <>
              <RefreshCw className="w-4 h-4" />
              다시 시도
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              블로그 글 생성 시작
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {/* Pipeline Steps */}
        {STEPS.map((step, idx) => {
          const state = steps[step.id];
          const isActive = state.status !== "idle";

          if (!isActive) {
            // Show as upcoming step (dimmed)
            return (
              <div
                key={step.id}
                className="flex items-center gap-3 px-5 py-4 mb-3 rounded-2xl border border-dashed border-slate-200 opacity-40"
              >
                {stepStatusIcon("idle")}
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-600">
                    {step.emoji} STEP {idx + 1}. {step.label}
                  </p>
                  <p className="text-xs text-slate-400">{step.desc}</p>
                </div>
              </div>
            );
          }

          return (
            <div
              key={step.id}
              className={`rounded-2xl border mb-3 overflow-hidden transition-all ${
                state.status === "loading"
                  ? "border-blue-200 bg-blue-50/30"
                  : state.status === "done"
                  ? "border-emerald-200 bg-white"
                  : "border-red-200 bg-red-50/20"
              }`}
            >
              {/* Step Header */}
              <div className="flex items-center gap-3 px-5 py-4">
                {stepStatusIcon(state.status)}
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {step.emoji} STEP {idx + 1}. {step.label}
                  </p>
                  <p className="text-xs text-slate-500">{step.desc}</p>
                </div>
                {state.status === "loading" && (
                  <span className="text-xs text-blue-500 font-medium animate-pulse">
                    생성 중...
                  </span>
                )}
                {state.status === "done" && state.output && (
                  <button
                    onClick={() =>
                      updateStep(step.id, { expanded: !state.expanded })
                    }
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                  >
                    {state.expanded ? (
                      <>
                        접기 <ChevronUp className="w-3.5 h-3.5" />
                      </>
                    ) : (
                      <>
                        결과 보기 <ChevronDown className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                )}
                {state.status === "error" && (
                  <span className="text-xs text-red-500 font-medium">실패</span>
                )}
              </div>

              {/* Error message */}
              {state.status === "error" && state.error && (
                <div className="px-5 pb-4">
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                    {state.error}
                  </p>
                </div>
              )}

              {/* Expandable output (for research and write steps) */}
              {state.status === "done" &&
                state.expanded &&
                step.id !== "assemble" && (
                  <div className="px-5 pb-5 border-t border-slate-100">
                    <pre
                      className="text-xs text-slate-600 whitespace-pre-wrap font-mono bg-slate-50 rounded-xl p-4 max-h-72 overflow-y-auto mt-3"
                      style={{ scrollbarWidth: "thin" }}
                    >
                      {state.output}
                    </pre>
                  </div>
                )}
            </div>
          );
        })}

        {/* Final Result */}
        {isDone && assembleOutput && (
          <div className="mt-6 rounded-2xl border border-emerald-300 bg-white overflow-hidden">
            {/* Result Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900 text-sm">🌐 블로그 미리보기</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  네이버 블로그 스타일로 렌더링된 최종 결과물
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopyHtml}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? "복사됨!" : "HTML 복사"}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  HTML 다운로드
                </button>
              </div>
            </div>

            {/* iframe preview */}
            <iframe
              ref={previewRef}
              srcDoc={assembleOutput}
              sandbox="allow-same-origin"
              title="블로그 미리보기"
              className="w-full border-0"
              style={{ height: "680px" }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
