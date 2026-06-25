"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Save, ArrowLeft, Eye, Edit3, CheckCircle, AlertCircle,
  Loader2, Plus, Trash2, FileText, ChevronRight, ChevronDown,
  Upload, X, ToggleLeft, ToggleRight, Info,
} from "lucide-react";
import Link from "next/link";
import { CHANNEL_LABELS, CHANNEL_COLORS, type ChannelKey } from "@/lib/channels";

// ─── 타입 ────────────────────────────────────────────────────
interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  included: boolean;
}
interface ChannelMeta {
  label: string;
  type: "single" | "multi";
  description: string;
  include: string[];
  excluded_note?: string;
}

// ─── 마크다운 간이 프리뷰 ──────────────────────────────────────
function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs font-mono">$1</code>');
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1 text-slate-700 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) return <h1 key={i} className="text-lg font-bold text-slate-900 mt-3 mb-1">{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold text-slate-800 mt-3 mb-1 border-b border-slate-200 pb-1">{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold text-slate-800 mt-2 mb-1">{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* ")) return (
          <div key={i} className="flex gap-2"><span className="text-blue-500 mt-0.5 shrink-0">•</span><span dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} /></div>
        );
        if (/^\d+\.\s/.test(line)) {
          const m = line.match(/^(\d+)\.\s(.+)/);
          if (m) return <div key={i} className="flex gap-2"><span className="text-blue-600 font-semibold shrink-0">{m[1]}.</span><span dangerouslySetInnerHTML={{ __html: formatInline(m[2]) }} /></div>;
        }
        if (line.startsWith("> ")) return <blockquote key={i} className="border-l-2 border-blue-300 pl-3 text-slate-600 italic">{line.slice(2)}</blockquote>;
        if (line === "") return <div key={i} className="h-2" />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />;
      })}
    </div>
  );
}

// ─── 파일 트리 노드 ───────────────────────────────────────────
function FileTreeNode({
  node, depth, selected, included, onSelect, onToggleInclude, onDelete,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  included: string[];
  onSelect: (p: string) => void;
  onToggleInclude: (p: string) => void;
  onDelete: (p: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isIncluded = included.includes(node.path);
  const isSelected = selected === node.path;

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <span className="uppercase tracking-wider">{node.name}/</span>
        </button>
        {open && node.children?.map(child => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selected={selected} included={included} onSelect={onSelect} onToggleInclude={onToggleInclude} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg mx-1 cursor-pointer transition-colors duration-150 ${isSelected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <FileText className="w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
      <button className="flex-1 text-left text-xs truncate cursor-pointer" onClick={() => onSelect(node.path)}>
        {node.name}
      </button>

      {/* 포함 토글 */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleInclude(node.path); }}
        title={isIncluded ? "시스템 프롬프트에서 제외" : "시스템 프롬프트에 포함"}
        className={`opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer transition-opacity duration-150 ${isIncluded ? "text-emerald-500" : "text-slate-300"}`}
        aria-label={isIncluded ? "제외" : "포함"}
      >
        {isIncluded ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
      </button>

      {/* 삭제 (guide.md는 제외) */}
      {node.path !== "guide.md" && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(node.path); }}
          className="opacity-0 group-hover:opacity-100 shrink-0 text-red-400 hover:text-red-600 cursor-pointer transition-opacity duration-150"
          aria-label="파일 삭제"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── MD 가져오기 패널 ─────────────────────────────────────────
function ImportPanel({
  channel, onImported, onClose,
}: {
  channel: ChannelKey;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target?.result as string ?? "");
    reader.readAsText(file, "utf-8");
  };

  const handleSave = async () => {
    const name = filename.trim();
    if (!name || !content.trim()) { setError("파일명과 내용을 입력해주세요."); return; }
    const safeName = name.endsWith(".md") ? name : `${name}.md`;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/channels/${channel}/files/${safeName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? "저장 실패");
      }
      await onImported(); // 트리 새로고침 완료 후 패널 닫기
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="MD 파일 가져오기">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">MD 파일 가져오기</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer text-slate-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">파일 직접 선택 (선택)</label>
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFileRead} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                파일 선택
              </button>
              <span className="text-sm text-slate-400 self-center">{filename || "선택된 파일 없음"}</span>
            </div>
          </div>

          <div>
            <label htmlFor="import-filename" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              저장할 파일명 <span className="text-red-400">*</span>
            </label>
            <input
              id="import-filename"
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="예: instagram-guide.md"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="import-content" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              MD 내용 붙여넣기 <span className="text-red-400">*</span>
            </label>
            <textarea
              id="import-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="팀원에게 받은 MD 파일 내용을 여기에 붙여넣으세요..."
              rows={10}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors">취소</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "저장 중..." : "채널에 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

function findFirstFile(nodes: FileNode[]): string | null {
  for (const n of nodes) {
    if (n.type === "file") return n.path;
    if (n.children) { const f = findFirstFile(n.children); if (f) return f; }
  }
  return null;
}

// ─── 메인 GuideEditor ────────────────────────────────────────
export default function GuideEditor({ channel }: { channel: ChannelKey }) {
  const [meta, setMeta] = useState<ChannelMeta | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [viewMode, setViewMode] = useState<"edit" | "split" | "preview">("split");
  const [showImport, setShowImport] = useState(false);

  const { color } = CHANNEL_COLORS[channel];
  const label = CHANNEL_LABELS[channel];
  const isDirty = content !== savedContent;

  const loadChannel = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/channels/${channel}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMeta(data.meta);
      setTree(data.tree);
      // selectedFile을 closure로 읽지 않고 함수형 업데이트로 처리 → 무한루프 방지
      setSelectedFile(prev => prev ?? findFirstFile(data.tree));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [channel]); // selectedFile 제거 → loadChannel이 안정적으로 유지됨

  const loadFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    try {
      const res = await fetch(`/api/channels/${channel}/files/${filePath}`);
      const data = await res.json();
      setContent(data.content ?? "");
      setSavedContent(data.content ?? "");
    } catch { setContent(""); setSavedContent(""); }
    finally { setFileLoading(false); }
  }, [channel]);

  useEffect(() => { loadChannel(); }, [loadChannel]);
  useEffect(() => { if (selectedFile) loadFile(selectedFile); }, [selectedFile, loadFile]);

  const handleSave = async () => {
    if (!isDirty || saving || !selectedFile) return;
    setSaving(true);
    setSaveStatus("idle");
    try {
      const res = await fetch(`/api/channels/${channel}/files/${selectedFile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error();
      setSavedContent(content);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch { setSaveStatus("error"); }
    finally { setSaving(false); }
  };

  const handleToggleInclude = async (filePath: string) => {
    if (!meta) return;
    const newInclude = meta.include.includes(filePath)
      ? meta.include.filter(p => p !== filePath)
      : [...meta.include, filePath];
    const newMeta = { ...meta, include: newInclude };
    setMeta(newMeta);
    await fetch(`/api/channels/${channel}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include: newInclude }),
    });
    await loadChannel();
  };

  const handleDelete = async (filePath: string) => {
    if (!confirm(`"${filePath}" 파일을 삭제하시겠습니까?`)) return;
    await fetch(`/api/channels/${channel}/files/${filePath}`, { method: "DELETE" });
    if (selectedFile === filePath) setSelectedFile(null);
    await loadChannel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); handleSave(); }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto glass-card rounded-2xl p-8 text-center" role="status">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" aria-hidden="true" />
        <span className="text-slate-500 text-sm">가이드 불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {showImport && (
        <ImportPanel channel={channel} onImported={loadChannel} onClose={() => setShowImport(false)} />
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/guides" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            가이드 목록
          </Link>
          <span className="text-slate-300">/</span>
          <span className={`font-semibold text-slate-900 ${color}`}>{label}</span>
          {isDirty && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">미저장</span>}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode */}
          <div className="flex bg-slate-100 rounded-xl p-1">
            {(["edit", "split", "preview"] as const).map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${viewMode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                aria-pressed={viewMode === mode}>
                {mode === "edit" && <><Edit3 className="w-3 h-3 inline mr-1" aria-hidden="true" />편집</>}
                {mode === "split" && "분할"}
                {mode === "preview" && <><Eye className="w-3 h-3 inline mr-1" aria-hidden="true" />미리보기</>}
              </button>
            ))}
          </div>

          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors">
            <Plus className="w-4 h-4" aria-hidden="true" />
            MD 가져오기
          </button>

          <button onClick={handleSave} disabled={!isDirty || saving || !selectedFile}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* Status */}
      {saveStatus === "success" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 fade-in" role="status">
          <CheckCircle className="w-4 h-4 shrink-0" />
          저장 완료 — 다음 콘텐츠 생성부터 즉시 반영됩니다.
        </div>
      )}
      {saveStatus === "error" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" />
          저장에 실패했습니다. 다시 시도해주세요.
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-4 h-[72vh]">
        {/* File sidebar */}
        <aside className="w-56 shrink-0 glass-card rounded-2xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">파일 목록</span>
            <button onClick={() => setShowImport(true)} className="p-1 rounded-lg hover:bg-slate-100 cursor-pointer text-slate-400 hover:text-blue-600 transition-colors" aria-label="파일 추가">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {tree.map(node => (
              <FileTreeNode
                key={node.path} node={node} depth={0}
                selected={selectedFile} included={meta?.include ?? []}
                onSelect={setSelectedFile}
                onToggleInclude={handleToggleInclude}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Include hint */}
          <div className="px-3 py-2 border-t border-slate-100 flex items-start gap-1.5">
            <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-[10px] text-slate-400 leading-tight">
              토글 아이콘으로 AI 시스템 프롬프트 포함 여부 조절
            </p>
          </div>

          {meta?.excluded_note && (
            <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
              <p className="text-[10px] text-amber-700 leading-tight">{meta.excluded_note}</p>
            </div>
          )}
        </aside>

        {/* Editor / Preview */}
        {selectedFile ? (
          <div className={`flex-1 grid gap-4 min-w-0 ${viewMode === "split" ? "grid-cols-2" : "grid-cols-1"}`}>
            {(viewMode === "edit" || viewMode === "split") && (
              <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Edit3 className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-medium text-slate-700 truncate">{selectedFile}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 ml-2">Ctrl+S 저장</span>
                </div>
                {fileLoading ? (
                  <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                ) : (
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 p-4 text-sm font-mono text-slate-800 bg-white resize-none focus:outline-none leading-relaxed"
                    spellCheck={false}
                    aria-label={`${selectedFile} 편집`}
                  />
                )}
              </div>
            )}
            {(viewMode === "preview" || viewMode === "split") && (
              <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span className="text-xs font-medium text-slate-700">미리보기</span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto">
                  {content ? <MarkdownPreview content={content} /> : <p className="text-slate-400 text-sm">내용이 없습니다.</p>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 glass-card rounded-2xl flex items-center justify-center text-slate-400 text-sm">
            왼쪽 목록에서 파일을 선택하세요
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 text-center mt-3">
        파일 위치: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">data/channels/{channel}/</code>
      </p>
    </div>
  );
}
