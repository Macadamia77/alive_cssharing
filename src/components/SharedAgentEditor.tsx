"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, ArrowLeft, Eye, Edit3, CheckCircle, AlertCircle, Loader2, FileText, Bot, Info,
} from "lucide-react";
import Link from "next/link";

// ─── 타입 ──────────────────────────────────────────────────
interface AgentInfo { file: string; label: string; desc: string; group: string; }

// ─── 마크다운 프리뷰 (GuideEditor와 동일한 경량 렌더러) ────────
function escapeHtml(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(t: string) {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs font-mono">$1</code>');
}
function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="space-y-1 text-slate-700 text-sm leading-relaxed">
      {content.split("\n").map((line, i) => {
        if (line.startsWith("# ")) return <h1 key={i} className="text-lg font-bold mt-3 mb-1">{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold mt-3 mb-1 border-b border-slate-200 pb-1">{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-2 mb-1">{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} className="flex gap-2"><span className="text-blue-500 shrink-0">•</span><span dangerouslySetInnerHTML={{ __html: fmt(line.slice(2)) }} /></div>;
        if (/^\d+\.\s/.test(line)) { const m = line.match(/^(\d+)\.\s(.+)/); if (m) return <div key={i} className="flex gap-2"><span className="text-blue-600 font-semibold shrink-0">{m[1]}.</span><span dangerouslySetInnerHTML={{ __html: fmt(m[2]) }} /></div>; }
        if (line.startsWith("> ")) return <blockquote key={i} className="border-l-2 border-blue-300 pl-3 italic">{line.slice(2)}</blockquote>;
        if (line === "") return <div key={i} className="h-2" />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: fmt(line) }} />;
      })}
    </div>
  );
}

// ─── 메인 ──────────────────────────────────────────────────
export default function SharedAgentEditor() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState(""); const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true); const [fileBusy, setFileBusy] = useState(false);
  const [saving, setSaving] = useState(false); const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const [view, setView] = useState<"edit" | "split" | "preview">("split");

  const dirty = content !== saved;
  const current = agents.find(a => a.file === selected) ?? null;

  // ─── 목록 로드 ──────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch("/api/agents").then(r => r.json())
      .then(d => {
        const list: AgentInfo[] = d.agents ?? [];
        setAgents(list);
        setSelected(prev => prev ?? (list[0]?.file ?? null));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ─── 파일 로드 ──────────────────────────────────────────
  const loadFile = useCallback(async (file: string) => {
    setFileBusy(true);
    try {
      const r = await fetch(`/api/agents/files/${file}`);
      const d = await r.json();
      setContent(d.content ?? ""); setSaved(d.content ?? "");
    } catch { setContent(""); setSaved(""); } finally { setFileBusy(false); }
  }, []);

  useEffect(() => { if (selected) void loadFile(selected); }, [selected, loadFile]);

  // ─── 저장 ────────────────────────────────────────────────
  const handleSave = async () => {
    if (!dirty || saving || !selected) return;
    setSaving(true); setSaveStatus("idle");
    try {
      const r = await fetch(`/api/agents/files/${selected}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error();
      setSaved(content); setSaveStatus("ok"); setTimeout(() => setSaveStatus("idle"), 3000);
    } catch { setSaveStatus("err"); } finally { setSaving(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void handleSave(); }
  };

  // 그룹 순서 유지하며 그룹핑
  const groups: { group: string; items: AgentInfo[] }[] = [];
  for (const a of agents) {
    let g = groups.find(x => x.group === a.group);
    if (!g) { g = { group: a.group, items: [] }; groups.push(g); }
    g.items.push(a);
  }

  if (loading) return (
    <div className="max-w-7xl mx-auto glass-card rounded-2xl p-8 text-center">
      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
      <span className="text-slate-500 text-sm">불러오는 중...</span>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      {/* 상단 */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/guides" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 cursor-pointer">
            <ArrowLeft className="w-4 h-4" />가이드 목록
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-semibold text-slate-900 flex items-center gap-1.5"><Bot className="w-4 h-4 text-purple-500" />공용 에이전트</span>
          {dirty && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">미저장</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            {(["edit", "split", "preview"] as const).map(m => (
              <button key={m} onClick={() => setView(m)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${view === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {m === "edit" && <><Edit3 className="w-3 h-3 inline mr-1" />편집</>}
                {m === "split" && "분할"}
                {m === "preview" && <><Eye className="w-3 h-3 inline mr-1" />미리보기</>}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={!dirty || saving || !selected}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 안내 배너 */}
      <div className="mb-4 flex items-start gap-2 text-sm text-purple-800 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          채널에 속하지 않는 <b>공용/기본 에이전트</b>입니다. 브레인스토밍·리서치·뼈대 설계 등 <b>주제당 1회 공통 단계</b>와,
          채널에 전용 에이전트가 없을 때 쓰이는 <b>기본(폴백) 프롬프트</b>를 여기서 수정합니다. 저장 즉시 다음 생성부터 반영됩니다.
        </p>
      </div>
      {saveStatus === "ok" && <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3"><CheckCircle className="w-4 h-4 shrink-0" />저장 완료 — 다음 생성부터 반영됩니다.</div>}
      {saveStatus === "err" && <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" />저장 실패. 다시 시도해주세요.</div>}

      {/* 본문 */}
      <div className="flex gap-4 h-[72vh]">
        {/* 사이드바 */}
        <aside className="w-64 shrink-0 glass-card rounded-2xl overflow-hidden flex flex-col">
          <div className="px-3 pt-3 pb-2 border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">에이전트 {agents.length}개</p>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {groups.map(g => (
              <div key={g.group} className="mb-2">
                <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{g.group}</p>
                {g.items.map(a => {
                  const isSel = selected === a.file;
                  return (
                    <button key={a.file} onClick={() => setSelected(a.file)}
                      className={`w-full flex items-start gap-2 px-3 py-2 mx-1 rounded-lg text-left transition-colors cursor-pointer ${isSel ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}
                      style={{ width: "calc(100% - 8px)" }}>
                      <FileText className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isSel ? "text-blue-500" : "text-slate-400"}`} />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium truncate">{a.label}</span>
                        {a.desc && <span className="block text-[10px] text-slate-400 leading-tight mt-0.5">{a.desc}</span>}
                        <span className="block text-[10px] text-slate-300 font-mono mt-0.5">{a.file}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-slate-100">
            <div className="flex items-start gap-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-emerald-600 leading-tight font-medium">저장 즉시 AI 생성에 반영됩니다</p>
            </div>
          </div>
        </aside>

        {/* 에디터 */}
        {selected ? (
          <div className={`flex-1 grid gap-4 min-w-0 ${view === "split" ? "grid-cols-2" : "grid-cols-1"}`}>
            {(view === "edit" || view === "split") && (
              <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Edit3 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 truncate">{current?.label ?? selected}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 ml-2">Ctrl+S 저장</span>
                </div>
                {fileBusy
                  ? <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                  : <textarea value={content} onChange={e => setContent(e.target.value)} onKeyDown={handleKeyDown}
                      className="flex-1 p-4 text-sm font-mono text-slate-800 bg-white resize-none focus:outline-none leading-relaxed" spellCheck={false} />
                }
              </div>
            )}
            {(view === "preview" || view === "split") && (
              <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs font-medium text-slate-700">미리보기</span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto">
                  {content ? <MarkdownPreview content={content} /> : <p className="text-slate-400 text-sm">내용이 없습니다.</p>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 glass-card rounded-2xl flex items-center justify-center text-slate-400 text-sm">왼쪽에서 에이전트를 선택하세요</div>
        )}
      </div>

      <p className="text-xs text-slate-400 text-center mt-3">
        저장 위치: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">data/agents/</code> (공용 · 채널 무관)
      </p>
    </div>
  );
}
