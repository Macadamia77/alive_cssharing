"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, CheckCircle, AlertCircle, Zap, Search, Users, ChevronDown, ChevronRight, Layers,
} from "lucide-react";
import { type ChannelKey } from "@/lib/channels";

// ─── 타입 (API 응답) ────────────────────────────────────────
interface StageDef {
  id: string;
  scope: "shared" | "channel";
  persona?: string;
  roles?: string[];
  maxTokens?: number;
  useSearch?: boolean;
  skipIf?: string;
  enabled?: boolean; // 전역 기본 (undefined = true)
}
interface StageOverride {
  enabled?: boolean;
  maxTokens?: number;
  roles?: string[];
  guides?: string[];
}
interface Meta {
  engine?: "pipeline" | "legacy";
  outputFormat?: string;
  pipeline?: Record<string, StageOverride>;
}
interface GuideInfo { path: string; stages: string[]; }

// ─── 단계별 한글 라벨/설명 ──────────────────────────────────
const STAGE_INFO: Record<string, { label: string; desc: string }> = {
  "research":       { label: "웹서치 · 전문 정보", desc: "통계·사례·전문 자료를 웹에서 수집" },
  "research-voice": { label: "웹서치 · 현장 목소리", desc: "직장인·CS담당자의 실제 경험·고민을 웹에서 수집" },
  "brainstorm":     { label: "기획", desc: "주제 후보 발산 → 최적 주제 선정 (초안 있으면 자동 생략)" },
  "research-deep":  { label: "심화 리서치", desc: "확정 주제로 통계·사례·출처 심층 수집" },
  "skeleton":       { label: "뼈대 설계", desc: "채널 무관 논리 구조·섹션 설계" },
  "writer":         { label: "글쓰기", desc: "채널 톤으로 본문 작성 (필수)" },
  "content-review": { label: "내용/규칙 검수", desc: "규칙 위반·출처·경쟁사 검수 → 반려 시 재작성" },
  "tone-review":    { label: "AI 톤 검수", desc: "금칙어·기계적 표현 검수 → 반려 시 재작성" },
  "image-gen":      { label: "이미지 생성", desc: "썸네일·시각화 카드 생성" },
  "image-review":   { label: "이미지 검수", desc: "텍스트 잘림·가독성 검수" },
};

export default function PipelineToggles({ channel }: { channel: ChannelKey }) {
  const [stages, setStages] = useState<StageDef[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [guides, setGuides] = useState<GuideInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null); // 조각 패널 펼친 단계
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/channels/${channel}`);
      const d = await r.json();
      setStages(d.pipelineStages ?? []);
      setMeta(d.meta ?? {});
      setGuides(d.guides ?? []);
    } catch { /* noop */ } finally { setLoading(false); }
  }, [channel]);

  useEffect(() => { void reload(); }, [reload]);

  const engineOn = meta?.engine === "pipeline";

  const effectiveEnabled = (s: StageDef): boolean =>
    meta?.pipeline?.[s.id]?.enabled ?? s.enabled ?? true;

  // 단계에 실제 배정된 조각 경로 목록:
  // ① _meta.pipeline[단계].guides(명시) → ② frontmatter stages 태그(기본, writer는 태그없는 것도)
  const assignedGuides = (s: StageDef): string[] => {
    const ov = meta?.pipeline?.[s.id]?.guides;
    if (ov !== undefined) return ov;
    return guides
      .filter(g => g.stages.includes(s.id) || (s.id === "writer" && g.stages.length === 0))
      .map(g => g.path);
  };

  const save = async (body: Record<string, unknown>, key: string) => {
    setSaving(key); setStatus("idle");
    try {
      const r = await fetch(`/api/channels/${channel}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (d.meta) setMeta(d.meta); else await reload();
      setStatus("ok"); setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("err");
      await reload();
    } finally { setSaving(null); }
  };

  const toggleEngine = () => save({ engine: engineOn ? "legacy" : "pipeline" }, "engine");

  const toggleStage = (s: StageDef) => {
    if (s.id === "writer") return;
    const next = !effectiveEnabled(s);
    setMeta(m => m ? { ...m, pipeline: { ...(m.pipeline ?? {}), [s.id]: { ...(m.pipeline?.[s.id] ?? {}), enabled: next } } } : m);
    void save({ pipeline: { [s.id]: { enabled: next } } }, s.id);
  };

  const toggleGuide = (s: StageDef, path: string) => {
    const cur = assignedGuides(s);
    const next = cur.includes(path) ? cur.filter(p => p !== path) : [...cur, path];
    setMeta(m => m ? { ...m, pipeline: { ...(m.pipeline ?? {}), [s.id]: { ...(m.pipeline?.[s.id] ?? {}), guides: next } } } : m);
    void save({ pipeline: { [s.id]: { guides: next } } }, `${s.id}-guides`);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto glass-card rounded-2xl p-4 mb-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> 파이프라인 설정 불러오는 중...
      </div>
    );
  }

  const activeCount = stages.filter(s => effectiveEnabled(s)).length;

  return (
    <div className="max-w-7xl mx-auto glass-card rounded-2xl mb-4 overflow-hidden">
      {/* 헤더 */}
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/50 cursor-pointer text-left">
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        <Zap className={`w-4 h-4 shrink-0 ${engineOn ? "text-blue-500" : "text-slate-300"}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">생성 파이프라인</p>
          <p className="text-xs text-slate-400">
            {engineOn ? `통합 엔진 사용 중 · 활성 단계 ${activeCount}개` : "기존 방식(단일 생성) 사용 중"}
          </p>
        </div>
        {status === "ok" && <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
        {status === "err" && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
        <span
          role="switch" aria-checked={engineOn}
          onClick={e => { e.stopPropagation(); void toggleEngine(); }}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${engineOn ? "bg-blue-600" : "bg-slate-300"}`}>
          {saving === "engine"
            ? <Loader2 className="w-3 h-3 animate-spin text-white mx-auto" />
            : <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${engineOn ? "translate-x-6" : "translate-x-1"}`} />}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4">
          {!engineOn ? (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-3 leading-relaxed">
              이 채널은 <b>기존 단일 생성 방식</b>을 씁니다. 위 스위치를 켜면 아래 단계들을 조합하는
              <b> 통합 파이프라인 엔진</b>으로 전환됩니다.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                {stages.map(s => {
                  const on = effectiveEnabled(s);
                  const isWriter = s.id === "writer";
                  const info = STAGE_INFO[s.id] ?? { label: s.id, desc: "" };
                  const assigned = assignedGuides(s);
                  const isExpanded = expanded === s.id;
                  return (
                    <div key={s.id}
                      className={`rounded-xl border transition-colors ${on ? "border-blue-100 bg-blue-50/40" : "border-slate-100 bg-slate-50/40"}`}>
                      {/* 단계 행 */}
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <span
                          role="switch" aria-checked={on}
                          onClick={() => toggleStage(s)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${isWriter ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${on ? "bg-blue-600" : "bg-slate-300"}`}
                          title={isWriter ? "글쓰기 단계는 필수라 끌 수 없습니다" : undefined}>
                          {saving === s.id
                            ? <Loader2 className="w-2.5 h-2.5 animate-spin text-white mx-auto" />
                            : <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-800">{info.label}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.scope === "shared" ? "bg-purple-50 text-purple-600 border border-purple-200" : "bg-sky-50 text-sky-600 border border-sky-200"}`}>
                              {s.scope === "shared" ? "공통 1회" : "채널별"}
                            </span>
                            {s.useSearch && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-medium flex items-center gap-0.5"><Search className="w-2.5 h-2.5" />웹검색</span>}
                            {s.skipIf === "draftProvided" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">초안 시 생략</span>}
                            {isWriter && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">필수</span>}
                          </div>
                          {info.desc && <p className="text-xs text-slate-400 mt-0.5 truncate">{info.desc}</p>}
                        </div>
                        {/* 조각 배정 펼치기 */}
                        <button
                          onClick={() => setExpanded(isExpanded ? null : s.id)}
                          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-600 cursor-pointer shrink-0 px-1.5 py-1 rounded-lg hover:bg-white transition-colors"
                          title="이 단계에 붙일 규칙 조각 선택">
                          <Layers className="w-3 h-3" />
                          조각 {assigned.length}
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      </div>

                      {/* 조각 배정 패널 */}
                      {isExpanded && (
                        <div className="px-3 pb-2.5 pt-0.5 ml-12 border-t border-slate-100/70">
                          <p className="text-[10px] text-slate-400 mt-2 mb-1.5">이 단계(에이전트)에 주입할 규칙 조각</p>
                          {guides.length === 0 ? (
                            <p className="text-xs text-slate-400">이 채널에 조각 파일이 없습니다. (가이드 관리에서 파일 추가)</p>
                          ) : (
                            <div className="space-y-1">
                              {guides.map(g => {
                                const checked = assigned.includes(g.path);
                                return (
                                  <label key={g.path} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer py-0.5">
                                    <input
                                      type="checkbox" checked={checked}
                                      onChange={() => toggleGuide(s, g.path)}
                                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                    <span className={checked ? "font-medium text-slate-800" : ""}>{g.path}</span>
                                    {g.stages.length > 0 && <span className="text-[10px] text-slate-400">태그:{g.stages.join(",")}</span>}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {saving === `${s.id}-guides` && <p className="text-[10px] text-blue-500 mt-1 flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />저장 중...</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400 leading-relaxed">
                <Users className="w-3 h-3 shrink-0 mt-0.5" />
                <p>
                  <b className="text-purple-500">공통 1회</b>=주제당 한 번(전 채널 공급), <b className="text-sky-500">채널별</b>=이 채널에서 실행,
                  <b className="text-amber-500"> 웹검색</b>=시간·비용↑. <b>조각 N</b>을 눌러 각 단계(에이전트)에 붙일 규칙 조각을 고르세요. 저장 즉시 다음 생성부터 반영됩니다.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
