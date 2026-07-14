"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, ChevronRight } from "lucide-react";
import { type ChannelKey, CHANNEL_LABELS } from "@/lib/channels";

type TraceEvt = { id: string; seq: number; stage: string; kind: string | null; phase: string; data: Record<string, unknown> };
type Tab = { key: string; label: string; taskId?: string; runId?: string };

// 생성 과정 트레이스 뷰어 — 채널 탭 + "공통(shared)" 탭, 각 탭에 세로 단계 타임라인.
// 요약은 폴링(생성 중), 프롬프트/산출물 전문은 "상세"를 눌렀을 때 1회 lazy fetch.
export default function TraceViewer({ channels, runId, generating }: {
  channels: { channel: ChannelKey; taskId?: string }[];
  runId: string | null;
  generating: boolean;
}) {
  const tabs: Tab[] = [
    ...channels.map(c => ({ key: c.channel as string, label: CHANNEL_LABELS[c.channel] ?? c.channel, taskId: c.taskId })),
    ...(runId ? [{ key: "shared", label: "공통(리서치·뼈대)", runId }] : []),
  ];
  const [active, setActive] = useState<string>(tabs[0]?.key ?? "");
  const [events, setEvents] = useState<TraceEvt[]>([]);
  const [detail, setDetail] = useState<Record<string, { loading: boolean; prompt?: string; output?: string }>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeTab = tabs.find(t => t.key === active) ?? tabs[0];
  const qs = activeTab?.taskId ? `taskId=${activeTab.taskId}` : activeTab?.runId ? `runId=${activeTab.runId}` : "";

  const fetchList = useCallback(async () => {
    if (!qs) { setEvents([]); return; }
    try {
      const r = await fetch(`/api/generate/trace?${qs}`);
      const d = await r.json();
      if (r.ok) setEvents(Array.isArray(d.events) ? d.events : []);
    } catch { /* fail-soft: 트레이스 조회 실패는 생성/화면에 영향 없음 */ }
  }, [qs]);

  useEffect(() => {
    setDetail({});
    void fetchList();
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (generating) pollRef.current = setInterval(() => void fetchList(), 2000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [qs, generating, fetchList]);

  const toggleDetail = async (ev: TraceEvt) => {
    if (detail[ev.id]) { setDetail(p => { const n = { ...p }; delete n[ev.id]; return n; }); return; }
    if (!ev.data.hasPrompt && !ev.data.hasOutput) return;
    setDetail(p => ({ ...p, [ev.id]: { loading: true } }));
    try {
      const r = await fetch(`/api/generate/trace?eventId=${ev.id}`);
      const d = await r.json();
      const dd = (d.event?.data ?? {}) as Record<string, unknown>;
      setDetail(p => ({ ...p, [ev.id]: { loading: false, prompt: dd.prompt as string, output: dd.output as string } }));
    } catch { setDetail(p => ({ ...p, [ev.id]: { loading: false, output: "(불러오기 실패)" } })); }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {/* 채널 탭 */}
      <div className="flex flex-wrap gap-1 border-b border-slate-100 px-2 pt-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActive(t.key)}
            className={`px-2.5 py-1 rounded-t-lg text-[11px] font-semibold cursor-pointer ${active === t.key ? "bg-blue-50 text-blue-700 border border-blue-100 border-b-white -mb-px" : "text-slate-400 hover:text-slate-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 타임라인 */}
      <div className="p-3 space-y-1.5">
        {events.length === 0 && <p className="text-[11px] text-slate-400 py-2">{generating ? "진행 대기 중…" : "이 탭의 트레이스가 없습니다."}</p>}
        {events.map(ev => {
          const d = ev.data as Record<string, unknown>;
          const guides = Array.isArray(d.guides) ? (d.guides as string[]) : [];
          const hasDetail = !!d.hasPrompt || !!d.hasOutput;
          const open = detail[ev.id];
          return (
            <div key={ev.id} className="rounded-lg border border-slate-100 bg-slate-50/40 px-2.5 py-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-blue-700">{ev.stage}</span>
                {ev.kind && <span className="text-[9px] px-1 rounded bg-slate-200 text-slate-500">{ev.kind}</span>}
                {ev.phase === "verdict" && <span className={`text-[9px] px-1 rounded ${d.rejected ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600"}`}>{d.rejected ? `반려(${String(d.attempt)}차)` : "통과"}</span>}
                {typeof d.provider === "string" && <span className="text-[10px] text-slate-400">{String(d.provider)}/{String(d.model)}</span>}
                {hasDetail && (
                  <button onClick={() => void toggleDetail(ev)} className="ml-auto flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-blue-600 cursor-pointer">
                    상세<ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>
                )}
              </div>

              {/* 컨텍스트 주입 요약 */}
              {ev.phase === "context" && (
                <p className="text-[10px] text-slate-500 mt-1">
                  피드백 {String(d.feedback ?? 0)} · 퓨샷 {String(d.examples ?? 0)} · 기각 {String(d.bad ?? 0)} · 누적 {String(d.accumulated ?? 0)} · shared {d.sharedContext ? "O" : "X"}
                  {Array.isArray(d.stages) && <span className="block text-slate-400">단계: {(d.stages as string[]).join(" → ")}</span>}
                </p>
              )}

              {/* 주입된 가이드(순서 그대로) */}
              {guides.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {guides.map((g, i) => <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-white border border-slate-200 text-slate-500">{i + 1}. {g}</span>)}
                </div>
              )}

              {/* 산출물 미리보기 */}
              {typeof d.outputPreview === "string" && !open && (
                <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{String(d.outputPreview)}{d.chars ? ` (${String(d.chars)}자)` : ""}</p>
              )}

              {/* 상세(프롬프트 전문 + 산출물) — lazy */}
              {open && (
                <div className="mt-1.5 space-y-1.5">
                  {open.loading ? <div className="flex items-center gap-1 text-[10px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" />불러오는 중…</div> : (
                    <>
                      {open.prompt && <div><p className="text-[9px] font-semibold text-slate-400">프롬프트</p><pre className="whitespace-pre-wrap break-words text-[10px] text-slate-600 bg-white border border-slate-100 rounded p-1.5 max-h-60 overflow-auto m-0 font-sans">{open.prompt}</pre></div>}
                      {open.output && <div><p className="text-[9px] font-semibold text-slate-400">산출물</p><pre className="whitespace-pre-wrap break-words text-[10px] text-slate-600 bg-white border border-slate-100 rounded p-1.5 max-h-60 overflow-auto m-0 font-sans">{open.output}</pre></div>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
