"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, Trash2, Search, ChevronDown, ChevronRight, Plus,
  MessageSquare, Star, Paperclip, Ban, Library, AlertCircle,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { CHANNELS, CHANNEL_LABELS, CHANNEL_COLORS, type ChannelKey } from "@/lib/channels";

// ── 정규화된 항목 (섹션이 공통으로 다룸) ──
interface Row { id: string; created_at: string; main: string; meta?: string | null; }

// API 응답 원본 타입
interface FeedbackRow { id: string; text: string; created_at: string; }
interface ExampleRow { id: string; content: string; note: string | null; created_at: string; }
interface BadRow { id: string; content: string; reason: string | null; created_at: string; }

const REF_NOTE = "직접 추가"; // 참고자료 구분용 note 값

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// ── 섹션(피드백/우수작/참고자료/기각 공통) ──
function Section({
  title, icon, tone, items, addPlaceholder, onAdd, onDelete, multiline,
}: {
  title: string; icon: React.ReactNode; tone: "amber" | "emerald" | "sky" | "red";
  items: Row[]; addPlaceholder: string;
  onAdd: (value: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  multiline: boolean;
}) {
  const [q, setQ] = useState("");
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toneMap = {
    amber: { chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "text-amber-500", btn: "bg-amber-500 hover:bg-amber-600", card: "bg-amber-50/40" },
    emerald: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "text-emerald-500", btn: "bg-emerald-500 hover:bg-emerald-600", card: "bg-emerald-50/40" },
    sky: { chip: "bg-sky-50 text-sky-700 border-sky-200", dot: "text-sky-500", btn: "bg-sky-500 hover:bg-sky-600", card: "bg-sky-50/40" },
    red: { chip: "bg-red-50 text-red-700 border-red-200", dot: "text-red-500", btn: "bg-red-500 hover:bg-red-600", card: "bg-red-50/40" },
  }[tone];

  const filtered = q.trim()
    ? items.filter(it => it.main.toLowerCase().includes(q.toLowerCase()) || (it.meta ?? "").toLowerCase().includes(q.toLowerCase()))
    : items;

  const submit = async () => {
    const v = val.trim();
    if (!v || adding) return;
    setAdding(true);
    try { await onAdd(v); setVal(""); } finally { setAdding(false); }
  };

  return (
    <section className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 flex items-center gap-2 border-b border-slate-100">
        <span className={toneMap.dot}>{icon}</span>
        <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${toneMap.chip}`}>{items.length}</span>
        {items.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 text-slate-400">
            <Search className="w-3.5 h-3.5" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색"
              className="text-xs bg-transparent border-none outline-none w-28 focus:w-40 transition-all" />
          </div>
        )}
      </div>

      {/* 추가 입력 */}
      <div className="px-5 py-3 border-b border-slate-100 flex items-start gap-2">
        {multiline ? (
          <textarea value={val} onChange={e => setVal(e.target.value)} rows={2} placeholder={addPlaceholder}
            className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-slate-400" />
        ) : (
          <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void submit(); }}
            placeholder={addPlaceholder}
            className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
        )}
        <button onClick={submit} disabled={!val.trim() || adding}
          className={`flex items-center gap-1 px-3 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-40 cursor-pointer whitespace-nowrap ${toneMap.btn}`}>
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}추가
        </button>
      </div>

      {/* 목록 */}
      <div className="divide-y divide-slate-50 max-h-[46vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-5 py-6 text-xs text-slate-400 text-center">{q.trim() ? "검색 결과 없음" : "항목이 없습니다."}</p>
        ) : filtered.map(it => {
          const isOpen = open.has(it.id);
          const long = it.main.length > 90;
          return (
            <div key={it.id} className={`px-5 py-2.5 flex items-start gap-3 ${toneMap.card}`}>
              <div className="flex-1 min-w-0">
                <p className={`text-sm text-slate-700 leading-relaxed ${isOpen ? "whitespace-pre-wrap" : "truncate"}`}>
                  {isOpen ? it.main : it.main.slice(0, 90)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-slate-400">{fmtDate(it.created_at)}</span>
                  {it.meta && <span className="text-[10px] text-slate-400">· {it.meta.slice(0, 60)}</span>}
                  {long && (
                    <button onClick={() => setOpen(s => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })}
                      className="text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer">
                      {isOpen ? "접기" : "전문 보기"}
                    </button>
                  )}
                </div>
              </div>
              <button onClick={() => void onDelete(it.id)} className="text-slate-300 hover:text-red-500 cursor-pointer shrink-0 mt-0.5" title="삭제">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function LearningPage() {
  const [channel, setChannel] = useState<ChannelKey>(CHANNELS[0]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [examples, setExamples] = useState<ExampleRow[]>([]);
  const [bad, setBad] = useState<BadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (ch: ChannelKey) => {
    setLoading(true); setErr(null);
    try {
      const [f, e, b] = await Promise.all([
        fetch(`/api/feedback?channel=${ch}`).then(r => r.json()),
        fetch(`/api/examples?channel=${ch}`).then(r => r.json()),
        fetch(`/api/bad-examples?channel=${ch}`).then(r => r.json()),
      ]);
      setFeedback(f.feedback ?? []); setExamples(e.examples ?? []); setBad(b.badExamples ?? []);
    } catch { setErr("학습 데이터를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(channel); }, [channel, load]);

  // examples → 우수작 / 참고자료 분리
  const winners: Row[] = examples.filter(e => e.note !== REF_NOTE).map(e => ({ id: e.id, created_at: e.created_at, main: e.content, meta: e.note }));
  const refs: Row[] = examples.filter(e => e.note === REF_NOTE).map(e => ({ id: e.id, created_at: e.created_at, main: e.content, meta: null }));
  const fbRows: Row[] = feedback.map(f => ({ id: f.id, created_at: f.created_at, main: f.text, meta: null }));
  const badRows: Row[] = bad.map(b => ({ id: b.id, created_at: b.created_at, main: b.content, meta: b.reason }));

  // ── add/delete 핸들러 (POST/DELETE 후 재로딩) ──
  const post = async (url: string, body: object) => {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load(channel);
  };
  const del = async (url: string, id: string, optimistic: () => void) => {
    optimistic();
    await fetch(`${url}?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />
      <main className="pt-28 pb-20 px-4">
        <div className="max-w-4xl mx-auto">
          {/* 헤더 */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Library className="w-6 h-6 text-blue-600" />자료실
            </h1>
            <p className="text-slate-500 text-sm mt-1">채널별 학습 데이터 — 피드백·우수작·참고자료·기각 사례를 보고·검색·추가·삭제 (다음 생성에 자동 반영)</p>
          </div>

          {/* 채널 선택 탭 */}
          <div className="flex gap-2 flex-wrap mb-5">
            {CHANNELS.map(ch => {
              const active = ch === channel;
              const { color, bgColor, borderColor } = CHANNEL_COLORS[ch];
              return (
                <button key={ch} onClick={() => setChannel(ch)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${active ? `${bgColor} ${color} ${borderColor}` : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"}`}>
                  {CHANNEL_LABELS[ch]}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">불러오는 중...</span>
            </div>
          ) : err ? (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />{err}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="피드백" tone="amber" icon={<MessageSquare className="w-4 h-4" />}
                items={fbRows} multiline={false} addPlaceholder="다음 생성에 반영할 피드백"
                onAdd={v => post("/api/feedback", { channel, text: v })}
                onDelete={id => del("/api/feedback", id, () => setFeedback(l => l.filter(x => x.id !== id)))} />
              <Section title="우수작 (퓨샷)" tone="emerald" icon={<Star className="w-4 h-4" />}
                items={winners} multiline addPlaceholder="우수작 예시 붙여넣기"
                onAdd={v => post("/api/examples", { channel, content: v })}
                onDelete={id => del("/api/examples", id, () => setExamples(l => l.filter(x => x.id !== id)))} />
              <Section title="직접 참고자료" tone="sky" icon={<Paperclip className="w-4 h-4" />}
                items={refs} multiline addPlaceholder="참고자료(퓨샷) 붙여넣기"
                onAdd={v => post("/api/examples", { channel, content: v, note: REF_NOTE })}
                onDelete={id => del("/api/examples", id, () => setExamples(l => l.filter(x => x.id !== id)))} />
              <Section title="기각 사례 (회피용)" tone="red" icon={<Ban className="w-4 h-4" />}
                items={badRows} multiline addPlaceholder="기각시킬 나쁜 예시 (사유는 자동)"
                onAdd={v => post("/api/bad-examples", { channel, content: v, reason: "수동 추가" })}
                onDelete={id => del("/api/bad-examples", id, () => setBad(l => l.filter(x => x.id !== id)))} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
