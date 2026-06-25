"use client";

import { useState } from "react";
import { FileText, Wand2, Copy, Check, Sparkles, Share2 } from "lucide-react";

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

type ContentType = "blog" | "sns";
type Platform = "instagram" | "twitter" | "linkedin";
type Tone = "friendly" | "professional" | "humorous";

const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "instagram", label: "Instagram", icon: <InstagramIcon />, color: "text-pink-500" },
  { id: "twitter", label: "Twitter / X", icon: <TwitterIcon />, color: "text-sky-500" },
  { id: "linkedin", label: "LinkedIn", icon: <LinkedInIcon />, color: "text-blue-700" },
];

const TONES: { id: Tone; label: string; emoji: string }[] = [
  { id: "friendly", label: "친근한", emoji: "😊" },
  { id: "professional", label: "전문적", emoji: "💼" },
  { id: "humorous", label: "유머러스", emoji: "😄" },
];

const EXAMPLE_TOPICS = [
  "건강한 아침 루틴 만들기",
  "재택근무 생산성 높이는 법",
  "2024년 디지털 마케팅 트렌드",
  "초보자를 위한 투자 가이드",
];

function SkeletonLine({ width = "full" }: { width?: string }) {
  return <div className={`skeleton h-4 w-${width} my-1`} aria-hidden="true" />;
}

function GeneratingSkeletons() {
  return (
    <div className="space-y-3 p-5" role="status" aria-label="콘텐츠 생성 중">
      <SkeletonLine width="3/4" />
      <SkeletonLine />
      <SkeletonLine />
      <SkeletonLine width="5/6" />
      <div className="pt-2" />
      <SkeletonLine />
      <SkeletonLine width="4/5" />
      <SkeletonLine />
      <SkeletonLine width="2/3" />
    </div>
  );
}

function generateMockContent(type: ContentType, platform: Platform, tone: Tone, topic: string): string {
  const toneMap = {
    friendly: "친근하고 따뜻한",
    professional: "전문적이고 신뢰감 있는",
    humorous: "유머러스하고 재치있는",
  };

  if (type === "blog") {
    return `# ${topic}에 대한 완벽한 가이드

## 들어가며

${toneMap[tone]} 시선으로 ${topic}을 살펴보겠습니다. 많은 분들이 궁금해하시는 주제인 만큼 자세하고 실용적인 정보를 제공하려 합니다.

## 핵심 포인트 3가지

**1. 기초부터 탄탄하게**
${topic}을 시작하기 전에 기본 개념을 이해하는 것이 중요합니다. 기초가 탄탄해야 발전도 빠릅니다.

**2. 꾸준함이 답이다**
하루 10분이라도 꾸준히 실천하는 것이 큰 차이를 만듭니다. 완벽한 시작보다 지속적인 노력이 더 중요합니다.

**3. 커뮤니티를 활용하세요**
혼자 하는 것보다 같은 목표를 가진 사람들과 함께하면 동기부여와 정보 공유 모두 가능합니다.

## 마치며

오늘 소개한 방법들을 꾸준히 실천해보세요. 작은 변화들이 모여 큰 결과를 만들어냅니다. 궁금한 점은 댓글로 남겨주세요!

---
*이 글이 도움이 되었다면 공유해주세요.*`;
  }

  const platformGuides = {
    instagram: `📌 ${topic}

${toneMap[tone]} 내용을 담았어요!

✅ 핵심 포인트 1 — 기본부터 시작하기
✅ 핵심 포인트 2 — 꾸준한 실천
✅ 핵심 포인트 3 — 커뮤니티 활용

오늘부터 함께 시작해볼까요? 👇

#${topic.replace(/\s/g, "")} #라이프스타일 #성장 #동기부여 #일상`,
    twitter: `${topic}에 대해 알아야 할 3가지 👇

1️⃣ 기초부터 탄탄하게 다지기
2️⃣ 하루 10분 꾸준한 실천
3️⃣ 커뮤니티와 함께 성장

작은 시작이 큰 변화를 만듭니다.

#${topic.replace(/\s/g, "")} #성장 #도전`,
    linkedin: `${topic}: 실무에서 바로 적용할 수 있는 인사이트

${toneMap[tone]} 관점에서 ${topic}을 분석해봤습니다.

핵심은 단순합니다. 기초 → 꾸준함 → 네트워크.

이 세 가지 원칙을 지킨 분들이 실질적인 성과를 이루는 것을 많이 목격했습니다.

여러분은 어떤 방법으로 접근하고 계신가요? 댓글로 공유해주세요.

#${topic.replace(/\s/g, "")} #비즈니스 #성장 #LinkedIn`,
  };

  return platformGuides[platform];
}

export default function ContentGenerator() {
  const [contentType, setContentType] = useState<ContentType>("blog");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [tone, setTone] = useState<Tone>("friendly");
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!topic.trim() || isGenerating) return;

    setIsGenerating(true);
    setResult(null);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const generated = generateMockContent(contentType, platform, tone, topic.trim());
    setResult(generated);
    setIsGenerating(false);
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExampleClick = (example: string) => {
    setTopic(example);
  };

  return (
    <section id="generator" className="w-full max-w-2xl mx-auto" aria-label="AI 콘텐츠 생성기">
      <div className="glass-card rounded-3xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-blue-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">콘텐츠 생성기</h2>
          </div>
          <p className="text-sm text-slate-500">주제를 입력하고 AI가 완성하게 하세요</p>
        </div>

        <div className="p-6 space-y-5">
          {/* Content Type Tabs */}
          <div role="group" aria-label="콘텐츠 유형 선택">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              콘텐츠 유형
            </label>
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setContentType("blog")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                  contentType === "blog"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
                aria-pressed={contentType === "blog"}
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                블로그 / 아티클
              </button>
              <button
                onClick={() => setContentType("sns")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                  contentType === "sns"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
                aria-pressed={contentType === "sns"}
              >
                <Share2 className="w-4 h-4" aria-hidden="true" />
                SNS 콘텐츠
              </button>
            </div>
          </div>

          {/* Platform selector (SNS only) */}
          {contentType === "sns" && (
            <div className="fade-in" role="group" aria-label="플랫폼 선택">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                플랫폼
              </label>
              <div className="flex gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlatform(p.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 cursor-pointer ${
                      platform === p.id
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                    aria-pressed={platform === p.id}
                  >
                    <span className={platform === p.id ? p.color : ""}>{p.icon}</span>
                    <span className="hidden sm:inline">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tone selector */}
          <div role="group" aria-label="톤 선택">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              톤 & 스타일
            </label>
            <div className="flex gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTone(t.id)}
                  className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all duration-200 cursor-pointer ${
                    tone === t.id
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  aria-pressed={tone === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Topic input */}
          <div>
            <label
              htmlFor="topic-input"
              className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2"
            >
              주제 입력
            </label>
            <div className="relative">
              <textarea
                id="topic-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="예: 건강한 아침 루틴 만들기, 재택근무 생산성 높이는 법..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all duration-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
                aria-describedby="topic-hint"
              />
              <p id="topic-hint" className="sr-only">Ctrl+Enter 또는 Cmd+Enter로 생성할 수 있습니다</p>
            </div>

            {/* Example topics */}
            <div className="mt-2 flex flex-wrap gap-1.5" role="list" aria-label="주제 예시">
              {EXAMPLE_TOPICS.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleExampleClick(ex)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors duration-200 cursor-pointer"
                  role="listitem"
                  aria-label={`예시 주제: ${ex}`}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!topic.trim() || isGenerating}
            className="btn-cta w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm"
            aria-busy={isGenerating}
          >
            {isGenerating ? (
              <>
                <div
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                  aria-hidden="true"
                />
                <span>생성 중...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" aria-hidden="true" />
                <span>콘텐츠 생성하기</span>
              </>
            )}
          </button>
          <p className="text-center text-xs text-slate-400 -mt-2">
            Ctrl + Enter 로도 생성할 수 있어요
          </p>
        </div>

        {/* Result area */}
        {(isGenerating || result) && (
          <div className="border-t border-slate-100">
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="text-sm font-semibold text-slate-800">
                  {isGenerating ? "생성 중..." : "생성 완료"}
                </span>
              </div>
              {result && !isGenerating && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 cursor-pointer"
                  aria-label="클립보드에 복사"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                      <span className="text-emerald-600">복사됨</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      복사하기
                    </>
                  )}
                </button>
              )}
            </div>

            {isGenerating ? (
              <GeneratingSkeletons />
            ) : (
              result && (
                <div className="px-6 pb-6 fade-in">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <pre className="text-sm text-slate-800 whitespace-pre-wrap font-[inherit] leading-relaxed">
                      {result}
                    </pre>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}
