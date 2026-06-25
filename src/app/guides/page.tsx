import { BookOpen, ArrowLeft, ChevronRight } from "lucide-react";
import { CHANNELS, CHANNEL_LABELS, CHANNEL_COLORS, CHANNEL_DESCRIPTIONS, type ChannelKey } from "@/lib/channels";
import Navbar from "@/components/Navbar";
import Link from "next/link";

const CHANNEL_ICONS_SVG: Record<ChannelKey, string> = {
  "naver-blog": "N",
  instagram: "IG",
  facebook: "f",
  linkedin: "in",
  magazine: "M",
};

export default function GuidesPage() {
  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20 px-4">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors duration-200 mb-6 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            콘텐츠 생성기로 돌아가기
          </Link>

          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-5 h-5 text-blue-600" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-slate-900">채널별 가이드 관리</h1>
            </div>
            <p className="text-slate-500 text-sm">
              각 채널의 가이드를 수정하면 다음 콘텐츠 생성부터 즉시 반영됩니다.
              <br />가이드 파일은{" "}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-slate-700">
                data/channels/[채널]/
              </code>{" "}
              폴더에 Markdown 형식으로 저장됩니다.
            </p>
          </div>

          <div className="space-y-3" role="list" aria-label="채널 가이드 목록">
            {CHANNELS.map((channel) => {
              const { color, bgColor } = CHANNEL_COLORS[channel];
              return (
                <Link
                  key={channel}
                  href={`/guides/${channel}`}
                  className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between hover:shadow-md transition-all duration-200 cursor-pointer group"
                  role="listitem"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl ${bgColor} flex items-center justify-center ${color} shrink-0 font-bold text-sm`}>
                      {CHANNEL_ICONS_SVG[channel]}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{CHANNEL_LABELS[channel]}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{CHANNEL_DESCRIPTIONS[channel]}</div>
                    </div>
                  </div>
                  <ChevronRight
                    className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all duration-200"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>

          <div className="mt-8 bg-blue-50 border border-blue-100 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-blue-900 mb-2">가이드 수정 방법</h2>
            <ol className="text-sm text-blue-800 space-y-1.5 list-decimal list-inside">
              <li>수정할 채널 클릭</li>
              <li>왼쪽 편집 창에서 내용 수정 (Markdown 형식)</li>
              <li>오른쪽 미리보기로 결과 확인</li>
              <li>저장 버튼 클릭 → 즉시 반영</li>
            </ol>
          </div>
        </div>
      </main>
    </div>
  );
}
