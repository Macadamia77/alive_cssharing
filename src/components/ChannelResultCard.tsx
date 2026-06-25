"use client";

import { useState } from "react";
import { Copy, Check, BookOpen } from "lucide-react";
import { type ChannelKey, CHANNEL_LABELS, CHANNEL_COLORS } from "@/lib/channels";

export type { ChannelKey };

// SVG icons (JSX — client-only)
const CHANNEL_ICONS: Record<ChannelKey, React.ReactNode> = {
  "naver-blog": (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
      <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  ),
  magazine: <BookOpen className="w-5 h-5" aria-hidden="true" />,
};

type Status = "idle" | "loading" | "done" | "error";

interface Props {
  channel: ChannelKey;
  status: Status;
  content?: string;
}

function SkeletonBlock() {
  return (
    <div className="space-y-2.5 p-4" aria-hidden="true">
      {[80, 100, 90, 100, 70, 100, 85].map((w, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export default function ChannelResultCard({ channel, status, content }: Props) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { color, bgColor, borderColor } = CHANNEL_COLORS[channel];
  const label = CHANNEL_LABELS[channel];
  const icon = CHANNEL_ICONS[channel];

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const preview = content ? content.slice(0, 300) : "";
  const hasMore = content ? content.length > 300 : false;

  return (
    <article
      className={`glass-card rounded-2xl overflow-hidden border ${borderColor} transition-shadow duration-300 hover:shadow-md`}
      aria-label={`${label} 콘텐츠`}
    >
      {/* Header */}
      <div className={`px-5 py-3.5 flex items-center justify-between border-b ${borderColor} ${bgColor}`}>
        <div className="flex items-center gap-2.5">
          <span className={color}>{icon}</span>
          <span className="font-semibold text-slate-800 text-sm">{label}</span>
        </div>

        <div className="flex items-center gap-2">
          {status === "loading" && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" aria-hidden="true" />
              생성 중
            </span>
          )}
          {status === "done" && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              완료
            </span>
          )}
          {status === "done" && content && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 cursor-pointer"
              aria-label={`${label} 콘텐츠 복사`}
            >
              {copied ? (
                <><Check className="w-3 h-3 text-emerald-500" aria-hidden="true" /><span className="text-emerald-600">복사됨</span></>
              ) : (
                <><Copy className="w-3 h-3" aria-hidden="true" />복사</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {status === "idle" && (
          <div className="text-center py-8 text-slate-400">
            <div className={`w-10 h-10 rounded-xl ${bgColor} flex items-center justify-center mx-auto mb-3 ${color}`}>
              {icon}
            </div>
            <p className="text-sm">생성 버튼을 누르면 콘텐츠가 나타납니다</p>
          </div>
        )}
        {status === "loading" && <SkeletonBlock />}
        {status === "error" && (
          <div className="text-center py-6 text-red-500 text-sm">
            콘텐츠 생성에 실패했습니다. 다시 시도해주세요.
          </div>
        )}
        {status === "done" && content && (
          <div className="fade-in">
            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-[inherit] leading-relaxed">
              {expanded ? content : preview}
            </pre>
            {hasMore && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer transition-colors duration-200"
                aria-expanded={expanded}
              >
                {expanded ? "접기 ▲" : "전체 보기 ▼"}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
