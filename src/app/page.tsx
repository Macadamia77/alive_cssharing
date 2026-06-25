"use client";

import { useState, useRef } from "react";
import { Wand2, Sparkles, BookOpen, AlertCircle } from "lucide-react";
import ChannelResultCard, { type ChannelKey } from "@/components/ChannelResultCard";
import { CHANNELS, CHANNEL_LABELS, CHANNEL_COLORS } from "@/lib/channels";
import Navbar from "@/components/Navbar";

type ChannelStatus = "idle" | "loading" | "done" | "error";

interface ChannelResult {
  status: ChannelStatus;
  content?: string;
}

const EXAMPLE_TOPICS = [
  "CS 아웃소싱으로 비용 절감하는 방법",
  "AI 고객센터 도입 효과",
  "고객 만족도를 높이는 VOC 분석",
  "스타트업 고객센터 구축 전략",
  "24시간 고객 대응 운영 노하우",
];

export default function HomePage() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeChannels, setActiveChannels] = useState<Set<ChannelKey>>(new Set(CHANNELS));
  const [results, setResults] = useState<Record<ChannelKey, ChannelResult>>(
    Object.fromEntries(CHANNELS.map((c) => [c, { status: "idle" }])) as Record<ChannelKey, ChannelResult>
  );
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const toggleChannel = (ch: ChannelKey) => {
    setActiveChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        if (next.size === 1) return prev; // 최소 1개 유지
        next.delete(ch);
      } else {
        next.add(ch);
      }
      return next;
    });
  };

  const selectedChannels = CHANNELS.filter((c) => activeChannels.has(c));

  const handleGenerate = async () => {
    if (!topic.trim() || isGenerating || selectedChannels.length === 0) return;

    setError(null);
    setIsGenerating(true);

    setResults(
      Object.fromEntries(
        CHANNELS.map((c) => [c, selectedChannels.includes(c) ? { status: "loading" } : { status: "idle" }])
      ) as Record<ChannelKey, ChannelResult>
    );

    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), channels: selectedChannels }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "생성 실패");
      }

      const data = await res.json();

      const newResults: Record<ChannelKey, ChannelResult> = { ...results };
      for (const { channel, content } of data.results) {
        newResults[channel as ChannelKey] = { status: "done", content };
      }
      setResults(newResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setResults(
        Object.fromEntries(
          CHANNELS.map((c) => [c, selectedChannels.includes(c) ? { status: "error" } : { status: "idle" }])
        ) as Record<ChannelKey, ChannelResult>
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const hasAnyResult = selectedChannels.some((c) => results[c].status !== "idle");
  const allDone = selectedChannels.every((c) => results[c].status === "done");

  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20 px-4">
        <div className="max-w-6xl mx-auto">

          {/* Hero */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-4 uppercase tracking-wide">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              CS쉐어링 AI 마케팅 자동화
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight tracking-tight mb-3">
              주제 하나로
              <span className="text-blue-600"> 5개 채널</span> 동시 생성
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-lg mx-auto">
              네이버 블로그 · 인스타그램 · 페이스북 · 링크드인 · 매거진
              <br />채널별 가이드에 맞춰 AI가 자동으로 완성합니다.
            </p>
          </div>

          {/* Input Card */}
          <div className="glass-card rounded-3xl p-6 sm:p-8 mb-10 max-w-2xl mx-auto">
            <label
              htmlFor="topic-input"
              className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2"
            >
              주제 또는 핵심 문구 입력
            </label>
            <textarea
              id="topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="예: CS 아웃소싱으로 비용 절감하는 방법"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all duration-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
              }}
              aria-describedby="topic-hint"
              disabled={isGenerating}
            />
            <p id="topic-hint" className="text-xs text-slate-400 mt-1.5 mb-4">
              Ctrl + Enter로 바로 생성할 수 있어요
            </p>

            {/* Example topics */}
            <div className="flex flex-wrap gap-2 mb-5">
              {EXAMPLE_TOPICS.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setTopic(ex)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors duration-200 cursor-pointer"
                  aria-label={`예시 주제: ${ex}`}
                >
                  {ex}
                </button>
              ))}
            </div>

            {/* Channel toggle buttons */}
            <div className="mb-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">생성할 채널 선택</p>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => {
                  const { bgColor, color, borderColor } = CHANNEL_COLORS[ch];
                  const isActive = activeChannels.has(ch);
                  return (
                    <button
                      key={ch}
                      onClick={() => toggleChannel(ch)}
                      disabled={isGenerating}
                      aria-pressed={isActive}
                      aria-label={`${CHANNEL_LABELS[ch]} ${isActive ? "선택됨" : "선택 해제"}`}
                      className={`
                        relative px-3.5 py-1.5 rounded-xl text-xs font-semibold border
                        transition-all duration-200 cursor-pointer select-none
                        ${isActive
                          ? `${bgColor} ${color} ${borderColor} shadow-sm scale-100 opacity-100`
                          : "bg-slate-100 text-slate-400 border-slate-200 opacity-50 hover:opacity-70"
                        }
                        ${isGenerating ? "cursor-not-allowed" : ""}
                      `}
                    >
                      {CHANNEL_LABELS[ch]}
                      {isActive && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                {selectedChannels.length}개 선택됨 — 클릭으로 켜고 끌 수 있어요
              </p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!topic.trim() || isGenerating || selectedChannels.length === 0}
              className="btn-cta w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold mt-5"
              aria-busy={isGenerating}
            >
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  {selectedChannels.length}개 채널 생성 중...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" aria-hidden="true" />
                  {selectedChannels.length}개 채널 콘텐츠 생성하기
                </>
              )}
            </button>

            {error && (
              <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3" role="alert">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}
          </div>

          {/* Results Grid */}
          {hasAnyResult && (
            <div ref={resultsRef} className="fade-in">
              {allDone && (
                <div className="text-center mb-6">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    {selectedChannels.length}개 채널 생성 완료 — 각 콘텐츠를 확인하고 복사해서 사용하세요
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {selectedChannels.map((channel) => (
                  <div
                    key={channel}
                    className={channel === "magazine" || selectedChannels.length === 1 ? "lg:col-span-2" : ""}
                  >
                    <ChannelResultCard
                      channel={channel}
                      status={results[channel].status}
                      content={results[channel].content}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guide shortcut */}
          {!hasAnyResult && (
            <div className="text-center mt-6">
              <a
                href="/guides"
                className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 transition-colors duration-200 cursor-pointer"
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                채널별 가이드 확인 및 수정하기
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
