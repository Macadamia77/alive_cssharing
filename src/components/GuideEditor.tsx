"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Save, ArrowLeft, Eye, Edit3, CheckCircle, AlertCircle,
  Loader2, Trash2, FileText, ChevronRight, ChevronDown,
  Upload, X, ToggleLeft, ToggleRight, Info, FolderPlus, Folder, FilePlus,
} from "lucide-react";
import Link from "next/link";
import { CHANNEL_LABELS, CHANNEL_COLORS, type ChannelKey } from "@/lib/channels";

// ─── 모듈 변수로 드래그 소스 추적 (React state 타이밍 우회) ───
// React state는 비동기 → onDrop 시점에 값 보장 불가
// 모듈 변수는 동기 → dragstart에서 쓰고 drop에서 즉시 읽을 수 있음
let _dragSrc: string | null = null;

// ─── 타입 ──────────────────────────────────────────────────
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
function formatInline(t: string) {
  return t
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs font-mono">$1</code>');
}
function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="space-y-1 text-slate-700 text-sm leading-relaxed">
      {content.split("\n").map((line, i) => {
        if (line.startsWith("# ")) return <h1 key={i} className="text-lg font-bold text-slate-900 mt-3 mb-1">{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold text-slate-800 mt-3 mb-1 border-b border-slate-200 pb-1">{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold text-slate-800 mt-2 mb-1">{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} className="flex gap-2"><span className="text-blue-500 shrink-0">•</span><span dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} /></div>;
        if (/^\d+\.\s/.test(line)) { const m = line.match(/^(\d+)\.\s(.+)/); if (m) return <div key={i} className="flex gap-2"><span className="text-blue-600 font-semibold shrink-0">{m[1]}.</span><span dangerouslySetInnerHTML={{ __html: formatInline(m[2]) }} /></div>; }
        if (line.startsWith("> ")) return <blockquote key={i} className="border-l-2 border-blue-300 pl-3 text-slate-600 italic">{line.slice(2)}</blockquote>;
        if (line === "") return <div key={i} className="h-2" />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />;
      })}
    </div>
  );
}

// ─── 트리 유틸 ──────────────────────────────────────────────
function extractFolders(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    if (n.type !== "dir") continue;
    out.push(n);
    if (n.children) out.push(...extractFolders(n.children));
  }
  return out;
}
function removeNode(nodes: FileNode[], path: string): FileNode[] {
  return nodes
    .filter(n => n.path !== path)
    .map(n => n.type === "dir" && n.children ? { ...n, children: removeNode(n.children, path) } : n);
}
function moveNode(nodes: FileNode[], src: string, dst: string, dstFolder: string): FileNode[] {
  let moved: FileNode | null = null;
  function rm(ns: FileNode[]): FileNode[] {
    return ns.reduce<FileNode[]>((acc, n) => {
      if (n.path === src) { moved = { ...n, path: dst, name: dst.split("/").pop()! }; }
      else acc.push(n.type === "dir" && n.children ? { ...n, children: rm(n.children) } : n);
      return acc;
    }, []);
  }
  const without = rm(nodes);
  if (!moved) return nodes;
  if (!dstFolder) return [...without, moved];
  function ins(ns: FileNode[]): FileNode[] {
    return ns.map(n => {
      if (n.path === dstFolder && n.type === "dir") return { ...n, children: [...(n.children ?? []), moved!] };
      if (n.type === "dir" && n.children) return { ...n, children: ins(n.children) };
      return n;
    });
  }
  return ins(without);
}
function firstFile(nodes: FileNode[]): string | null {
  for (const n of nodes) {
    if (n.type === "file") return n.path;
    if (n.children) { const f = firstFile(n.children); if (f) return f; }
  }
  return null;
}

// ─── 파일 트리 노드 ────────────────────────────────────────
interface NodeCbs {
  dragging: string | null;
  dropOn: string | null;
  included: string[];
  selected: string | null;
  onSelect(p: string): void;
  onToggle(p: string): void;
  onDelete(p: string, isDir?: boolean): void;
  onDragStart(p: string, e: React.DragEvent): void;
  onDragEnd(): void;
  setDropOn(p: string | null): void;
  onDrop(targetFolder: string, src: string): void;
}

function TreeNode({ node, depth, cb }: { node: FileNode; depth: number; cb: NodeCbs }) {
  const [open, setOpen] = useState(true);
  const pl = `${8 + depth * 16}px`;
  const isDropTarget = cb.dropOn === node.path;
  const isDragging = cb.dragging === node.path;

  if (node.type === "dir") {
    return (
      <div
        className={`relative rounded-xl mx-1 ${isDropTarget ? "bg-blue-50" : ""}`}
        onDragOver={(e) => {
          // e.preventDefault()는 조건 없이 항상 호출 → 이게 없으면 onDrop이 절대 안 됨
          e.preventDefault();
          e.stopPropagation();
          cb.setDropOn(node.path); // 시각 피드백
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            cb.setDropOn(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // _dragSrc(모듈 변수)를 우선, 없으면 dataTransfer에서 백업
          const src = _dragSrc || e.dataTransfer.getData("text/plain");
          _dragSrc = null;
          if (src) cb.onDrop(node.path, src);
        }}
      >
        {/* 드롭 테두리 */}
        {isDropTarget && (
          <div className="absolute inset-0 rounded-xl border-2 border-dashed border-blue-400 pointer-events-none z-10" />
        )}

        {/* 헤더 */}
        <div
          className={`group flex items-center gap-1 rounded-lg transition-colors ${isDropTarget ? "bg-blue-100" : "hover:bg-slate-50"}`}
          style={{ paddingLeft: pl, paddingRight: "4px" }}
        >
          <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 flex-1 py-1.5 text-left text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer">
            {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <Folder className={`w-3 h-3 shrink-0 ${isDropTarget ? "text-blue-500" : "text-amber-400"}`} />
            <span className="uppercase tracking-wider truncate">{node.name}</span>
            {isDropTarget && <span className="ml-auto text-[10px] text-blue-600 font-medium pr-1">여기에 놓기</span>}
          </button>
          {!isDropTarget && (
            <button
              onClick={(e) => { e.stopPropagation(); cb.onDelete(node.path, true); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 cursor-pointer transition-opacity shrink-0"
              title="폴더 삭제"
            ><Trash2 className="w-3 h-3" /></button>
          )}
        </div>

        {open && node.children?.map(child => (
          <TreeNode key={child.path} node={child} depth={depth + 1} cb={cb} />
        ))}
      </div>
    );
  }

  // 파일
  const isSel = cb.selected === node.path;
  const isInc = cb.included.includes(node.path);
  return (
    <div
      draggable
      onDragStart={(e) => cb.onDragStart(node.path, e)}
      onDragEnd={cb.onDragEnd}
      className={`group flex items-center gap-1 rounded-lg mx-1 transition-colors duration-100 select-none ${
        isDragging ? "opacity-25" : isSel ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
      }`}
      style={{ paddingLeft: pl, paddingRight: "4px", cursor: "grab" }}
    >
      <span className="opacity-0 group-hover:opacity-30 text-[10px] text-slate-400 pointer-events-none shrink-0">⠿</span>
      <FileText className="w-3 h-3 shrink-0 text-slate-400 pointer-events-none" />
      <button className="flex-1 py-1.5 text-left text-xs truncate cursor-pointer" onClick={() => cb.onSelect(node.path)}>
        {node.name}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); cb.onToggle(node.path); }}
        onMouseDown={(e) => e.stopPropagation()}
        title={isInc ? "AI에서 제외" : "AI에 포함"}
        className={`opacity-0 group-hover:opacity-100 p-0.5 shrink-0 cursor-pointer transition-opacity ${isInc ? "text-emerald-500" : "text-slate-300"}`}
      >
        {isInc ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); cb.onDelete(node.path); }}
        onMouseDown={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 cursor-pointer transition-opacity shrink-0"
        title="파일 삭제"
      ><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}

// ─── 파일 추가 모달 ──────────────────────────────────────────
function ImportModal({ channel, folders, onDone, onClose }: {
  channel: ChannelKey; folders: FileNode[]; onDone: () => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setName(f.name);
    const r = new FileReader(); r.onload = ev => setBody(ev.target?.result as string ?? ""); r.readAsText(f, "utf-8");
  };

  const save = async () => {
    const n = name.trim(); if (!n || !body.trim()) { setErr("파일명과 내용을 입력해주세요."); return; }
    const safe = n.endsWith(".md") ? n : `${n}.md`;
    const path = folder ? `${folder}/${safe}` : safe;
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/channels/${channel}/files/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: body }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      onClose(); void onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "저장 실패"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">파일 추가</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">파일에서 불러오기</label>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept=".md,.txt" className="hidden" onChange={readFile} />
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4" />파일 선택
              </button>
              {name && <span className="text-sm text-slate-500 self-center truncate">{name}</span>}
            </div>
          </div>
          {folders.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">저장 위치</label>
              <select value={folder} onChange={e => setFolder(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">/ 채널 루트</option>
                {folders.map(f => <option key={f.path} value={f.path}>📁 {f.path}/</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">파일명 *</label>
            <div className="flex items-center gap-2">
              {folder && <span className="text-sm text-slate-400 shrink-0">{folder}/</span>}
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="guide.md" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">내용 *</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="내용을 입력하거나 파일을 선택하세요..." rows={8} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          {err && <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2"><AlertCircle className="w-4 h-4 shrink-0" />{err}</div>}
        </div>
        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 cursor-pointer">취소</button>
          <button onClick={save} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "저장 중..." : "채널에 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────
export default function GuideEditor({ channel }: { channel: ChannelKey }) {
  const [meta, setMeta] = useState<ChannelMeta | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [fileBusy, setFileBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const [view, setView] = useState<"edit" | "split" | "preview">("split");
  const [showAdd, setShowAdd] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderErr, setFolderErr] = useState("");
  const [globalErr, setGlobalErr] = useState<string | null>(null);
  const [ghOk, setGhOk] = useState<boolean | null>(null);

  // DnD 시각 상태 (로직은 _dragSrc 모듈 변수 사용)
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const { color } = CHANNEL_COLORS[channel];
  const label = CHANNEL_LABELS[channel];
  const dirty = content !== saved;
  const folders = extractFolders(tree);

  // ─── 데이터 ──────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/channels/${channel}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setMeta(d.meta); setTree(d.tree);
      setSelected(prev => prev ?? firstFile(d.tree));
    } catch { /* silent */ } finally { setLoading(false); }
  }, [channel]);

  const loadFile = useCallback(async (p: string) => {
    setFileBusy(true);
    try {
      const r = await fetch(`/api/channels/${channel}/files/${p}`);
      const d = await r.json();
      setContent(d.content ?? ""); setSaved(d.content ?? "");
    } catch { setContent(""); setSaved(""); } finally { setFileBusy(false); }
  }, [channel]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (selected) void loadFile(selected); }, [selected, loadFile]);
  useEffect(() => {
    fetch("/api/health").then(r => r.json()).then(d => setGhOk(!!d.ok)).catch(() => setGhOk(true));
  }, []);

  // ─── 저장 ────────────────────────────────────────────────
  const handleSave = async () => {
    if (!dirty || saving || !selected) return;
    setSaving(true); setSaveStatus("idle");
    try {
      const r = await fetch(`/api/channels/${channel}/files/${selected}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error();
      setSaved(content); setSaveStatus("ok");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch { setSaveStatus("err"); } finally { setSaving(false); }
  };

  // ─── 토글 ────────────────────────────────────────────────
  const handleToggle = async (fp: string) => {
    if (!meta) return;
    const newInc = meta.include.includes(fp) ? meta.include.filter(p => p !== fp) : [...meta.include, fp];
    setMeta({ ...meta, include: newInc });
    await fetch(`/api/channels/${channel}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include: newInc }) }).catch(() => {});
    void reload();
  };

  // ─── 삭제 ────────────────────────────────────────────────
  const handleDelete = async (fp: string, isDir = false) => {
    if (!confirm(`"${fp}"${isDir ? " 폴더와 그 안의 모든 파일" : " 파일"}을 삭제하시겠습니까?`)) return;
    setGlobalErr(null);
    const prevTree = tree; const prevMeta = meta;
    setTree(prev => removeNode(prev, fp));
    if (!isDir && selected === fp) setSelected(null);
    if (!isDir && meta?.include.includes(fp)) setMeta(p => p ? { ...p, include: p.include.filter(x => x !== fp) } : p);
    try {
      const url = isDir ? `/api/channels/${channel}/files/${fp}?type=folder` : `/api/channels/${channel}/files/${fp}`;
      const r = await fetch(url, { method: "DELETE" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "삭제 실패"); }
      void reload();
    } catch (e) { setTree(prevTree); setMeta(prevMeta); setGlobalErr(e instanceof Error ? e.message : "삭제 실패"); }
  };

  // ─── 폴더 생성 ───────────────────────────────────────────
  const handleCreateFolder = async () => {
    const n = folderName.trim().replace(/[/\\<>:"|?*]/g, "");
    if (!n) return;
    setFolderErr(""); setShowFolder(false); setFolderName("");
    const node: FileNode = { name: n, path: n, type: "dir", included: false, children: [] };
    setTree(p => [...p, node]);
    try {
      const r = await fetch(`/api/channels/${channel}/files/${n}/_keep`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "" }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "폴더 생성 실패"); }
      void reload();
    } catch (e) {
      setTree(p => p.filter(x => x.path !== n));
      setShowFolder(true); setFolderName(n);
      setFolderErr(e instanceof Error ? e.message : "폴더 생성 실패");
    }
  };

  // ─── 드래그 앤 드롭 ────────────────────────────────────────
  // _dragSrc(모듈 변수)에 소스 경로 저장 → React state 타이밍 완전 우회

  const onDragStart = useCallback((fp: string, e: React.DragEvent) => {
    _dragSrc = fp;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", fp);
    setDragging(fp);
  }, []);

  const onDragEnd = useCallback(() => {
    _dragSrc = null;
    setDragging(null);
    setDropOn(null);
  }, []);

  // 실제 이동 실행 - src와 targetFolder를 직접 인수로 받음
  const execMove = useCallback(async (src: string, targetFolder: string) => {
    const currentFolder = src.includes("/") ? src.split("/").slice(0, -1).join("/") : "";
    if (currentFolder === targetFolder) return;

    const fileName = src.split("/").pop()!;
    const dst = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    if (dst === src) return;

    // 낙관적 업데이트
    const snapTree = tree; const snapMeta = meta; const snapSel = selected;
    setTree(prev => moveNode(prev, src, dst, targetFolder));
    if (selected === src) setSelected(dst);
    if (meta?.include.includes(src)) setMeta(p => p ? { ...p, include: p.include.map(x => x === src ? dst : x) } : p);

    try {
      const r = await fetch(`/api/channels/${channel}/files/${src}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveTo: dst }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `서버 오류 (${r.status})`);
      }
      void reload();
    } catch (e) {
      // 롤백
      setTree(snapTree); setMeta(snapMeta); setSelected(snapSel);
      setGlobalErr(e instanceof Error ? e.message : "파일 이동 실패");
    }
  }, [channel, tree, meta, selected, reload]);

  // 폴더 위에 드롭될 때 호출 - src는 TreeNode의 onDrop에서 직접 전달
  const onDropOnFolder = useCallback((targetFolder: string, src: string) => {
    setDragging(null);
    setDropOn(null);
    if (src) void execMove(src, targetFolder);
  }, [execMove]);

  const cb: NodeCbs = {
    dragging, dropOn, included: meta?.include ?? [], selected,
    onSelect: setSelected, onToggle: handleToggle, onDelete: handleDelete,
    onDragStart, onDragEnd, setDropOn,
    onDrop: onDropOnFolder,
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void handleSave(); }
  };

  if (loading) return (
    <div className="max-w-6xl mx-auto glass-card rounded-2xl p-8 text-center">
      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
      <span className="text-slate-500 text-sm">불러오는 중...</span>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      {showAdd && <ImportModal channel={channel} folders={folders} onDone={reload} onClose={() => setShowAdd(false)} />}

      {/* 상단 */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/guides" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 cursor-pointer">
            <ArrowLeft className="w-4 h-4" />가이드 목록
          </Link>
          <span className="text-slate-300">/</span>
          <span className={`font-semibold text-slate-900 ${color}`}>{label}</span>
          {dirty && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">미저장</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            {(["edit", "split", "preview"] as const).map(m => (
              <button key={m} onClick={() => setView(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${view === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
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

      {/* 배너들 */}
      {ghOk === false && (
        <div className="mb-4 flex items-start justify-between gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div><p className="font-semibold">GitHub 연동 미설정 — 파일 저장/이동/삭제 불가</p>
              <p className="text-xs mt-1">API 설정 → GitHub 연동에서 토큰을 입력하세요.</p></div>
          </div>
          <Link href="/settings" className="text-xs font-semibold underline whitespace-nowrap cursor-pointer">설정 →</Link>
        </div>
      )}
      {globalErr && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /><span className="flex-1">{globalErr}</span>
          <button onClick={() => setGlobalErr(null)} className="text-red-400 hover:text-red-600 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}
      {saveStatus === "ok" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle className="w-4 h-4 shrink-0" />저장 완료
        </div>
      )}
      {saveStatus === "err" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />저장 실패. 다시 시도해주세요.
        </div>
      )}

      {/* 본문 */}
      <div className="flex gap-4 h-[72vh]">

        {/* 사이드바 */}
        <aside className="w-60 shrink-0 glass-card rounded-2xl overflow-hidden flex flex-col">
          <div className="px-3 pt-3 pb-2 border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">파일 목록</p>
            <div className="flex gap-1.5">
              <button onClick={() => setShowAdd(true)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 cursor-pointer">
                <FilePlus className="w-3.5 h-3.5" />파일 추가
              </button>
              <button onClick={() => { setShowFolder(true); setFolderName(""); setFolderErr(""); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 cursor-pointer" title="새 폴더">
                <FolderPlus className="w-3.5 h-3.5" />폴더
              </button>
            </div>
          </div>

          {showFolder && (
            <div className="px-3 py-2 border-b border-slate-100 bg-amber-50">
              <p className="text-[10px] text-amber-700 font-semibold mb-1.5">새 폴더 이름</p>
              <div className="flex items-center gap-1.5">
                <input type="text" value={folderName} onChange={e => setFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void handleCreateFolder(); if (e.key === "Escape") setShowFolder(false); }}
                  placeholder="폴더명" className="flex-1 text-xs px-2 py-1 rounded-lg border border-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white" autoFocus />
                <button onClick={() => void handleCreateFolder()} className="text-xs text-amber-700 font-semibold cursor-pointer px-1">확인</button>
                <button onClick={() => setShowFolder(false)} className="text-slate-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
              {folderErr && <p className="text-[10px] text-red-600 mt-1">{folderErr}</p>}
            </div>
          )}

          {/* 드래그 힌트 배너 */}
          {dragging && (
            <div className="px-3 py-1 bg-blue-50 border-b border-blue-100 text-[10px] text-blue-600 font-medium text-center">
              폴더 위에 놓아 이동 · 아래 빈 공간에 놓으면 루트로
            </div>
          )}

          {/* 파일 트리 + 루트 드롭 존 */}
          <div
            className={`flex-1 overflow-y-auto py-2 transition-colors ${dropOn === "" && dragging ? "bg-blue-50/50" : ""}`}
            onDragOver={(e) => {
              // 폴더가 stopPropagation → 여기 도달 = 빈 공간 = 루트 드롭 존
              e.preventDefault(); // 조건 없이 호출 필수
              setDropOn("");
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const src = _dragSrc || e.dataTransfer.getData("text/plain");
              _dragSrc = null;
              setDragging(null);
              setDropOn(null);
              if (src) void execMove(src, "");
            }}
          >
            {tree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-slate-400" />
                </div>
                <p className="text-xs font-medium text-slate-500">파일이 없습니다</p>
                <button onClick={() => setShowAdd(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer">+ 첫 파일 추가하기</button>
              </div>
            ) : (
              <>
                {tree.map(n => <TreeNode key={n.path} node={n} depth={0} cb={cb} />)}
                {dropOn === "" && dragging && (
                  <div className="mx-2 mt-1 py-2 rounded-lg border-2 border-dashed border-blue-300 text-center text-[10px] text-blue-500 font-medium">
                    여기에 놓으면 루트로 이동
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-3 py-2 border-t border-slate-100 flex items-start gap-1.5">
            <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-slate-400 leading-tight">파일을 잡아 폴더로 드래그 · 호버 시 삭제 버튼 표시</p>
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
                    <span className="text-xs font-medium text-slate-700 truncate">{selected}</span>
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
          <div className="flex-1 glass-card rounded-2xl flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-slate-600 font-medium">파일을 선택하거나 추가하세요</p>
              <p className="text-sm text-slate-400 mt-1">왼쪽 목록에서 파일을 클릭하면 편집할 수 있습니다</p>
            </div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer">
              <FilePlus className="w-4 h-4" />파일 추가하기
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 text-center mt-3">
        저장 위치: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">data/channels/{channel}/</code>
      </p>
    </div>
  );
}
