"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Copy, Check, Edit3, Save, Trash2, ChevronDown, ChevronRight,
  Loader2, AlertCircle, BookOpen, X, Sparkles, Download, Hash, FileCode, Images,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { CHANNEL_LABELS, CHANNEL_COLORS, CHANNELS, type ChannelKey } from "@/lib/channels";
import {
  copyToClipboard, htmlToText, splitHashtags, extractCards, downloadCardPng, downloadCardsZip,
} from "@/lib/resultDownload";

// ── 채널 아이콘 ──────────────────────────────────────────────
const CHANNEL_ICONS: Record<ChannelKey, React.ReactNode> = {
  "naver-blog": <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z" /></svg>,
  instagram: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>,
  facebook: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>,
  linkedin: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>,
  magazine: <BookOpen className="w-3.5 h-3.5" />,
};

// ── 타입 ────────────────────────────────────────────────────
interface ResultEntry {
  id: string;
  topic: string;
  createdAt: string;
  channels: Partial<Record<string, string>>;
}
interface DateGroup { label: string; results: ResultEntry[] }

// ── 날짜 그룹핑 ─────────────────────────────────────────────
function groupByDate(results: ResultEntry[]): DateGroup[] {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  const thisWeekStart = new Date(now.getTime() - 7 * 86400000);

  const groups: Record<string, ResultEntry[]> = {
    오늘: [],
    어제: [],
    "이번 주": [],
    이전: [],
  };

  for (const r of results) {
    const d = new Date(r.createdAt);
    const ds = d.toDateString();
    if (ds === today) groups["오늘"].push(r);
    else if (ds === yesterday) groups["어제"].push(r);
    else if (d >= thisWeekStart) groups["이번 주"].push(r);
    else groups["이전"].push(r);
  }

  return Object.entries(groups)
    .filter(([, rs]) => rs.length > 0)
    .map(([label, rs]) => ({ label, results: rs }));
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

// 작은 복사 버튼
function CopyBtn({ active, onClick, icon, label }: { active: boolean; onClick(): void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">
      {active ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-600">복사됨</span></> : <>{icon}{label}</>}
    </button>
  );
}

// ── 채널 콘텐츠 편집기 + 게시 보조 ─────────────────────────
function ChannelEditor({ resultId, channel, initialContent, allCards, onSaved }: {
  resultId: string; channel: string; initialContent: string; allCards: string[]; onSaved(content: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialContent);
  const [saved, setSaved] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isDirty = text !== saved;

  const ch = channel as ChannelKey;
  const { color, bgColor, borderColor } = CHANNEL_COLORS[ch] ?? { color: "", bgColor: "bg-slate-50", borderColor: "border-slate-200" };

  const isMagazine = channel === "magazine";
  const isNaver = channel === "naver-blog";
  const isSocial = channel === "instagram" || channel === "facebook" || channel === "linkedin";
  const tags = splitHashtags(text).tags;
  const showImages = (isNaver || isSocial) && allCards.length > 0;

  const flash = (label: string) => { setCopiedLabel(label); setTimeout(() => setCopiedLabel(null), 1800); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/results/${resultId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: { [channel]: text } }),
      });
      if (!r.ok) throw new Error();
      setSaved(text);
      onSaved(text);
      setEditing(false);
    } catch { /* keep editing */ } finally { setSaving(false); }
  };

  const doCopy = async (content: string, label: string) => {
    try { await copyToClipboard(content); flash(label); } catch { /* noop */ }
  };

  const runBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch { alert("이미지 생성 중 오류가 발생했습니다."); } finally { setBusy(null); }
  };

  return (
    <div className={`rounded-2xl border overflow-hidden ${borderColor}`}>
      {/* 채널 헤더 + 복사 버튼 */}
      <div className={`px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 ${bgColor} border-b ${borderColor}`}>
        <div className={`flex items-center gap-2 font-semibold text-sm ${color}`}>
          {CHANNEL_ICONS[ch]}
          <span className="text-slate-800">{CHANNEL_LABELS[ch] ?? channel}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isMagazine && (
            <CopyBtn active={copiedLabel === "html"} onClick={() => doCopy(text, "html")} icon={<FileCode className="w-3 h-3" />} label="HTML 복사" />
          )}
          {isNaver && (
            <CopyBtn active={copiedLabel === "text"} onClick={() => doCopy(htmlToText(text), "text")} icon={<Copy className="w-3 h-3" />} label="텍스트 복사" />
          )}
          {isSocial && (
            <>
              <CopyBtn active={copiedLabel === "caption"} onClick={() => doCopy(splitHashtags(text).body, "caption")} icon={<Copy className="w-3 h-3" />} label="캡션 복사" />
              {tags && (
                <CopyBtn active={copiedLabel === "tags"} onClick={() => doCopy(tags, "tags")} icon={<Hash className="w-3 h-3" />} label="해시태그 복사" />
              )}
            </>
          )}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">
              <Edit3 className="w-3 h-3" />수정
            </button>
          ) : (
            <>
              <button onClick={() => { setText(saved); setEditing(false); }} className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-50 cursor-pointer">
                취소
              </button>
              <button onClick={handleSave} disabled={saving || !isDirty}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {saving ? "저장 중" : "저장"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 게시 안내 */}
      <div className="px-4 pt-2 text-[11px] text-slate-400">
        {isMagazine && "HTML 복사 → 홈페이지 편집기에 붙여넣기 (텍스트·이미지 한 번에 완성)"}
        {isNaver && "텍스트 복사 → 본문에 붙여넣기 + 아래 이미지 카드를 사진으로 첨부"}
        {isSocial && "캡션·해시태그 복사 → 글/첫 댓글에 붙여넣기 + 아래 이미지 다운로드해 업로드"}
      </div>

      {/* 콘텐츠 */}
      <div className="bg-white">
        {editing ? (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            className="w-full p-4 text-sm text-slate-800 font-[inherit] leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 min-h-[200px]"
            autoFocus
          />
        ) : text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html") ? (
          <iframe
            srcDoc={text}
            title="미리보기"
            className="w-full"
            style={{ height: "500px", border: "none" }}
            sandbox="allow-same-origin"
          />
        ) : (
          <pre className="p-4 text-sm text-slate-700 whitespace-pre-wrap font-[inherit] leading-relaxed">{isNaver ? htmlToText(text) : text}</pre>
        )}
        {isDirty && editing && (
          <div className="px-4 pb-2 text-[10px] text-amber-600 font-medium">미저장 변경사항 있음</div>
        )}
      </div>

      {/* 이미지 카드 (네이버 / 인스타 / 페북 / 링크드인) */}
      {showImages && (
        <div className="border-t border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Images className="w-3.5 h-3.5" />이미지 카드 {allCards.length}장
            </div>
            <button
              onClick={() => runBusy("zip", () => downloadCardsZip(allCards, channel))}
              disabled={busy !== null}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50 cursor-pointer">
              {busy === "zip" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {busy === "zip" ? "생성 중" : "전체 ZIP"}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {allCards.map((card, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="h-[110px] overflow-hidden bg-white border-b border-slate-100">
                  <div style={{ width: 640, transform: "scale(0.28)", transformOrigin: "top left", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: card }} />
                </div>
                <button
                  onClick={() => runBusy(`img${i}`, () => downloadCardPng(card, `${channel}_${String(i + 1).padStart(2, "0")}.png`))}
                  disabled={busy !== null}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
                  {busy === `img${i}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  {String(i + 1).padStart(2, "0")} 다운로드
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 결과 카드 ──────────────────────────────────────────────
function ResultCard({ result, onDelete }: {
  result: ResultEntry;
  onDelete(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [channels, setChannels] = useState(result.channels);
  const [deleting, setDeleting] = useState(false);
  const channelKeys = Object.keys(channels);

  // 이미지 카드(공용): 네이버블로그 콘텐츠의 카드를 우선 사용, 없으면 카드가 있는 첫 채널
  const sharedCards = useMemo(() => {
    const naver = channels["naver-blog"];
    if (naver) { const c = extractCards(naver); if (c.length) return c; }
    for (const v of Object.values(channels)) { const c = extractCards(v || ""); if (c.length) return c; }
    return [];
  }, [channels]);

  const handleDelete = async () => {
    if (!confirm("이 결과물을 삭제하시겠습니까?")) return;
    setDeleting(true);
    try {
      await fetch(`/api/results/${result.id}`, { method: "DELETE" });
      onDelete(result.id);
    } catch { setDeleting(false); }
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* 카드 헤더 */}
      <div
        className="px-5 py-4 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors select-none"
        onClick={() => setOpen(v => !v)}
      >
        <div className="text-slate-400 shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{result.topic}</p>
          <p className="text-xs text-slate-400 mt-0.5">{fmtDate(result.createdAt)} · {fmtTime(result.createdAt)}</p>
        </div>
        {/* 채널 뱃지 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {channelKeys.map(ch => {
            const { color, bgColor } = CHANNEL_COLORS[ch as ChannelKey] ?? { color: "text-slate-600", bgColor: "bg-slate-100" };
            return (
              <span key={ch} className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold ${bgColor} ${color}`}>
                {CHANNEL_ICONS[ch as ChannelKey]}
                <span className="hidden sm:inline">{CHANNEL_LABELS[ch as ChannelKey] ?? ch}</span>
              </span>
            );
          })}
        </div>
        {/* 삭제 */}
        <button
          onClick={e => { e.stopPropagation(); void handleDelete(); }}
          disabled={deleting}
          className="p-1.5 text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0"
          title="삭제"
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>

      {/* 채널 탭 + 콘텐츠 */}
      {open && (
        <div className="border-t border-slate-100">
          {/* 채널 탭 */}
          <div className="px-5 pt-3 pb-0 flex gap-2 flex-wrap">
            {channelKeys.map(ch => {
              const isActive = activeChannel === ch;
              const { color, bgColor, borderColor } = CHANNEL_COLORS[ch as ChannelKey] ?? { color: "text-slate-600", bgColor: "bg-slate-100", borderColor: "border-slate-200" };
              return (
                <button
                  key={ch}
                  onClick={() => setActiveChannel(isActive ? null : ch)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    isActive ? `${bgColor} ${color} ${borderColor}` : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {CHANNEL_ICONS[ch as ChannelKey]}
                  {CHANNEL_LABELS[ch as ChannelKey] ?? ch}
                </button>
              );
            })}
            {activeChannel && (
              <button onClick={() => setActiveChannel(null)} className="ml-auto p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 선택된 채널 에디터 */}
          {activeChannel && channels[activeChannel] !== undefined && (
            <div className="p-4 pt-3">
              <ChannelEditor
                key={activeChannel}
                resultId={result.id}
                channel={activeChannel}
                initialContent={channels[activeChannel]!}
                allCards={sharedCards}
                onSaved={newContent => setChannels(prev => ({ ...prev, [activeChannel]: newContent }))}
              />
            </div>
          )}
          {!activeChannel && (
            <p className="px-5 py-4 text-xs text-slate-400">채널을 선택하면 콘텐츠를 확인하고 수정할 수 있습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ─────────────────────────────────────────────
export default function ResultsPage() {
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/results");
      const d = await r.json();
      setResults(d.results ?? []);
    } catch { setErr("결과물을 불러오지 못했습니다."); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = (id: string) => setResults(prev => prev.filter(r => r.id !== id));

  const groups = groupByDate(results);

  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />
      <main className="pt-28 pb-20 px-4">
        <div className="max-w-4xl mx-auto">

          {/* 헤더 */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-blue-600" />
                생성 결과물
              </h1>
              <p className="text-slate-500 text-sm mt-1">생성된 콘텐츠를 날짜별로 확인하고 수정하세요</p>
            </div>
            <a
              href="/"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer"
            >
              + 새 콘텐츠 생성
            </a>
          </div>

          {/* 상태 */}
          {loading && (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">불러오는 중...</span>
            </div>
          )}
          {err && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />{err}
            </div>
          )}

          {/* 결과 없음 */}
          {!loading && !err && results.length === 0 && (
            <div className="text-center py-24">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-blue-400" />
              </div>
              <p className="font-semibold text-slate-700 mb-2">아직 생성된 결과물이 없습니다</p>
              <p className="text-sm text-slate-400 mb-6">콘텐츠 생성 페이지에서 주제를 입력하고 생성해보세요</p>
              <a href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer">
                콘텐츠 생성하러 가기
              </a>
            </div>
          )}

          {/* 날짜별 그룹 */}
          {!loading && groups.map(group => (
            <section key={group.label} className="mb-8">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{group.label}</h2>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400">{group.results.length}건</span>
              </div>
              <div className="space-y-3">
                {group.results.map(result => (
                  <ResultCard key={result.id} result={result} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
