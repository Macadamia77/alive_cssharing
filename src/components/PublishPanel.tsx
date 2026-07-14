"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Send, Download, Images, X, Loader2 } from "lucide-react";
import { copyToClipboard, extractCards, htmlToText, downloadCardsZip, downloadPngUrlsZip, downloadSvgUrlsZip } from "@/lib/resultDownload";
import type { CardAsset } from "@/lib/pipeline/cardStorage";

// 생성 직후 미리보기(ChannelResultCard)와 결과물 탭(results/page.tsx)이 동일한 "발행 준비"
// 버튼·패널을 쓰도록 공통화한 컴포넌트. 두 화면 모두 네이버 블로그 채널 한정으로 노출한다.

export function PublishToggleButton({ show, onToggle }: { show: boolean; onToggle(): void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-700 font-medium hover:bg-blue-100 hover:border-blue-300 transition-all duration-200 cursor-pointer"
      aria-expanded={show}
      title="텍스트와 이미지를 따로 받아 네이버 블로그에 붙여넣기"
    >
      <Send className="w-3 h-3" aria-hidden="true" />발행 준비
    </button>
  );
}

export default function PublishPanel({ channel, content, cardAssets, onClose }: {
  channel: string; content: string; cardAssets?: CardAsset[]; onClose(): void;
}) {
  const [textCopied, setTextCopied] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);

  // 네이버 블로그 HTML에서 이미지 카드(<figure>)만 따로 추출 — ZIP 다운로드용.
  const cards = useMemo(() => extractCards(content), [content]);
  // 이미지 생성 단계에서 실제 캡처한 PNG(cardAssets)가 있으면 그걸 우선 쓰고, 없으면 html2canvas로 근사 렌더.
  const hasCapturedPng = !!cardAssets && cardAssets.length === cards.length && cards.length > 0;

  const handleCopyText = async () => {
    try {
      await copyToClipboard(htmlToText(content));
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    } catch { /* noop */ }
  };

  const handleDownloadZip = async (format: "png" | "svg") => {
    if (cards.length === 0 || zipBusy) return;
    setZipBusy(true);
    try {
      if (format === "svg") {
        if (!hasCapturedPng) throw new Error("SVG 원본이 없습니다(캡처 전이거나 구버전 결과물).");
        await downloadSvgUrlsZip(cardAssets!.map(c => c.svgUrl), channel);
      } else if (hasCapturedPng) {
        await downloadPngUrlsZip(cardAssets!.map(c => c.pngUrl), channel);
      } else {
        await downloadCardsZip(cards, channel);
      }
    } catch {
      alert("이미지 다운로드 중 오류가 발생했습니다.");
    } finally {
      setZipBusy(false);
    }
  };

  return (
    <div className="px-5 py-3 border-b border-blue-100 bg-blue-50/50 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
          <Images className="w-3.5 h-3.5" aria-hidden="true" />네이버 블로그로 내보내기
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 cursor-pointer"
          aria-label="발행 준비 패널 닫기"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">① 본문 텍스트 복사</p>
          <p className="text-[10px] text-slate-400">이미지 태그를 뺀 순수 텍스트만</p>
        </div>
        <button
          onClick={handleCopyText}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 transition-all duration-200 cursor-pointer shrink-0"
        >
          {textCopied ? (
            <><Check className="w-3 h-3 text-emerald-500" aria-hidden="true" />복사됨</>
          ) : (
            <><Copy className="w-3 h-3" aria-hidden="true" />복사</>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">② 이미지 카드 {cards.length}개 받기</p>
          <p className="text-[10px] text-slate-400">
            PNG(본문 삽입용){hasCapturedPng ? " 또는 SVG(Figma/일러스트레이터 편집용)" : "로 렌더링해"} ZIP으로 다운로드
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => handleDownloadZip("png")}
            disabled={cards.length === 0 || zipBusy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
          >
            {zipBusy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Download className="w-3 h-3" aria-hidden="true" />}
            PNG
          </button>
          {hasCapturedPng && (
            <button
              onClick={() => handleDownloadZip("svg")}
              disabled={cards.length === 0 || zipBusy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              title="Figma/일러스트레이터 편집용 원본 벡터"
            >
              SVG
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        💡 복사한 텍스트를 네이버 에디터에 붙여넣고, 받은 이미지를 <span className="font-medium text-slate-500">[IMAGE]</span> 자리에 순서대로 삽입하세요.
      </p>
    </div>
  );
}
