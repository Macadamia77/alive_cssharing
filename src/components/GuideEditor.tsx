"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Save, ArrowLeft, Eye, Edit3, CheckCircle, AlertCircle,
  Loader2, Trash2, FileText, ChevronRight, ChevronDown,
  Upload, X, ToggleLeft, ToggleRight, Info, FolderPlus, Folder, FilePlus,
} from "lucide-react";
import Link from "next/link";
import { CHANNEL_LABELS, CHANNEL_COLORS, type ChannelKey } from "@/lib/channels";

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

// ─── 마크다운 프리뷰 ────────────────────────────────────────
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

// ─── 트리 헬퍼 ──────────────────────────────────────────────
function extractFolders(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const n of nodes) {
    if (n.type === "dir") {
      result.push(n);
      if (n.children) result.push(...extractFolders(n.children));
    }
  }
  return result;
}

function removeNodeFromTree(nodes: FileNode[], targetPath: string): FileNode[] {
  return nodes
    .filter(n => n.path !== targetPath)
    .map(n => n.type === "dir" && n.children
      ? { ...n, children: removeNodeFromTree(n.children, targetPath) }
      : n
    );
}

function moveNodeInTree(nodes: FileNode[], sourcePath: string, newPath: string, targetFolder: string): FileNode[] {
  let movedNode: FileNode | null = null;

  function removeSource(ns: FileNode[]): FileNode[] {
    const out: FileNode[] = [];
    for (const n of ns) {
      if (n.path === sourcePath) {
        movedNode = { ...n, path: newPath, name: newPath.split("/").pop()! };
      } else {
        out.push(n.type === "dir" && n.children ? { ...n, children: removeSource(n.children) } : n);
      }
    }
    return out;
  }

  const withoutSource = removeSource(nodes);
  if (!movedNode) return nodes;

  if (!targetFolder) return [...withoutSource, movedNode];

  function addToFolder(ns: FileNode[]): FileNode[] {
    return ns.map(n => {
      if (n.path === targetFolder && n.type === "dir") return { ...n, children: [...(n.children ?? []), movedNode!] };
      if (n.type === "dir" && n.children) return { ...n, children: addToFolder(n.children) };
      return n;
    });
  }
  return addToFolder(withoutSource);
}

function findFirstFile(nodes: FileNode[]): string | null {
  for (const n of nodes) {
    if (n.type === "file") return n.path;
    if (n.children) { const f = findFirstFile(n.children); if (f) return f; }
  }
  return null;
}

// ─── 파일 트리 노드 ───────────────────────────────────────────
interface DragHandlers {
  draggingFile: string | null;
  dropTarget: string | null;
  onDragStart: (p: string) => void;
  onDragEnd: () => void;
  onDrop: (folder: string) => void;
  setDropTarget: (t: string | null) => void;
}

function FileTreeNode({
  node, depth, selected, included, drag,
  onSelect, onToggleInclude, onDelete,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  included: string[];
  drag: DragHandlers;
  onSelect: (p: string) => void;
  onToggleInclude: (p: string) => void;
  onDelete: (p: string, isFolder?: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const isIncluded = included.includes(node.path);
  const isSelected = selected === node.path;
  const pl = `${8 + depth * 16}px`;
  const isDropTarget = drag.dropTarget === node.path;
  const isDragging = drag.draggingFile === node.path;

  if (node.type === "dir") {
    return (
      <div>
        <div
          className={`group flex items-center gap-1 mx-1 rounded-lg transition-colors ${
            isDropTarget
              ? "bg-blue-100 ring-1 ring-blue-400"
              : "hover:bg-slate-50"
          }`}
          style={{ paddingLeft: pl, paddingRight: "4px" }}
          onDragOver={(e) => {
            if (!drag.draggingFile) return;
            e.preventDefault();
            e.stopPropagation();
            drag.setDropTarget(node.path);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (drag.dropTarget === node.path) drag.setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            drag.onDrop(node.path);
          }}
        >
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 flex-1 py-1.5 text-left text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
          >
            {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <Folder className={`w-3 h-3 shrink-0 ${isDropTarget ? "text-blue-500" : "text-amber-400"}`} />
            <span className="uppercase tracking-wider truncate">{node.name}</span>
            {isDropTarget && <span className="ml-auto text-[10px] text-blue-600 font-medium">여기에 놓기</span>}
          </button>
          {!isDropTarget && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(node.path, true); }}
              className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-red-400 hover:text-red-600 cursor-pointer transition-opacity"
              aria-label="폴더 삭제"
              title="폴더 삭제"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        {open && node.children?.map(child => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selected={selected} included={included} drag={drag} onSelect={onSelect} onToggleInclude={onToggleInclude} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  return (
    <div
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        drag.onDragStart(node.path);
      }}
      onDragEnd={drag.onDragEnd}
      className={`group flex items-center gap-1 rounded-lg mx-1 transition-colors duration-150 ${
        isDragging ? "opacity-40 bg-slate-100" : isSelected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
      }`}
      style={{ paddingLeft: pl, paddingRight: "4px", cursor: "grab" }}
    >
      <FileText className="w-3 h-3 shrink-0 text-slate-400 pointer-events-none" />
      <button className="flex-1 py-1.5 text-left text-xs truncate cursor-pointer" onClick={() => onSelect(node.path)}>
        {node.name}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleInclude(node.path); }}
        title={isIncluded ? "AI 프롬프트에서 제외" : "AI 프롬프트에 포함"}
        className={`opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer transition-opacity p-0.5 ${isIncluded ? "text-emerald-500" : "text-slate-300"}`}
      >
        {isIncluded ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(node.path); }}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-red-400 hover:text-red-600 cursor-pointer transition-opacity"
        aria-label="파일 삭제"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── 파일 추가 패널 ──────────────────────────────────────────
function ImportPanel({ channel, folders, onImported, onClose }: {
  channel: ChannelKey;
  folders: FileNode[];
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
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
    const fullPath = targetFolder ? `${targetFolder}/${safeName}` : safeName;
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/channels/${channel}/files/${fullPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? "저장 실패");
      }
      onClose();
      void onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">파일 추가</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">파일에서 불러오기</label>
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFileRead} />
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4" />파일 선택 (.md / .txt)
              </button>
              {filename && <span className="text-sm text-slate-500 self-center">{filename}</span>}
            </div>
          </div>

          {folders.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">저장 위치</label>
              <select value={targetFolder} onChange={(e) => setTargetFolder(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">/ 채널 루트</option>
                {folders.map(f => <option key={f.path} value={f.path}>📁 {f.path}/</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">파일명 <span className="text-red-400">*</span></label>
            <div className="flex items-center gap-2">
              {targetFolder && <span className="text-sm text-slate-400 shrink-0">{targetFolder}/</span>}
              <input type="text" value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="guide.md" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">내용 <span className="text-red-400">*</span></label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="파일 내용을 여기에 붙여넣거나, 위에서 파일을 선택하세요..." rows={8} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
        </div>
        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 cursor-pointer">취소</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "저장 중..." : "채널에 추가"}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [githubOk, setGithubOk] = useState<boolean | null>(null);

  // 드래그 앤 드롭 상태
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const { color } = CHANNEL_COLORS[channel];
  const label = CHANNEL_LABELS[channel];
  const isDirty = content !== savedContent;
  const folders = extractFolders(tree);

  const loadChannel = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/channels/${channel}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMeta(data.meta);
      setTree(data.tree);
      setSelectedFile(prev => prev ?? findFirstFile(data.tree));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [channel]);

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
  useEffect(() => {
    fetch("/api/health").then(r => r.json()).then(d => setGithubOk(d.ok)).catch(() => setGithubOk(true));
  }, []);

  const handleSave = async () => {
    if (!isDirty || saving || !selectedFile) return;
    setSaving(true); setSaveStatus("idle");
    try {
      const res = await fetch(`/api/channels/${channel}/files/${selectedFile}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error();
      setSavedContent(content); setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch { setSaveStatus("error"); }
    finally { setSaving(false); }
  };

  const handleToggleInclude = async (filePath: string) => {
    if (!meta) return;
    const newInclude = meta.include.includes(filePath) ? meta.include.filter(p => p !== filePath) : [...meta.include, filePath];
    setMeta({ ...meta, include: newInclude });
    await fetch(`/api/channels/${channel}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include: newInclude }) });
    await loadChannel();
  };

  const handleDelete = async (filePath: string, isFolder = false) => {
    const target = isFolder ? `"${filePath}" 폴더와 그 안의 모든 파일` : `"${filePath}" 파일`;
    if (!confirm(`${target}을 삭제하시겠습니까?`)) return;
    setGlobalError(null);
    const prevTree = tree; const prevMeta = meta;
    setTree(prev => removeNodeFromTree(prev, filePath));
    if (!isFolder && selectedFile === filePath) setSelectedFile(null);
    if (!isFolder && meta?.include.includes(filePath)) setMeta(prev => prev ? { ...prev, include: prev.include.filter(p => p !== filePath) } : prev);
    const url = isFolder ? `/api/channels/${channel}/files/${filePath}?type=folder` : `/api/channels/${channel}/files/${filePath}`;
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        setTree(prevTree); setMeta(prevMeta);
        const err = await res.json().catch(() => ({ error: "삭제 실패" }));
        setGlobalError(err.error ?? "삭제에 실패했습니다.");
        return;
      }
      void loadChannel();
    } catch { setTree(prevTree); setMeta(prevMeta); setGlobalError("네트워크 오류가 발생했습니다."); }
  };

  // ─── 드래그 앤 드롭 이동 ─────────────────────────────────
  const handleFileDrop = useCallback(async (targetFolder: string) => {
    if (!draggingFile) return;
    const fileName = draggingFile.split("/").pop()!;
    const currentFolder = draggingFile.includes("/") ? draggingFile.split("/").slice(0, -1).join("/") : "";
    setDraggingFile(null);
    setDropTarget(null);
    if (currentFolder === targetFolder) return;
    const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    if (newPath === draggingFile) return;

    const sourcePath = draggingFile;
    const prevTree = tree; const prevMeta = meta;

    setTree(prev => moveNodeInTree(prev, sourcePath, newPath, targetFolder));
    if (selectedFile === sourcePath) setSelectedFile(newPath);
    if (meta?.include.includes(sourcePath)) setMeta(prev => prev ? { ...prev, include: prev.include.map(p => p === sourcePath ? newPath : p) } : prev);

    try {
      const res = await fetch(`/api/channels/${channel}/files/${sourcePath}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveTo: newPath }),
      });
      if (!res.ok) {
        setTree(prevTree); setMeta(prevMeta);
        if (selectedFile === newPath) setSelectedFile(sourcePath);
        const err = await res.json().catch(() => ({ error: "이동 실패" }));
        setGlobalError(err.error ?? "파일 이동에 실패했습니다.");
        return;
      }
      void loadChannel();
    } catch { setTree(prevTree); setMeta(prevMeta); setGlobalError("파일 이동 중 오류가 발생했습니다."); }
  }, [draggingFile, tree, meta, selectedFile, channel, loadChannel]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim().replace(/[/\\<>:"|?*]/g, "");
    if (!name) return;
    setFolderError("");
    const newFolderNode: FileNode = { name, path: name, type: "dir", included: false, children: [] };
    setTree(prev => [...prev, newFolderNode]);
    setShowNewFolder(false); setNewFolderName("");
    try {
      const res = await fetch(`/api/channels/${channel}/files/${name}/_keep`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "" }),
      });
      if (!res.ok) {
        setTree(prev => prev.filter(n => n.path !== name));
        setShowNewFolder(true); setNewFolderName(name);
        const err = await res.json().catch(() => ({ error: "폴더 생성 실패" }));
        setFolderError(err.error ?? "폴더 생성 실패");
        return;
      }
      void loadChannel();
    } catch {
      setTree(prev => prev.filter(n => n.path !== name));
      setShowNewFolder(true); setNewFolderName(name);
      setFolderError("네트워크 오류가 발생했습니다.");
    }
  };

  const dragHandlers: DragHandlers = {
    draggingFile,
    dropTarget,
    onDragStart: setDraggingFile,
    onDragEnd: () => { setDraggingFile(null); setDropTarget(null); },
    onDrop: handleFileDrop,
    setDropTarget,
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); handleSave(); }
  };

  if (loading) return (
    <div className="max-w-6xl mx-auto glass-card rounded-2xl p-8 text-center">
      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
      <span className="text-slate-500 text-sm">가이드 불러오는 중...</span>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      {showImport && <ImportPanel channel={channel} folders={folders} onImported={loadChannel} onClose={() => setShowImport(false)} />}

      {/* Top bar */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/guides" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" />가이드 목록
          </Link>
          <span className="text-slate-300">/</span>
          <span className={`font-semibold text-slate-900 ${color}`}>{label}</span>
          {isDirty && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">미저장</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            {(["edit", "split", "preview"] as const).map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${viewMode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {mode === "edit" && <><Edit3 className="w-3 h-3 inline mr-1" />편집</>}
                {mode === "split" && "분할"}
                {mode === "preview" && <><Eye className="w-3 h-3 inline mr-1" />미리보기</>}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={!isDirty || saving || !selectedFile}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {githubOk === false && (
        <div className="mb-4 flex items-start justify-between gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">GitHub 연동이 설정되지 않아 파일 저장/삭제가 불가합니다.</p>
              <p className="text-xs mt-1">상단 메뉴 <strong>API 설정</strong> → <strong>GitHub 연동</strong> 섹션에서 토큰을 입력하면 즉시 해결됩니다.</p>
            </div>
          </div>
          <Link href="/settings" className="shrink-0 text-xs font-semibold text-amber-900 underline hover:text-amber-700 whitespace-nowrap cursor-pointer">설정 바로가기 →</Link>
        </div>
      )}

      {globalError && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="shrink-0 text-red-400 hover:text-red-600 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}
      {saveStatus === "success" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle className="w-4 h-4 shrink-0" />저장 완료 — 다음 콘텐츠 생성부터 즉시 반영됩니다.
        </div>
      )}
      {saveStatus === "error" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />저장에 실패했습니다. 다시 시도해주세요.
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-4 h-[72vh]">
        {/* File sidebar */}
        <aside className="w-60 shrink-0 glass-card rounded-2xl overflow-hidden flex flex-col">
          <div className="px-3 pt-3 pb-2 border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">파일 목록</p>
            <div className="flex gap-1.5">
              <button onClick={() => setShowImport(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 cursor-pointer transition-colors">
                <FilePlus className="w-3.5 h-3.5" />파일 추가
              </button>
              <button onClick={() => { setShowNewFolder(true); setNewFolderName(""); setFolderError(""); }}
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 cursor-pointer transition-colors" title="새 폴더 만들기">
                <FolderPlus className="w-3.5 h-3.5" />폴더
              </button>
            </div>
          </div>

          {showNewFolder && (
            <div className="px-3 py-2 border-b border-slate-100 bg-amber-50">
              <p className="text-[10px] text-amber-700 font-semibold mb-1.5">새 폴더 이름</p>
              <div className="flex items-center gap-1.5">
                <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); setFolderError(""); } }}
                  placeholder="폴더명 입력" className="flex-1 text-xs px-2 py-1 rounded-lg border border-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white" autoFocus />
                <button onClick={handleCreateFolder} className="text-xs text-amber-700 font-semibold hover:text-amber-900 cursor-pointer px-1">확인</button>
                <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); setFolderError(""); }} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
              {folderError && <p className="text-[10px] text-red-600 mt-1.5">{folderError}</p>}
            </div>
          )}

          {/* 드래그 힌트 */}
          {draggingFile && (
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[10px] text-blue-600 font-medium text-center">
              폴더 위로 드래그해서 이동
            </div>
          )}

          {/* 파일 트리 + 루트 드롭 영역 */}
          <div
            className={`flex-1 overflow-y-auto py-2 transition-colors ${dropTarget === "" && draggingFile ? "bg-slate-50" : ""}`}
            onDragOver={(e) => { if (!draggingFile) return; e.preventDefault(); setDropTarget(""); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
            onDrop={(e) => { e.preventDefault(); void handleFileDrop(""); }}
          >
            {tree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">파일이 없습니다</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">파일 추가 버튼으로 시작하세요</p>
                </div>
                <button onClick={() => setShowImport(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer">
                  + 첫 파일 추가하기
                </button>
              </div>
            ) : (
              <>
                {tree.map(node => (
                  <FileTreeNode
                    key={node.path} node={node} depth={0}
                    selected={selectedFile} included={meta?.include ?? []}
                    drag={dragHandlers}
                    onSelect={setSelectedFile}
                    onToggleInclude={handleToggleInclude}
                    onDelete={handleDelete}
                  />
                ))}
                {/* 루트 드롭 힌트 */}
                {dropTarget === "" && draggingFile && (
                  <div className="mx-1 mt-1 py-2 rounded-lg border-2 border-dashed border-blue-300 text-center text-[10px] text-blue-500 font-medium">
                    여기에 놓으면 루트로 이동
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-3 py-2 border-t border-slate-100 flex items-start gap-1.5">
            <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-slate-400 leading-tight">
              파일을 드래그해서 폴더로 이동 · 호버 시 삭제 표시
            </p>
          </div>
        </aside>

        {/* Editor / Preview */}
        {selectedFile ? (
          <div className={`flex-1 grid gap-4 min-w-0 ${viewMode === "split" ? "grid-cols-2" : "grid-cols-1"}`}>
            {(viewMode === "edit" || viewMode === "split") && (
              <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Edit3 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 truncate">{selectedFile}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 ml-2">Ctrl+S 저장</span>
                </div>
                {fileLoading ? (
                  <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                ) : (
                  <textarea value={content} onChange={(e) => setContent(e.target.value)} onKeyDown={handleKeyDown}
                    className="flex-1 p-4 text-sm font-mono text-slate-800 bg-white resize-none focus:outline-none leading-relaxed" spellCheck={false} />
                )}
              </div>
            )}
            {(viewMode === "preview" || viewMode === "split") && (
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
          <div className="flex-1 glass-card rounded-2xl flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-slate-600 font-medium">파일을 선택하거나 추가하세요</p>
              <p className="text-sm text-slate-400 mt-1">왼쪽 목록에서 파일을 클릭하면 편집할 수 있습니다</p>
            </div>
            <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer">
              <FilePlus className="w-4 h-4" />파일 추가하기
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 text-center mt-3">
        파일 위치: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">data/channels/{channel}/</code>
      </p>
    </div>
  );
}
