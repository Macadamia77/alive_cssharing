"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, CheckCircle, AlertCircle, GripVertical, Trash2, ArrowUp, ArrowDown, Plus, Save,
} from "lucide-react";
import { type ChannelKey } from "@/lib/channels";
import type { Composition, CompositionBlock } from "@/lib/pipeline/types";
import type { ChannelMeta } from "@/lib/channelFiles";
// 순수 함수(타입 전용 import만 있어 클라이언트 번들에 서버 모듈이 딸려오지 않음) — 저장 전 검증·미리보기에 재사용.
import { validateComposition, compileComposition } from "@/lib/pipeline/composition";

type FileNode = { name: string; path: string; type: "file" | "dir"; children?: FileNode[] };
type BlockType = CompositionBlock["type"];

const EMPTY: Composition = { version: 1, blocks: [] };
const TYPE_LABEL: Record<BlockType, string> = {
  "generate": "생성자(generate)",
  "reviewer": "검수자(reviewer)",
  "review-loop": "검수 루프(review-loop·구)",
  "image-loop": "이미지 루프(image-loop)",
};

function defaultBlock(type: BlockType): CompositionBlock {
  if (type === "generate") return { type: "generate", agent: "", guides: [], output: "context" };
  if (type === "reviewer") return { type: "reviewer", agent: "", guides: [], maxRetries: 1, rewriteMode: "full" };
  if (type === "review-loop") return { type: "review-loop", generateAgent: "", guides: [], reviewers: [{ agent: "", guides: [] }], maxRetries: 1, rewriteMode: "full" };
  return { type: "image-loop", generateAgent: "", guides: [], maxRetries: 1 };
}

function normalizeComp(raw: unknown): Composition {
  const r = (raw ?? {}) as { version?: unknown; blocks?: unknown };
  return { version: typeof r.version === "number" ? r.version : 1, blocks: Array.isArray(r.blocks) ? (r.blocks as CompositionBlock[]) : [] };
}

// 채널 파일 트리에서 agents/ 폴더의 .md 파일 이름(확장자 제거)만 수집.
function collectAgentNames(tree: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const n of nodes) {
      if (n.type === "dir") { if (n.children) walk(n.children); }
      else if (n.path.startsWith("agents/") && n.name.endsWith(".md")) out.push(n.name.replace(/\.md$/, ""));
    }
  };
  walk(tree);
  return out;
}

export default function CompositionBuilder({ channel }: { channel: ChannelKey }) {
  const [comp, setComp] = useState<Composition>(EMPTY);
  const [meta, setMeta] = useState<ChannelMeta | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [guides, setGuides] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // 채널 GET·/api/agents GET이 둘 다 성공했을 때만 "파일 실존 검증"을 신뢰(로드 실패 시 거짓 '없음' 오류 방지).
  const [listsLoaded, setListsLoaded] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ch, ag, compFile] = await Promise.all([
        fetch(`/api/channels/${channel}`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/agents`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/channels/${channel}/files/composition.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setMeta((ch.meta as ChannelMeta) ?? null);
      setGuides(Array.isArray(ch.guides) ? ch.guides.map((g: { path: string }) => g.path) : []);
      const shared = Array.isArray(ag.agents) ? ag.agents.map((a: { file: string }) => a.file.replace(/\.md$/, "")) : [];
      const local = collectAgentNames(Array.isArray(ch.tree) ? ch.tree : []);
      setAgents(Array.from(new Set([...local, ...shared])).sort());
      // 두 목록 모두 정상 로드됐을 때만 파일 실존 검증을 신뢰(하나라도 실패하면 목록이 불완전 → 거짓 오류).
      setListsLoaded(Array.isArray(ch.guides) && Array.isArray(ag.agents));
      if (compFile && typeof compFile.content === "string") {
        try { setComp(normalizeComp(JSON.parse(compFile.content))); } catch { setComp(EMPTY); }
      } else { setComp(EMPTY); }
    } finally { setLoading(false); }
  }, [channel]);
  useEffect(() => { void reload(); }, [reload]);

  // 불변 업데이트 — 작은 객체라 structuredClone으로 단순화(원본 상태 오염 방지).
  const mutate = (fn: (draft: Composition) => void) =>
    setComp(prev => { const d = structuredClone(prev); fn(d); return d; });
  const setBlock = (i: number, next: CompositionBlock) => mutate(d => { d.blocks[i] = next; });
  const addBlock = (t: BlockType) => mutate(d => { d.blocks.push(defaultBlock(t)); });
  // 텍스트 루프 프리셋 = draft 생성자 + 검수자 1개를 올바른 순서로 한 번에 추가(원자 블록 조합).
  const addTextLoop = () => mutate(d => {
    d.blocks.push({ type: "generate", agent: "", guides: [], output: "draft" });
    d.blocks.push({ type: "reviewer", agent: "", guides: [], maxRetries: 1, rewriteMode: "full" });
  });
  const removeBlock = (i: number) => mutate(d => { d.blocks.splice(i, 1); });
  const moveBlock = (i: number, dir: -1 | 1) => mutate(d => {
    const j = i + dir; if (j < 0 || j >= d.blocks.length) return;
    [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]];
  });
  const dropBlock = (target: number) => {
    if (dragIdx === null || dragIdx === target) { setDragIdx(null); setOverIdx(null); return; }
    mutate(d => { const [m] = d.blocks.splice(dragIdx, 1); d.blocks.splice(target, 0, m); });
    setDragIdx(null); setOverIdx(null);
  };

  // 검증 — 두 목록이 정상 로드됐을 때만 파일 실존 검사(로드 실패 시 거짓 '없음' 오류 방지). 구조 검증은 항상.
  const errors = validateComposition(comp, listsLoaded ? { agents, guides } : undefined);
  let preview = "";
  try {
    preview = compileComposition(comp, (meta ?? {}) as ChannelMeta)
      .map(s => `${s.persona}(${s.kind}·${s.guides?.length ?? 0})`).join(" → ");
  } catch { preview = "(미리보기 계산 실패)"; }

  const save = async () => {
    if (errors.length) return;
    setSaving(true); setStatus("idle");
    try {
      const r = await fetch(`/api/channels/${channel}/files/composition.json`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(comp, null, 2) }),
      });
      if (!r.ok) throw new Error();
      setStatus("ok"); setTimeout(() => setStatus("idle"), 2500);
    } catch { setStatus("err"); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 px-3 py-4"><Loader2 className="w-3.5 h-3.5 animate-spin" />조립표 불러오는 중...</div>;
  }

  return (
    <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/20 p-4">
      {/* 헤더: 제목 + 저장 */}
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-slate-700 flex-1">조립표 편집 (composition.json)</p>
        {status === "ok" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
        {status === "err" && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
        <button onClick={() => void save()} disabled={saving || errors.length > 0}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 cursor-pointer hover:bg-blue-700">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}저장
        </button>
      </div>

      {/* 컴파일 미리보기 */}
      <div className="mb-2 rounded-lg bg-white/70 border border-slate-100 px-3 py-2.5">
        <span className="text-xs text-slate-400">실행 순서 미리보기: </span>
        <span className="text-sm text-slate-600">{preview || "(블록 없음)"}</span>
      </div>

      {/* 검증 경고 */}
      {errors.length > 0 && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2.5">
          <p className="text-xs font-semibold text-red-600 mb-0.5">저장 전 해결 필요:</p>
          <ul className="text-xs text-red-500 list-disc pl-4 space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* 블록 목록 */}
      <div className="space-y-2">
        {comp.blocks.map((block, i) => (
          <div key={i}
            onDragOver={e => { e.preventDefault(); setOverIdx(i); }}
            onDrop={() => dropBlock(i)}
            className={`rounded-xl border bg-white transition-colors ${dragIdx === i ? "opacity-50" : ""} ${overIdx === i && dragIdx !== null && dragIdx !== i ? "ring-2 ring-blue-400 border-blue-300" : "border-slate-200"}`}>
            {/* 블록 헤더 (드래그 소스) */}
            <div draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              className="flex items-center gap-1.5 px-3 py-2.5 border-b border-slate-100 cursor-grab active:cursor-grabbing">
              <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="text-sm font-semibold text-blue-700 flex-1">{i + 1}. {TYPE_LABEL[block.type]}</span>
              <button onClick={() => moveBlock(i, -1)} disabled={i === 0} className="p-0.5 disabled:opacity-30 cursor-pointer" title="위로"><ArrowUp className="w-3 h-3 text-slate-400" /></button>
              <button onClick={() => moveBlock(i, 1)} disabled={i === comp.blocks.length - 1} className="p-0.5 disabled:opacity-30 cursor-pointer" title="아래로"><ArrowDown className="w-3 h-3 text-slate-400" /></button>
              <button onClick={() => removeBlock(i)} className="p-0.5 cursor-pointer" title="블록 삭제"><Trash2 className="w-3 h-3 text-red-400" /></button>
            </div>
            {/* 블록 본문 */}
            <div className="px-3 py-3">
              <BlockBody block={block} agents={agents} guides={guides} onChange={next => setBlock(i, next)} />
            </div>
          </div>
        ))}
        {comp.blocks.length === 0 && <p className="text-sm text-slate-400 px-1 py-2">블록이 없습니다. 아래에서 추가하세요.</p>}
      </div>

      {/* 블록 추가 — 원자 단위로 쌓는다. "텍스트 루프"는 생성자(draft)+검수자를 한 번에 넣는 프리셋. */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {([
          { label: "생성자 추가", onClick: () => addBlock("generate") },
          { label: "텍스트 루프", onClick: addTextLoop },
          { label: "리뷰어 추가", onClick: () => addBlock("reviewer") },
          { label: "이미지 루프", onClick: () => addBlock("image-loop") },
        ]).map(({ label, onClick }) => (
          <button key={label} onClick={onClick}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 hover:border-blue-300 hover:text-blue-600 cursor-pointer">
            <Plus className="w-3 h-3" />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 블록 타입별 본문 ────────────────────────────────────────
function BlockBody({ block, agents, guides, onChange }: {
  block: CompositionBlock; agents: string[]; guides: string[]; onChange: (b: CompositionBlock) => void;
}) {
  if (block.type === "generate") {
    return (
      <div className="space-y-2">
        <Row label="에이전트"><AgentSelect value={block.agent} agents={agents} onChange={v => onChange({ ...block, agent: v })} /></Row>
        <Row label="출력">
          <select value={block.output ?? "context"} onChange={e => onChange({ ...block, output: e.target.value as "context" | "draft" })} className={selectCls}>
            <option value="context">context (뒤 단계 참고맥락)</option>
            <option value="draft">draft (검수받을 본문)</option>
          </select>
        </Row>
        <label className="flex items-center gap-1.5 text-sm text-slate-500 cursor-pointer">
          <input type="checkbox" checked={!!block.useSearch} onChange={e => onChange({ ...block, useSearch: e.target.checked })} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />웹서치 사용
        </label>
        <GuideSlot label="가이드" selected={block.guides ?? []} available={guides} onChange={g => onChange({ ...block, guides: g })} />
        <ThinkingRow value={block.thinking} onChange={t => onChange({ ...block, thinking: t })} />
      </div>
    );
  }
  if (block.type === "reviewer") {
    return (
      <div className="space-y-2">
        <Row label="검수 에이전트"><AgentSelect value={block.agent} agents={agents} onChange={v => onChange({ ...block, agent: v })} /></Row>
        <GuideSlot label="가이드" selected={block.guides ?? []} available={guides} onChange={g => onChange({ ...block, guides: g })} />
        <div className="flex items-center gap-3 flex-wrap">
          <Row label="최대 재작성"><input type="number" min={1} value={block.maxRetries ?? 1} onChange={e => onChange({ ...block, maxRetries: Math.max(1, Number(e.target.value) || 1) })} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs" /></Row>
          <Row label="재작성 방식">
            <select value={block.rewriteMode ?? "full"} onChange={e => onChange({ ...block, rewriteMode: e.target.value as "full" | "patch" })} className={selectCls}>
              <option value="full">full (전체 재작성)</option>
              <option value="patch">patch (부분 수정)</option>
            </select>
          </Row>
        </div>
        <ThinkingRow value={block.thinking} onChange={t => onChange({ ...block, thinking: t })} />
        <p className="text-xs text-slate-400">앞 단계의 draft를 검수합니다. tone 계열이 아니면 리서치([참고 자료])를 함께 받아 인용을 대조합니다.</p>
      </div>
    );
  }
  if (block.type === "review-loop") {
    const reviewers = block.reviewers ?? [];
    const setRev = (j: number, agent: string) => onChange({ ...block, reviewers: reviewers.map((r, k) => k === j ? { ...r, agent } : r) });
    const setRevGuides = (j: number, g: string[]) => onChange({ ...block, reviewers: reviewers.map((r, k) => k === j ? { ...r, guides: g } : r) });
    const moveRev = (j: number, dir: -1 | 1) => { const t = j + dir; if (t < 0 || t >= reviewers.length) return; const n = [...reviewers]; [n[j], n[t]] = [n[t], n[j]]; onChange({ ...block, reviewers: n }); };
    return (
      <div className="space-y-2">
        <Row label="생성 에이전트"><AgentSelect value={block.generateAgent} agents={agents} onChange={v => onChange({ ...block, generateAgent: v })} /></Row>
        <GuideSlot label="생성 가이드" selected={block.guides ?? []} available={guides} onChange={g => onChange({ ...block, guides: g })} />
        <div className="rounded-lg bg-slate-50/70 border border-slate-100 p-2">
          <p className="text-xs font-semibold text-slate-500 mb-1">검수자 (순서대로 실행)</p>
          {reviewers.map((r, j) => (
            <div key={j} className="mb-1.5 rounded-lg bg-white border border-slate-100 p-1.5">
              <div className="flex items-center gap-1 mb-1">
                <AgentSelect value={r.agent} agents={agents} onChange={v => setRev(j, v)} placeholder="검수 에이전트" />
                <button onClick={() => moveRev(j, -1)} disabled={j === 0} className="p-0.5 disabled:opacity-30 cursor-pointer"><ArrowUp className="w-3 h-3 text-slate-400" /></button>
                <button onClick={() => moveRev(j, 1)} disabled={j === reviewers.length - 1} className="p-0.5 disabled:opacity-30 cursor-pointer"><ArrowDown className="w-3 h-3 text-slate-400" /></button>
                <button onClick={() => onChange({ ...block, reviewers: reviewers.filter((_, k) => k !== j) })} className="p-0.5 cursor-pointer"><Trash2 className="w-3 h-3 text-red-400" /></button>
              </div>
              <GuideSlot label="검수 가이드" selected={r.guides ?? []} available={guides} onChange={g => setRevGuides(j, g)} />
            </div>
          ))}
          <button onClick={() => onChange({ ...block, reviewers: [...reviewers, { agent: "", guides: [] }] })}
            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-xs text-slate-500 hover:border-blue-300 cursor-pointer"><Plus className="w-3 h-3" />검수자 추가</button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Row label="최대 재작성"><input type="number" min={1} value={block.maxRetries ?? 1} onChange={e => onChange({ ...block, maxRetries: Math.max(1, Number(e.target.value) || 1) })} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs" /></Row>
          <Row label="재작성 방식">
            <select value={block.rewriteMode ?? "full"} onChange={e => onChange({ ...block, rewriteMode: e.target.value as "full" | "patch" })} className={selectCls}>
              <option value="full">full (전체 재작성)</option>
              <option value="patch">patch (부분 수정)</option>
            </select>
          </Row>
        </div>
      </div>
    );
  }
  if (block.type === "image-loop") {
    return (
      <div className="space-y-2">
        <Row label="생성 에이전트"><AgentSelect value={block.generateAgent} agents={agents} onChange={v => onChange({ ...block, generateAgent: v })} /></Row>
        <GuideSlot label="가이드" selected={block.guides ?? []} available={guides} onChange={g => onChange({ ...block, guides: g })} />
        <Row label="비전 검수자">
          <AgentSelect value={block.reviewer ?? ""} agents={agents} placeholder="검수 안 함(선택)" onChange={v => onChange({ ...block, reviewer: v || null })} />
        </Row>
        <p className="text-xs text-slate-400">검수자를 지정하면 생성된 카드 이미지를 그 에이전트가 "눈으로" 검수하고, 반려 시 카드를 재생성합니다(최대 재작성 횟수만큼).</p>
        <Row label="최대 재작성"><input type="number" min={1} value={block.maxRetries ?? 1} onChange={e => onChange({ ...block, maxRetries: Math.max(1, Number(e.target.value) || 1) })} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs" /></Row>
      </div>
    );
  }
  // 알 수 없는 블록 타입(향후 추가 시) — image-loop로 오인 렌더하지 않고 명시적으로 표시.
  return <p className="text-xs text-amber-600">알 수 없는 블록 타입입니다.</p>;
}

const selectCls = "border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white cursor-pointer";

// thinking(사고) 토글 + 예산 입력 — 켜면 { budgetTokens } 세팅, 끄면 undefined(=JSON에서 필드 제거).
// budgetTokens는 claude 네이티브 extended thinking 예산이라 claude 경로에서만 실효(gemini는 자체 설정).
function ThinkingRow({ value, onChange }: { value?: { budgetTokens: number }; onChange: (t?: { budgetTokens: number }) => void }) {
  const on = !!value;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="flex items-center gap-1.5 text-sm text-slate-500 cursor-pointer">
        <input type="checkbox" checked={on}
          onChange={e => onChange(e.target.checked ? { budgetTokens: value?.budgetTokens || 2000 } : undefined)}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
        thinking(사고)
      </label>
      {on && (
        <label className="flex items-center gap-1 text-xs text-slate-400">예산
          <input type="number" min={1024} step={512} value={value!.budgetTokens}
            onChange={e => onChange({ budgetTokens: Math.max(1024, Number(e.target.value) || 2000) })}
            className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs" />
        </label>
      )}
      <span className="text-xs text-slate-300">claude 경로에서만 실효</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function AgentSelect({ value, agents, onChange, placeholder }: { value: string; agents: string[]; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${selectCls} flex-1 min-w-[140px]`}>
      <option value="">{placeholder ?? "에이전트 선택"}</option>
      {agents.map(a => <option key={a} value={a}>{a}</option>)}
      {value && !agents.includes(value) && <option value={value}>{value} (목록 외)</option>}
    </select>
  );
}

// 순서 있는 가이드 슬롯 — 선택 목록(위/아래/삭제) + 미선택 추가 드롭다운.
function GuideSlot({ label, selected, available, onChange }: { label: string; selected: string[]; available: string[]; onChange: (g: string[]) => void }) {
  const remaining = available.filter(g => !selected.includes(g));
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= selected.length) return; const n = [...selected]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  // 드래그 재정렬. 위/아래 버튼은 접근성·미세조정용으로 유지한다. 블록 카드 자체도 draggable이라,
  // 여기 드래그 이벤트가 상위(블록 재정렬) 핸들러로 버블링되면 블록이 대신 움직이는 사고가 난다 →
  // 모든 DnD 이벤트를 stopPropagation한다. draggable은 그립 핸들에만 걸어 up/down·삭제 버튼 클릭과
  // 드래그 시작이 충돌하지 않게 한다(행 전체는 드롭 타깃 역할만).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= selected.length || to >= selected.length) return;
    const n = [...selected];
    const [moved] = n.splice(from, 1);
    n.splice(to, 0, moved);
    onChange(n);
  };
  return (
    <div>
      <p className="text-xs text-slate-400 mb-1">{label} <span className="text-slate-300">(순서 = 주입 순서 · 그립 드래그로 변경)</span></p>
      {selected.length === 0 && <p className="text-xs text-slate-300 mb-1">배정된 가이드 없음</p>}
      <div className="space-y-0.5">
        {selected.map((g, i) => (
          <div key={`${g}__${i}`}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOverIdx(i); }}
            onDrop={e => { e.stopPropagation(); if (dragIdx !== null) reorder(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
            className={`flex items-center gap-1 rounded border px-2 py-1 ${overIdx === i && dragIdx !== null && dragIdx !== i ? "border-blue-300 bg-blue-50" : "bg-slate-50 border-slate-100"} ${dragIdx === i ? "opacity-40" : ""}`}>
            <span draggable
              onDragStart={e => { e.stopPropagation(); setDragIdx(i); }}
              onDragEnd={e => { e.stopPropagation(); setDragIdx(null); setOverIdx(null); }}
              className="cursor-move shrink-0" title="드래그해서 순서 변경">
              <GripVertical className="w-3 h-3 text-slate-300" />
            </span>
            <span className="text-xs text-slate-600 flex-1 truncate">{g}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 disabled:opacity-30 cursor-pointer"><ArrowUp className="w-3 h-3 text-slate-400" /></button>
            <button onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="p-0.5 disabled:opacity-30 cursor-pointer"><ArrowDown className="w-3 h-3 text-slate-400" /></button>
            <button onClick={() => onChange(selected.filter(x => x !== g))} className="p-0.5 cursor-pointer"><Trash2 className="w-3 h-3 text-red-400" /></button>
          </div>
        ))}
      </div>
      {remaining.length > 0 && (
        <select value="" onChange={e => { if (e.target.value) onChange([...selected, e.target.value]); }} className={`${selectCls} mt-1 w-full`}>
          <option value="">+ 가이드 추가</option>
          {remaining.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      )}
    </div>
  );
}
