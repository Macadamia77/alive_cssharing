import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { type ChannelKey, CHANNELS } from "./channels";
import { githubRead, githubReadBase64, githubListDir } from "./githubStorage";
import {
  sbConfigured, sbReadFile, sbListPaths, sbWriteFile, sbDeleteFile, sbDeletePrefix,
} from "./supabaseChannelFiles";

import { existsSync } from "fs";

let rootDir = process.cwd();
if (!existsSync(path.join(rootDir, "data")) && existsSync(path.join(rootDir, "..", "data"))) {
  rootDir = path.join(rootDir, "..");
}
const CHANNEL_DIR = path.join(rootDir, "data", "channels");

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
      const f = await sbReadFile(channel, "_meta.json");
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
      const paths = await sbListPaths(channel);
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
export async function readChannelFile(channel: ChannelKey, filePath: string, token?: string): Promise<string> {
  const safe = filePath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  if (sbConfigured()) {
    try {
      const f = await sbReadFile(channel, safe);
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
    console.warn(`[readChannelFile] ${channel}/${filePath} GitHub 읽기 실패, 로컬 번들 파일로 폴백:`, e);
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
      const f = await sbReadFile(channel, safe);
      if (f) return f.isBinary ? f.content : Buffer.from(f.content, "utf-8").toString("base64");
    } catch (e) {
      console.warn(`[readChannelFileBase64] ${channel}/${filePath} Supabase 읽기 실패, GitHub로 폴백:`, e);
    }
  }
  try {
    return await githubReadBase64(`data/channels/${channel}/${safe}`, token);
  } catch (e) {
    console.warn(`[readChannelFileBase64] ${channel}/${filePath} GitHub 읽기 실패, 로컬 번들 파일로 폴백:`, e);
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
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe.replace(/\//g, path.sep));
  await fs.rm(full, { recursive: true, force: true });
}

export async function updateChannelMeta(channel: ChannelKey, meta: ChannelMeta, token?: string): Promise<void> {
  if (sbConfigured()) {
    await sbWriteFile(channel, "_meta.json", JSON.stringify(meta, null, 2), false);
    return;
  }
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
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
      const paths = await sbListPaths(channel);
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

  const guideList = guideFiles.map((p, i) => `  ${i + 1}. ${p}`).join("\n");

  const header = `당신은 ${meta.label} 채널 전용 마케팅 콘텐츠 작성 AI입니다.

아래 가이드 문서 ${guideFiles.length}개를 반드시 숙지하고 철저히 따라 콘텐츠를 작성하세요.
가이드에 명시된 형식·구조·어조·금지 사항을 그대로 적용하세요.

[참조 가이드 목록]
${guideList}

[가이드 전문]`;

  console.log(`[buildSystemPrompt] ${channel}: 파일 ${guideFiles.length}개 로드 (${parts.length}개 실제 로드)`);
  return header + parts.join("\n");
}

export { CHANNELS };
export type { ChannelKey };
