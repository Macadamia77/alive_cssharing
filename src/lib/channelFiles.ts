import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { type ChannelKey, CHANNELS } from "./channels";
import { githubRead, githubReadBase64, githubListDir } from "./githubStorage";
import {
  sbConfigured, sbReadAllFiles, sbWriteFile, sbDeleteFile, sbDeletePrefix, type SbFile,
} from "./supabaseChannelFiles";
import type { StageOverride } from "./pipeline/types";

import { existsSync } from "fs";

let rootDir = process.cwd();
if (!existsSync(path.join(rootDir, "data")) && existsSync(path.join(rootDir, "..", "data"))) {
  rootDir = path.join(rootDir, "..");
}
const CHANNEL_DIR = path.join(rootDir, "data", "channels");

// ─── Supabase 채널 파일 인메모리 캐시 ───────────────────────────────
// loadAllGuides/loadPersona가 한 채널(혹은 _shared)의 가이드·페르소나 파일을 파일당 1건씩
// 순차 조회하던 것을(생성 1회당 15~25 왕복) 채널당 단 1회의 전체 조회로 묶는다.
// 쓰기(write/delete) 시 해당 채널 캐시를 즉시 비워, "웹에서 편집하면 재배포 없이 다음
// 생성부터 반영"이라는 기존 실시간성 요구사항은 그대로 유지한다.
const channelFileCache = new Map<string, Promise<Map<string, SbFile>>>();

function getChannelFilesCached(channel: string): Promise<Map<string, SbFile>> {
  let cached = channelFileCache.get(channel);
  if (!cached) {
    cached = sbReadAllFiles(channel);
    channelFileCache.set(channel, cached);
    cached.catch(() => channelFileCache.delete(channel));
  }
  return cached;
}

function invalidateChannelFilesCache(channel: string): void {
  channelFileCache.delete(channel);
}

export interface ChannelMeta {
  label: string;
  type: "single" | "multi";
  description: string;
  include: string[];
  excluded_note?: string;
  // ⑤ 생성 튜닝 (선택 — 없으면 코드 기본값 사용)
  maxTokens?: number;        // 응답 최대 길이 (기본 4096)
  disableThinking?: boolean; // Gemini thinking 비활성화 (JSON 구조화 채널용)
  imageCards?: boolean;      // 이미지 카드 가이드 포함 여부 (기본 true, JSON 채널은 false)
  // ④ 파이프라인 가이드 선택/순서 (선택 — 파이프라인 채널용)
  researchGuides?: string[]; // 리서치 단계에 넣을 guide 파일 키 목록
  writeOrder?: string[];     // 글쓰기 단계 guide 배치 순서 (뒤일수록 LLM이 더 주목)
  // 통합 파이프라인 엔진용 (선택)
  engine?: "pipeline" | "legacy"; // "pipeline"이면 통합 엔진(runPipeline) 사용. 없으면 기존 경로.
  /** true면 이 채널은 composition.json(조립표)으로 단계를 구성한다. 이 플래그가 있을 때만
   *  runPipeline이 composition.json을 조회하므로, 미사용 채널은 불필요한 파일 조회(GitHub 404 등)를 피한다. */
  useComposition?: boolean;
  outputFormat?: "html" | "text" | "json"; // 최종 결과물 형식 (기본 text)
  /** 이미지 카드 색 테마 키(cardTemplateBuilder의 THEMES). 없으면 "naver"(네이버 무영향). */
  imageTheme?: "naver" | "linkedin";
  /** 첫 [IMAGE:] 마커를 720×720 커버 썸네일로 만들지. 없으면 true(네이버 기존 동작). false면
   *  모든 마커를 일반 본문 카드로 취급(링크드인 — 마스코트 커버는 네이버 블로그 관습). */
  imageCoverThumbnail?: boolean;
  /** [IMAGE:] 마커가 0개일 때, 완성된 draft에서 image-maker가 직접 카드를 생성할지. 없으면 false
   *  (마커 없으면 건너뜀 = 네이버 기존 동작). true면 마커 부재 시 draft 전체 기반으로 카드 자동 생성
   *  (링크드인 — writer가 마커를 안 찍거나 리뷰어가 지워도 카드가 나오게 하는 폴백). */
  imageAutoGenerate?: boolean;
  /** imageAutoGenerate 시 만들 카드 장수. 없으면 2. */
  imageAutoCount?: number;
  model?: string;            // 채널 기본 provider ("claude"|"openai"|"gemini")
  modelId?: string;          // 채널 기본 모델 id
  /** 단계별 토글·오버라이드. 키 = stage id (예: { "writer": { "enabled": true } }) */
  // types.ts의 StageOverride를 그대로 재사용(중복 정의 금지 — 필드 하나 늘 때 한쪽만 고치고
  // 잊어버리는 사고가 실제로 있었음: modelIdByProvider가 여기 안 늘어서 조용히 무시됐었다).
  pipeline?: Record<string, StageOverride>;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  included: boolean;
}

export function isTextFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ["md", "txt", "json", "csv", "html", "xml", "js", "ts", "css"].includes(ext);
}

// 평탄한 경로 목록(Supabase) → 중첩 FileNode 트리. "_"로 시작하는 세그먼트는 제외(시스템 파일).
function buildTreeFromPaths(paths: string[], include: string[]): FileNode[] {
  const root: FileNode[] = [];
  for (const p of [...paths].sort()) {
    if (p.split("/").some(seg => seg.startsWith("_"))) continue;
    const parts = p.split("/");
    let level = root;
    let cur = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      cur = cur ? `${cur}/${name}` : name;
      const isFile = i === parts.length - 1;
      let node = level.find(n => n.name === name);
      if (!node) {
        node = isFile
          ? { name, path: cur, type: "file", included: include.includes(cur) }
          : { name, path: cur, type: "dir", included: false, children: [] };
        level.push(node);
      }
      if (!isFile) level = node.children!;
    }
  }
  return root;
}

export async function getChannelMeta(channel: ChannelKey, token?: string): Promise<ChannelMeta> {
  // 1순위: Supabase (실시간 단일 소스). 실패/미설정 시 GitHub → 로컬 번들로 폴백.
  if (sbConfigured()) {
    try {
      const files = await getChannelFilesCached(channel);
      const f = files.get("_meta.json");
      if (f) {
        const meta = JSON.parse(f.content.replace(/^﻿/, "")) as ChannelMeta;
        if (meta.include && meta.include.length > 0) return meta;
      }
    } catch (e) {
      console.warn(`[getChannelMeta] ${channel} Supabase 읽기 실패, GitHub로 폴백:`, e);
    }
  }
  // 2순위: GitHub, 3순위: 로컬 번들
  try {
    const raw = await githubRead(`data/channels/${channel}/_meta.json`, token);
    const meta = JSON.parse(raw.replace(/^﻿/, "")) as ChannelMeta;
    // GitHub에서 include가 비어 있으면 로컬 기본값 폴백
    if (meta.include && meta.include.length > 0) return meta;
  } catch (e) {
    console.warn(`[getChannelMeta] ${channel} GitHub 읽기 실패, 로컬 번들 파일로 폴백:`, e);
  }
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  const raw = await fs.readFile(metaPath, "utf-8");
  return JSON.parse(raw.replace(/^﻿/, ""));
}

export async function getChannelFileTree(channel: ChannelKey, token?: string): Promise<FileNode[]> {
  const meta = await getChannelMeta(channel, token);

  // 1순위: Supabase 파일 목록으로 트리 구성
  if (sbConfigured()) {
    try {
      const files = await getChannelFilesCached(channel);
      const paths = [...files.keys()];
      if (paths.length > 0) return buildTreeFromPaths(paths, meta.include);
    } catch (e) {
      console.warn(`[getChannelFileTree] ${channel} Supabase 조회 실패, GitHub로 폴백:`, e);
    }
  }

  async function walkGithub(repoPath: string, relBase: string): Promise<FileNode[]> {
    const entries = await githubListDir(repoPath, token);
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith("_")) continue;
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.type === "dir") {
        const children = await walkGithub(entry.path, relPath);
        nodes.push({ name: entry.name, path: relPath, type: "dir", included: false, children });
      } else {
        // 모든 파일 표시 (.md 한정 제거)
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "file",
          included: meta.include.includes(relPath),
        });
      }
    }
    return nodes;
  }
  try {
    return await walkGithub(`data/channels/${channel}`, "");
  } catch (e) {
    console.warn(`[getChannelFileTree] ${channel} GitHub 조회 실패, 로컬 번들 파일로 폴백:`, e);
  }

  const root = path.join(CHANNEL_DIR, channel);
  async function walk(dir: string, relBase: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith("_")) continue;
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const children = await walk(path.join(dir, entry.name), relPath);
        nodes.push({ name: entry.name, path: relPath, type: "dir", included: false, children });
      } else {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "file",
          included: meta.include.includes(relPath),
        });
      }
    }
    return nodes;
  }
  return walk(root, "");
}

/** 텍스트 파일 읽기 */
// GitHub 404는 "그 티어에 파일이 없다"는 예상된 폴백 신호(상위/공용으로 넘어감)라 에러가 아니다.
// 스택 없는 한 줄 info(stdout)로 남겨 로그 노이즈(빨간 stderr+스택)를 없앤다. 500/502 등은 진짜 문제라 warn 유지.
const isGithubNotFound = (e: unknown) => /:\s*404\b/.test(String(e));

export async function readChannelFile(channel: ChannelKey, filePath: string, token?: string): Promise<string> {
  const safe = filePath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  if (sbConfigured()) {
    try {
      const files = await getChannelFilesCached(channel);
      const f = files.get(safe);
      if (f) {
        if (!f.isBinary) return f.content;
        // 텍스트 파일인데 is_binary=true(base64)로 잘못 저장된 구 데이터 → 디코드해 복구
        if (isTextFile(safe.split("/").pop() ?? "")) return Buffer.from(f.content, "base64").toString("utf-8");
      }
    } catch (e) {
      console.warn(`[readChannelFile] ${channel}/${filePath} Supabase 읽기 실패, GitHub로 폴백:`, e);
    }
  }
  try {
    return await githubRead(`data/channels/${channel}/${safe}`, token);
  } catch (e) {
    if (isGithubNotFound(e)) console.log(`[readChannelFile] ${channel}/${filePath} 채널본 없음(404) → 로컬/공용 폴백`);
    else console.warn(`[readChannelFile] ${channel}/${filePath} GitHub 읽기 실패, 로컬 번들 파일로 폴백:`, e);
  }
  const safeLocal = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(CHANNEL_DIR, channel, safeLocal);
  return fs.readFile(full, "utf-8");
}

/** 바이너리 파일 읽기 → raw base64 반환 */
export async function readChannelFileBase64(channel: ChannelKey, filePath: string, token?: string): Promise<string> {
  const safe = filePath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  if (sbConfigured()) {
    try {
      const files = await getChannelFilesCached(channel);
      const f = files.get(safe);
      if (f) return f.isBinary ? f.content : Buffer.from(f.content, "utf-8").toString("base64");
    } catch (e) {
      console.warn(`[readChannelFileBase64] ${channel}/${filePath} Supabase 읽기 실패, GitHub로 폴백:`, e);
    }
  }
  try {
    return await githubReadBase64(`data/channels/${channel}/${safe}`, token);
  } catch (e) {
    if (isGithubNotFound(e)) console.log(`[readChannelFileBase64] ${channel}/${filePath} 채널본 없음(404) → 로컬 폴백`);
    else console.warn(`[readChannelFileBase64] ${channel}/${filePath} GitHub 읽기 실패, 로컬 번들 파일로 폴백:`, e);
  }
  const safeLocal = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(CHANNEL_DIR, channel, safeLocal);
  const buf = await fs.readFile(full);
  return buf.toString("base64");
}

/** 파일 쓰기
 *  isBase64=true → content는 이미 base64 인코딩된 값 (바이너리 업로드용) */
export async function writeChannelFile(
  channel: ChannelKey,
  filePath: string,
  content: string,
  token?: string,
  isBase64 = false
): Promise<void> {
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
  const fileName = safe.split("/").pop() ?? "";
  // is_binary는 프론트의 encoding이 아니라 "실제 파일 확장자"로 판단한다.
  // 프론트가 텍스트도 base64로 보내므로(코드 단순화), 텍스트인데 base64면 디코드해 원문으로 저장.
  const storeAsBinary = !isTextFile(fileName);
  const decoded =
    isBase64 && !storeAsBinary
      ? Buffer.from(content, "base64").toString("utf-8") // 텍스트인데 base64 → 디코드
      : content;                                          // 텍스트 원문 또는 진짜 바이너리(base64 그대로)

  // 쓰기 1순위: Supabase (실시간 반영). 미설정(로컬 dev) 시에만 로컬 파일에 쓴다.
  if (sbConfigured()) {
    await sbWriteFile(channel, safe, decoded, storeAsBinary);
    invalidateChannelFilesCache(channel);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (storeAsBinary) {
    await fs.writeFile(full, Buffer.from(content, "base64"));
  } else {
    await fs.writeFile(full, decoded, "utf-8");
  }
}

export async function deleteChannelFile(channel: ChannelKey, filePath: string, token?: string): Promise<void> {
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
  if (sbConfigured()) {
    await sbDeleteFile(channel, safe);
    invalidateChannelFilesCache(channel);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe);
  await fs.unlink(full);
}

export async function moveChannelFile(
  channel: ChannelKey,
  sourcePath: string,
  targetPath: string,
  token?: string
): Promise<void> {
  // 바이너리 파일은 base64로 이동
  if (!isTextFile(sourcePath.split("/").pop() ?? "")) {
    const b64 = await readChannelFileBase64(channel, sourcePath, token);
    await writeChannelFile(channel, targetPath, b64, token, true);
  } else {
    const content = await readChannelFile(channel, sourcePath, token);
    await writeChannelFile(channel, targetPath, content, token, false);
  }
  await deleteChannelFile(channel, sourcePath, token);
}

export async function deleteChannelFolder(channel: ChannelKey, folderPath: string, token?: string): Promise<void> {
  const safe = folderPath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  if (sbConfigured()) {
    // 접두사(폴더) 아래 전체 삭제
    await sbDeletePrefix(channel, safe.endsWith("/") ? safe : `${safe}/`);
    invalidateChannelFilesCache(channel);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe.replace(/\//g, path.sep));
  await fs.rm(full, { recursive: true, force: true });
}

export async function updateChannelMeta(channel: ChannelKey, meta: ChannelMeta, token?: string): Promise<void> {
  if (sbConfigured()) {
    await sbWriteFile(channel, "_meta.json", JSON.stringify(meta, null, 2), false);
    invalidateChannelFilesCache(channel);
    return;
  }
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// ─── 공용 에이전트(data/agents) — 채널에 속하지 않는 기본/폴백 페르소나 ────────────
// 채널 가이드와 동일한 저장소(channel_files)를 재사용하되, 채널 이름 칸에 실제 채널과
// 겹치지 않는 예약어 `_shared`를 넣어 저장한다(스키마 변경 없음). 읽기는 채널 파일과
// 똑같이 Supabase(_shared) → GitHub(data/agents) → 로컬 번들 3단 폴백이라, 웹에서
// 편집하면 재배포 없이 다음 생성부터 라이브로 반영된다.
export const SHARED_AGENTS_CHANNEL = "_shared";
const AGENTS_DIR = path.join(rootDir, "data", "agents");

// 읽기 순서: Supabase(_shared, 편집본) → 로컬 번들(정본, 네트워크 0) → GitHub(최후).
// 공용 에이전트의 편집본은 항상 Supabase에만 저장되고 미편집분은 로컬 번들 == 리포 원본이라,
// GitHub는 로컬이 없을 때만 닿는 last-resort다(편집 안 한 대부분의 호출에서 GitHub 호출·rate-limit 0).
export async function readSharedAgentFile(fileRel: string, token?: string): Promise<string> {
  const safe = fileRel.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  if (sbConfigured()) {
    try {
      const files = await getChannelFilesCached(SHARED_AGENTS_CHANNEL);
      const f = files.get(safe);
      if (f) {
        if (!f.isBinary) return f.content;
        if (isTextFile(safe.split("/").pop() ?? "")) return Buffer.from(f.content, "base64").toString("utf-8");
      }
    } catch (e) {
      console.warn(`[readSharedAgentFile] ${safe} Supabase 읽기 실패, 로컬로 폴백:`, e);
    }
  }
  const safeLocal = path.normalize(safe).replace(/^(\.\.[/\\])+/, "");
  try {
    return await fs.readFile(path.join(AGENTS_DIR, safeLocal), "utf-8");
  } catch (e) {
    console.warn(`[readSharedAgentFile] ${safe} 로컬 읽기 실패, GitHub로 폴백:`, e);
  }
  return githubRead(`data/agents/${safe}`, token);
}

/** 공용 에이전트 저장 (Supabase _shared, 미설정 시 로컬). 텍스트 전용. */
export async function writeSharedAgentFile(fileRel: string, content: string): Promise<void> {
  const safe = path.normalize(fileRel).replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
  if (sbConfigured()) {
    await sbWriteFile(SHARED_AGENTS_CHANNEL, safe, content, false);
    invalidateChannelFilesCache(SHARED_AGENTS_CHANNEL);
    return;
  }
  const full = path.join(AGENTS_DIR, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

/** 공용 에이전트 파일명 목록(정본=로컬 번들의 .md). 편집 여부와 무관하게 항상 전체를 보여준다. */
export async function listSharedAgentFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("_"))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

// ─── data/ 루트 직속 설정 파일(models.json 등) 라이브 read/write ────────────────
// 공용 에이전트와 동일한 방식(Supabase _shared 채널 재사용, 스키마 변경 없음). 키는 data-상대
// 경로(예: "models.json")라 에이전트 키(`*.md`)와 네임스페이스가 겹치지 않는다. 읽기 순서는
// Supabase(편집본) → 로컬 번들(정본) → GitHub(최후)로 미편집 시 네트워크 0.
export async function readSharedDataFile(dataRelPath: string, token?: string): Promise<string> {
  const safe = dataRelPath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  if (sbConfigured()) {
    try {
      const files = await getChannelFilesCached(SHARED_AGENTS_CHANNEL);
      const f = files.get(safe);
      if (f && !f.isBinary) return f.content;
    } catch (e) {
      console.warn(`[readSharedDataFile] ${safe} Supabase 읽기 실패, 로컬로 폴백:`, e);
    }
  }
  const safeLocal = path.normalize(safe).replace(/^(\.\.[/\\])+/, "");
  try {
    return await fs.readFile(path.join(rootDir, "data", safeLocal), "utf-8");
  } catch (e) {
    console.warn(`[readSharedDataFile] ${safe} 로컬 읽기 실패, GitHub로 폴백:`, e);
  }
  return githubRead(`data/${safe}`, token);
}

/** data/ 루트 설정 파일 저장 (Supabase _shared, 미설정 시 로컬). 텍스트 전용. */
export async function writeSharedDataFile(dataRelPath: string, content: string): Promise<void> {
  const safe = path.normalize(dataRelPath).replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
  if (sbConfigured()) {
    await sbWriteFile(SHARED_AGENTS_CHANNEL, safe, content, false);
    invalidateChannelFilesCache(SHARED_AGENTS_CHANNEL);
    return;
  }
  const full = path.join(rootDir, "data", safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

// AI 시스템 프롬프트용 가이드 파일 자동 수집
// _ 로 시작하는 파일(시스템 파일)과 CLAUDE.md만 제외, 나머지 모든 텍스트 파일 포함
export async function collectGuideFiles(channel: ChannelKey, token?: string): Promise<string[]> {
  const root = path.join(CHANNEL_DIR, channel);

  async function walkLocal(dir: string, relBase: string, out: string[]) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith("_") || entry.name === "CLAUDE.md") continue;
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walkLocal(path.join(dir, entry.name), relPath, out);
      } else if (isTextFile(entry.name)) {
        out.push(relPath);
      }
    }
  }

  // 1순위: Supabase 파일 목록 (실시간). 시스템 파일(_·.)·CLAUDE.md 제외, 텍스트 파일만.
  if (sbConfigured()) {
    try {
      const paths = [...(await getChannelFilesCached(channel)).keys()];
      const files = paths.filter(p => {
        const name = p.split("/").pop() ?? "";
        return isTextFile(name)
          && name !== "CLAUDE.md"
          && !p.split("/").some(seg => seg.startsWith("_") || seg.startsWith("."));
      });
      if (files.length > 0) return files;
    } catch (e) {
      console.warn(`[collectGuideFiles] ${channel} Supabase 조회 실패, GitHub로 폴백:`, e);
    }
  }

  // 2순위: 항상 GitHub에서 최신 파일 목록을 조회 (수정·업로드가 어디서 실행되든 반영되도록).
  try {
    const githubFiles: string[] = [];
    async function walkGithub(repoPath: string, relBase: string) {
      const entries = await githubListDir(repoPath, token);
      for (const entry of entries) {
        if (entry.name.startsWith("_") || entry.name === "CLAUDE.md" || entry.name.startsWith(".")) continue;
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.type === "dir") {
          await walkGithub(entry.path, relPath);
        } else if (isTextFile(entry.name)) {
          githubFiles.push(relPath);
        }
      }
    }
    await walkGithub(`data/channels/${channel}`, "");
    if (githubFiles.length > 0) return githubFiles;
    console.warn(`[collectGuideFiles] GitHub 목록이 비어있음 → 배포 번들 파일 사용`);
  } catch (e) {
    console.warn(`[collectGuideFiles] GitHub 조회 실패 → 배포 번들 파일 사용:`, e);
  }
  // GitHub 실패 시 배포 번들의 로컬 파일로 폴백
  const localFiles: string[] = [];
  await walkLocal(root, "", localFiles);
  return localFiles;
}

// 채널에 멀티에이전트 파이프라인이 있는지 확인
// researcher-web.md(웹 전용) 또는 researcher.md(로컬용) 중 하나라도 있으면 true
export async function hasAgentPipeline(channel: ChannelKey, token?: string): Promise<boolean> {
  try {
    const allFiles = await collectGuideFiles(channel, token);
    return allFiles.includes("agents/researcher-web.md") || allFiles.includes("agents/researcher.md");
  } catch {
    return false;
  }
}

export async function buildSystemPrompt(channel: ChannelKey, token?: string): Promise<string> {
  const meta = await getChannelMeta(channel, token);

  // 채널 디렉토리의 모든 텍스트 파일 수집
  let guideFiles: string[];
  try {
    const all = await collectGuideFiles(channel, token);
    guideFiles = all.filter(f => isTextFile(f.split("/").pop() ?? ""));
  } catch {
    guideFiles = meta.include;
  }

  if (guideFiles.length === 0) {
    console.warn(`[buildSystemPrompt] ${channel}: 로드할 가이드 파일이 없습니다.`);
    return "";
  }

  const parts: string[] = [];

  // 회사 서비스 관련 검증된 사실 정보(지어낸 서비스·수치 방지)는 인스타그램/페이스북 채널에만 포함한다.
  // 다른 채널은 구조가 달라 그대로 적용하면 안 맞을 수 있어, 필요해지면 그 채널 전용으로 따로 검토한다.
  if (channel === "instagram") {
    try {
      const factsPath = path.join(rootDir, "data", "company-facts.md");
      const facts = (await fs.readFile(factsPath, "utf-8")).trim();
      if (facts) parts.push(`\n\n${"=".repeat(60)}\n# company-facts.md\n${"=".repeat(60)}\n\n${facts}`);
    } catch (e) {
      console.warn(`[buildSystemPrompt] company-facts.md 로드 실패:`, e);
    }
  }

  for (const relPath of guideFiles) {
    try {
      const content = await readChannelFile(channel, relPath, token);
      if (!content.trim()) continue;
      parts.push(`\n\n${"=".repeat(60)}\n# ${relPath}\n${"=".repeat(60)}\n\n${content}`);
    } catch (e) {
      console.warn(`[buildSystemPrompt] ${channel}/${relPath} 로드 실패:`, e);
    }
  }

  if (parts.length === 0) {
    console.warn(`[buildSystemPrompt] ${channel}: 가이드 파일을 로드하지 못했습니다.`);
    return "";
  }

  const displayFiles = channel === "instagram" ? ["company-facts.md", ...guideFiles] : guideFiles;
  const guideList = displayFiles.map((p, i) => `  ${i + 1}. ${p}`).join("\n");

  const header = `당신은 ${meta.label} 채널 전용 마케팅 콘텐츠 작성 AI입니다.

아래 가이드 문서 ${displayFiles.length}개를 반드시 숙지하고 철저히 따라 콘텐츠를 작성하세요.
가이드에 명시된 형식·구조·어조·금지 사항을 그대로 적용하세요.

[참조 가이드 목록]
${guideList}

[가이드 전문]`;

  console.log(`[buildSystemPrompt] ${channel}: 파일 ${guideFiles.length}개 로드 (${parts.length}개 실제 로드)`);
  return header + parts.join("\n");
}

export { CHANNELS };
export type { ChannelKey };
