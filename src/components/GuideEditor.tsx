"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Save, ArrowLeft, Eye, Edit3, CheckCircle, AlertCircle,
  Loader2, Trash2, FileText, ChevronRight, ChevronDown,
  Upload, X, ToggleLeft, ToggleRight, Info, FolderPlus, Folder, FilePlus,
} from "lucide-react";
import Link from "next/link";
import { CHANNEL_LABELS, CHANNEL_COLORS, type ChannelKey } from "@/lib/channels";

// ─── 타입 ──────────────────────────────────────────────────
interface FileNode {
  name: string; path: string; type: "file" | "dir";
  children?: FileNode[]; included: boolean;
}
interface ChannelMeta {
  label: string; type: "single" | "multi"; description: string;
  include: string[]; excluded_note?: string;
}

// ─── 마크다운 프리뷰 ────────────────────────────────────────
function escapeHtml(t: string) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// ─── 트리 유틸 ──────────────────────────────────────────────
function extractFolders(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) { if (n.type === "dir") { out.push(n); if (n.children) out.push(...extractFolders(n.children)); } }
  return out;
}
function removeNode(nodes: FileNode[], path: string): FileNode[] {
  return nodes.filter(n => n.path !== path).map(n => n.type === "dir" && n.children ? { ...n, children: removeNode(n.children, path) } : n);
}
function moveNode(nodes: FileNode[], src: string, dst: string, dstFolder: string): FileNode[] {
  let moved: FileNode | null = null;
  function rm(ns: FileNode[]): FileNode[] {
    return ns.reduce<FileNode[]>((a, n) => {
      if (n.path === src) moved = { ...n, path: dst, name: dst.split("/").pop()! };
      else a.push(n.type === "dir" && n.children ? { ...n, children: rm(n.children) } : n);
      return a;
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
  for (const n of nodes) { if (n.type === "file") return n.path; if (n.children) { const f = firstFile(n.children); if (f) return f; } }
  return null;
}

// ─── 파일 트리 노드 ────────────────────────────────────────
function TreeNode({ node, depth, dropOn, dragging, included, selected, onSelect, onToggle, onDelete, onPointerDown }: {
  node: FileNode; depth: number; dropOn: string | null; dragging: string | null;
  included: string[]; selected: string | null;
  onSelect(p: string): void; onToggle(p: string): void; onDelete(p: string, isDir?: boolean): void;
  onPointerDown(p: string, e: React.PointerEvent): void;
}) {
  const [open, setOpen] = useState(true);
  const pl = `${8 + depth * 16}px`;
  const isDropTarget = dropOn === node.path;
  const isDragging = dragging === node.path;

  if (node.type === "dir") {
    return (
      <div
        className={`relative rounded-xl mx-1 ${isDropTarget ? "bg-blue-50 ring-1 ring-blue-400" : ""}`}
        data-drop-folder={node.path}   /* ← 드롭 감지에 사용 */
      >
        {isDropTarget && (
          <div className="absolute inset-0 rounded-xl border-2 border-dashed border-blue-400 pointer-events-none z-10" />
        )}
        <div className={`group flex items-center gap-1 rounded-lg transition-colors ${isDropTarget ? "bg-blue-100" : "hover:bg-slate-50"}`} style={{ paddingLeft: pl, paddingRight: "4px" }}>
          <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 flex-1 py-1.5 text-left text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer">
            {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <Folder className={`w-3 h-3 shrink-0 ${isDropTarget ? "text-blue-500" : "text-amber-400"}`} />
            <span className="uppercase tracking-wider truncate">{node.name}</span>
            {isDropTarget && <span className="ml-auto text-[10px] text-blue-600 font-medium pr-1">여기에 놓기</span>}
          </button>
          {!isDropTarget && (
            <button onClick={e => { e.stopPropagation(); onDelete(node.path, true); }}
              className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 cursor-pointer transition-opacity shrink-0" title="폴더 삭제">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        {open && node.children?.map(child => (
          <TreeNode key={child.path} node={child} depth={depth + 1}
            dropOn={dropOn} dragging={dragging} included={included} selected={selected}
            onSelect={onSelect} onToggle={onToggle} onDelete={onDelete} onPointerDown={onPointerDown} />
        ))}
      </div>
    );
  }

  const isSel = selected === node.path;
  const isInc = included.includes(node.path);
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg mx-1 transition-colors select-none ${isDragging ? "opacity-30" : isSel ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"}`}
      style={{ paddingLeft: pl, paddingRight: "4px", cursor: "grab" }}
      onPointerDown={e => onPointerDown(node.path, e)}
    >
      <span className="opacity-0 group-hover:opacity-30 text-[10px] text-slate-400 pointer-events-none shrink-0">⠿</span>
      <FileText className="w-3 h-3 shrink-0 text-slate-400 pointer-events-none" />
      <button className="flex-1 py-1.5 text-left text-xs truncate cursor-pointer" onClick={() => onSelect(node.path)}>
        {node.name}
      </button>
      <button onClick={e => { e.stopPropagation(); onToggle(node.path); }}
        title={isInc ? "AI에서 제외" : "AI에 포함"}
        className={`opacity-0 group-hover:opacity-100 p-0.5 shrink-0 cursor-pointer transition-opacity ${isInc ? "text-emerald-500" : "text-slate-300"}`}>
        {isInc ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
      </button>
      <button onClick={e => { e.stopPropagation(); onDelete(node.path); }}
        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 cursor-pointer transition-opacity shrink-0" title="파일 삭제">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── 파일 타입 헬퍼 ──────────────────────────────────────────
function isTextExt(name: string) {
  return /\.(md|txt|json|csv|html|xml|js|ts|css)$/i.test(name);
}
function isImageExt(name: string) {
  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
}
function getMime(name: string) {
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return ({ png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", svg:"image/svg+xml" } as Record<string,string>)[e] ?? "application/octet-stream";
}

// ─── 파일 추가 모달 (다중 업로드 지원) ───────────────────────
interface UploadEntry {
  name: string;
  content: string;       // base64 (모든 파일 공통)
  isBase64: boolean;     // true = 바이너리, false = 텍스트
  status: "pending" | "uploading" | "ok" | "err";
  errMsg?: string;
}

function ImportModal({ channel, folders, onDone, onClose }: {
  channel: ChannelKey; folders: FileNode[]; onDone: () => Promise<void>; onClose: () => void;
}) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 모든 파일을 base64로 읽기 (텍스트/바이너리 구분 없이 통일)
  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string ?? "";
        // "data:image/png;base64,XXXX" → "XXXX"
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        setEntries(prev => [...prev, {
          name: f.name,
          content: base64,
          isBase64: true,
          status: "pending",
        }]);
      };
      reader.readAsDataURL(f); // 텍스트·바이너리 모두 base64로 통일
    });
    e.target.value = "";
  };

  const removeEntry = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i));
  const renameEntry = (i: number, name: string) => setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, name } : e));

  const addManual = () => {
    const n = manualName.trim();
    if (!n || !manualBody.trim()) return;
    const name = n.includes(".") ? n : `${n}.md`;
    // 직접 작성은 텍스트 → base64 변환
    const base64 = btoa(unescape(encodeURIComponent(manualBody)));
    setEntries(prev => [...prev, { name, content: base64, isBase64: true, status: "pending" }]);
    setManualName(""); setManualBody("");
  };

  const uploadAll = async () => {
    // 업로드할 항목 인덱스 목록을 미리 확정 (업로드 중 entries 변경 방지)
    const targets = entries
      .map((e, i) => ({ i, name: e.name, content: e.content, isBase64: e.isBase64, status: e.status }))
      .filter(e => e.status === "pending" || e.status === "err");
    if (!targets.length) return;
    setBusy(true);

    // GitHub API는 동시 커밋 시 parent 충돌 → 반드시 순차 업로드
    for (const { i, name, content, isBase64 } of targets) {
      setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, status: "uploading", errMsg: undefined } : e));
      const filePath = folder ? `${folder}/${name}` : name;
      try {
        const r = await fetch(`/api/channels/${channel}/files/${filePath}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, encoding: isBase64 ? "base64" : "utf-8" }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
        setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, status: "ok" } : e));
      } catch (err) {
        setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, status: "err", errMsg: err instanceof Error ? err.message : "실패" } : e));
      }
    }

    setBusy(false);
    void onDone(); // 성공 여부와 무관하게 트리 새로고침

    // 모두 성공했으면 자동 닫기
    setEntries(prev => {
      if (prev.every(e => e.status === "ok")) setTimeout(onClose, 600);
      return prev;
    });
  };

  const allOk = entries.length > 0 && entries.every(e => e.status === "ok");
  const hasErr = entries.some(e => e.status === "err");
  const pendingCount = entries.filter(e => e.status === "pending" || e.status === "err").length;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-slate-900">파일 추가</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* 저장 위치 */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">저장 위치 (전체 공통)</label>
            <select value={folder} onChange={e => setFolder(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">/ 채널 루트</option>
              {folders.map(f => <option key={f.path} value={f.path}>📁 {f.path}/</option>)}
            </select>
          </div>

          {/* 파일 선택 버튼 */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">파일 선택 (여러 개 동시 선택 가능)</label>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onFilesSelected} />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer w-full justify-center transition-colors">
              <Upload className="w-4 h-4" />파일 선택 (Ctrl+클릭으로 여러 개)
            </button>
          </div>

          {/* 선택된 파일 목록 */}
          {entries.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">업로드 목록 ({entries.length}개)</label>
              {entries.map((entry, i) => (
                <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${
                  entry.status === "ok" ? "border-emerald-200 bg-emerald-50" :
                  entry.status === "err" ? "border-red-200 bg-red-50" :
                  entry.status === "uploading" ? "border-blue-200 bg-blue-50" :
                  "border-slate-200 bg-slate-50"}`}>
                  {/* 상태 아이콘 */}
                  {entry.status === "ok" && <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
                  {entry.status === "err" && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                  {entry.status === "uploading" && <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />}
                  {entry.status === "pending" && <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                  {/* 파일명 편집 */}
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    {folder && <span className="text-slate-400 text-xs shrink-0">{folder}/</span>}
                    <input
                      value={entry.name}
                      onChange={e2 => renameEntry(i, e2.target.value)}
                      disabled={entry.status !== "pending" && entry.status !== "err"}
                      className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-slate-700 disabled:text-slate-500 min-w-0"
                    />
                  </div>
                  {entry.errMsg && <span className="text-xs text-red-600 shrink-0">{entry.errMsg}</span>}
                  {(entry.status === "pending" || entry.status === "err") && (
                    <button onClick={() => removeEntry(i)} className="p-0.5 text-slate-400 hover:text-red-500 cursor-pointer shrink-0"><X className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 직접 작성 */}
          <details className="group">
            <summary className="text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700">
              + 직접 작성하여 추가
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                {folder && <span className="text-sm text-slate-400 shrink-0">{folder}/</span>}
                <input type="text" value={manualName} onChange={e => setManualName(e.target.value)} placeholder="파일명.md" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <textarea value={manualBody} onChange={e => setManualBody(e.target.value)} placeholder="내용 입력..." rows={5}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              <button onClick={addManual} disabled={!manualName.trim() || !manualBody.trim()}
                className="px-4 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-40 cursor-pointer">
                목록에 추가
              </button>
            </div>
          </details>
        </div>

        <div className="px-6 pb-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-slate-400">
            {entries.length === 0 ? "파일을 선택하거나 직접 작성하세요" :
             allOk ? "✓ 모두 업로드 완료" :
             hasErr ? "일부 실패 — 재시도 가능" :
             `${pendingCount}개 업로드 대기 중`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 cursor-pointer">
              {allOk ? "닫기" : "취소"}
            </button>
            {!allOk && (
              <button onClick={uploadAll} disabled={busy || pendingCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 cursor-pointer">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? "업로드 중..." : `${pendingCount}개 업로드`}
              </button>
            )}
          </div>
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
  const [content, setContent] = useState(""); const [saved, setSaved] = useState("");
  const [fileEncoding, setFileEncoding] = useState<"utf-8" | "base64">("utf-8");
  const [fileMime, setFileMime] = useState<string>("text/plain");
  const [loading, setLoading] = useState(true); const [fileBusy, setFileBusy] = useState(false);
  const [saving, setSaving] = useState(false); const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const [view, setView] = useState<"edit" | "split" | "preview">("split");
  const [showAdd, setShowAdd] = useState(false); const [showFolder, setShowFolder] = useState(false);
  const [folderName, setFolderName] = useState(""); const [folderErr, setFolderErr] = useState("");
  const [globalErr, setGlobalErr] = useState<string | null>(null);
  const [ghOk, setGhOk] = useState<boolean | null>(null);

  // 드래그 시각 상태
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  // execMove를 ref로 보관 → 포인터 이벤트 클로저에서 항상 최신 버전 사용
  const execMoveRef = useRef<(src: string, dst: string) => Promise<void>>(async () => {});

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
    } catch { } finally { setLoading(false); }
  }, [channel]);

  const loadFile = useCallback(async (p: string) => {
    setFileBusy(true);
    try {
      const r = await fetch(`/api/channels/${channel}/files/${p}`);
      const d = await r.json();
      const enc: "utf-8" | "base64" = d.encoding === "base64" ? "base64" : "utf-8";
      setContent(d.content ?? "");
      setSaved(d.content ?? "");
      setFileEncoding(enc);
      setFileMime(d.mimeType ?? "text/plain");
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
      const r = await fetch(`/api/channels/${channel}/files/${selected}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!r.ok) throw new Error();
      setSaved(content); setSaveStatus("ok"); setTimeout(() => setSaveStatus("idle"), 3000);
    } catch { setSaveStatus("err"); } finally { setSaving(false); }
  };

  // ─── 토글 ────────────────────────────────────────────────
  const handleToggle = async (fp: string) => {
    if (!meta) return;
    const inc = meta.include.includes(fp) ? meta.include.filter(p => p !== fp) : [...meta.include, fp];
    setMeta({ ...meta, include: inc });
    await fetch(`/api/channels/${channel}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include: inc }) }).catch(() => {});
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
      const r = await fetch(`/api/channels/${channel}/files/${n}/_keep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "" }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "폴더 생성 실패"); }
      void reload();
    } catch (e) {
      setTree(p => p.filter(x => x.path !== n)); setShowFolder(true); setFolderName(n);
      setFolderErr(e instanceof Error ? e.message : "폴더 생성 실패");
    }
  };

  // ─── 파일 이동 ───────────────────────────────────────────
  const execMove = useCallback(async (src: string, targetFolder: string) => {
    const currentFolder = src.includes("/") ? src.split("/").slice(0, -1).join("/") : "";
    if (currentFolder === targetFolder) return;

    const fileName = src.split("/").pop()!;
    const dst = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    if (dst === src) return;

    const snapTree = tree; const snapMeta = meta; const snapSel = selected;
    setTree(prev => moveNode(prev, src, dst, targetFolder));
    if (selected === src) setSelected(dst);
    if (meta?.include.includes(src)) setMeta(p => p ? { ...p, include: p.include.map(x => x === src ? dst : x) } : p);

    try {
      const r = await fetch(`/api/channels/${channel}/files/${src}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveTo: dst }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `서버 오류 (${r.status})`); }
      void reload();
    } catch (e) {
      setTree(snapTree); setMeta(snapMeta); setSelected(snapSel);
      setGlobalErr(e instanceof Error ? e.message : "파일 이동 실패");
    }
  }, [channel, tree, meta, selected, reload]);

  // ref 최신화 (포인터 클로저에서 사용)
  useEffect(() => { execMoveRef.current = execMove; }, [execMove]);

  // ─── 포인터 기반 드래그 앤 드롭 ─────────────────────────
  // HTML5 DnD를 완전히 사용하지 않음. pointermove + elementFromPoint로 직접 구현.

  const startDrag = useCallback((filePath: string, e: React.PointerEvent) => {
    // 버튼 클릭 시 드래그 시작 방지
    if ((e.target as HTMLElement).closest("button")) return;

    e.preventDefault(); // 텍스트 선택 방지

    setDragging(filePath);

    // 고스트 엘리먼트 생성 (커서를 따라다님)
    const ghost = document.createElement("div");
    ghost.textContent = "📄 " + filePath.split("/").pop();
    ghost.style.cssText = [
      "position:fixed", "pointer-events:none", "z-index:9999",
      "background:white", "border:1.5px solid #3b82f6", "border-radius:10px",
      "padding:5px 12px", "font-size:12px", "font-weight:500", "color:#1e40af",
      "box-shadow:0 4px 20px rgba(59,130,246,0.3)", "white-space:nowrap",
      "transform:translate(-50%,-50%)", "transition:none",
    ].join(";");
    ghost.style.left = e.clientX + "px";
    ghost.style.top = e.clientY + "px";
    document.body.appendChild(ghost);

    const onMove = (pe: PointerEvent) => {
      // 고스트 이동
      ghost.style.left = pe.clientX + "px";
      ghost.style.top = pe.clientY + "px";

      // 고스트 임시 숨기고 → 아래 요소 찾기 → 다시 보이기
      ghost.style.display = "none";
      const el = document.elementFromPoint(pe.clientX, pe.clientY);
      ghost.style.display = "";

      // data-drop-folder 속성을 가진 가장 가까운 조상 탐색
      const target = el?.closest("[data-drop-folder]");
      const folder = target ? target.getAttribute("data-drop-folder") : null;
      setDropOn(folder);
    };

    const onUp = (pe: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKeyDown);
      ghost.remove();
      setDragging(null);
      setDropOn(null);

      // 최종 드롭 위치 계산
      ghost.style.display = "none";
      const el = document.elementFromPoint(pe.clientX, pe.clientY);
      const target = el?.closest("[data-drop-folder]");
      const targetFolder = target ? target.getAttribute("data-drop-folder") : null;

      if (targetFolder !== null) {
        void execMoveRef.current(filePath, targetFolder);
      }
    };

    const onKeyDown = (ke: KeyboardEvent) => {
      if (ke.key === "Escape") {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("keydown", onKeyDown);
        ghost.remove();
        setDragging(null);
        setDropOn(null);
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKeyDown);
  }, []);

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

      {/* 배너 */}
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
      {saveStatus === "ok" && <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3"><CheckCircle className="w-4 h-4 shrink-0" />저장 완료</div>}
      {saveStatus === "err" && <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" />저장 실패. 다시 시도해주세요.</div>}

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

          {dragging && (
            <div className="px-3 py-1 bg-blue-50 border-b border-blue-100 text-[10px] text-blue-600 font-medium text-center">
              폴더 위에 놓아 이동 · 빈 공간에 놓으면 루트로
            </div>
          )}

          {/* 파일 트리 — data-drop-folder="" 로 루트 드롭 존 지정 */}
          <div
            className={`flex-1 overflow-y-auto py-2 transition-colors ${dropOn === "" && dragging ? "bg-blue-50/30" : ""}`}
            data-drop-folder=""   /* ← 루트 드롭 존 */
          >
            {tree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-slate-400" />
                </div>
                <p className="text-xs font-medium text-slate-500">파일이 없습니다</p>
                <button onClick={() => setShowAdd(true)} className="text-xs text-blue-600 font-medium underline cursor-pointer">+ 첫 파일 추가하기</button>
              </div>
            ) : (
              <>
                {tree.map(n => (
                  <TreeNode key={n.path} node={n} depth={0}
                    dropOn={dropOn} dragging={dragging} included={meta?.include ?? []} selected={selected}
                    onSelect={setSelected} onToggle={handleToggle} onDelete={handleDelete}
                    onPointerDown={startDrag} />
                ))}
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
            <p className="text-[10px] text-slate-400 leading-tight">파일을 길게 눌러 드래그 · 호버 시 삭제 버튼 표시</p>
          </div>
        </aside>

        {/* 에디터 */}
        {selected ? (
          fileEncoding === "base64" ? (
            /* ── 바이너리 파일 뷰어 ── */
            <div className="flex-1 glass-card rounded-2xl overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs font-medium text-slate-700 truncate">{selected}</span>
                <span className="text-xs text-slate-400 ml-auto">{fileMime}</span>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 gap-4">
                {fileBusy ? (
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                ) : isImageExt(selected) && content ? (
                  /* 이미지 미리보기 */
                  <img
                    src={`data:${getMime(selected)};base64,${content}`}
                    alt={selected}
                    className="max-w-full max-h-[50vh] object-contain rounded-xl shadow-md"
                  />
                ) : (
                  /* 기타 바이너리 */
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-200 flex items-center justify-center">
                      <FileText className="w-7 h-7 text-slate-500" />
                    </div>
                    <p className="font-medium text-slate-700">{selected.split("/").pop()}</p>
                    <p className="text-sm text-slate-400">{fileMime}</p>
                  </div>
                )}
                {content && (
                  <a
                    href={`data:${fileMime};base64,${content}`}
                    download={selected.split("/").pop()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-900 cursor-pointer"
                  >
                    다운로드
                  </a>
                )}
              </div>
            </div>
          ) : (
          /* ── 텍스트 에디터 ── */
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
          )
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
