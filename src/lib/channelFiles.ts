import fs from "fs/promises";
import path from "path";
import { type ChannelKey, CHANNELS } from "./channels";
import { isVercelProd, githubWrite, githubDelete, githubRead, githubReadBase64, githubListDir } from "./githubStorage";

const CHANNEL_DIR = path.join(process.cwd(), "data", "channels");

export interface ChannelMeta {
  label: string;
  type: "single" | "multi";
  description: string;
  include: string[];
  excluded_note?: string;
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

export async function getChannelMeta(channel: ChannelKey, token?: string): Promise<ChannelMeta> {
  if (isVercelProd()) {
    try {
      const raw = await githubRead(`data/channels/${channel}/_meta.json`, token);
      const meta = JSON.parse(raw.replace(/^﻿/, "")) as ChannelMeta;
      // GitHub에서 include가 비어 있으면 로컬 기본값 폴백
      if (meta.include && meta.include.length > 0) return meta;
    } catch {
      // GitHub 읽기 실패 시 배포 번들 내 로컬 파일 폴백
    }
  }
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  const raw = await fs.readFile(metaPath, "utf-8");
  return JSON.parse(raw.replace(/^﻿/, ""));
}

export async function getChannelFileTree(channel: ChannelKey, token?: string): Promise<FileNode[]> {
  const meta = await getChannelMeta(channel, token);

  if (isVercelProd()) {
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
    return walkGithub(`data/channels/${channel}`, "");
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
  if (isVercelProd()) {
    const safe = filePath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
    try {
      return await githubRead(`data/channels/${channel}/${safe}`, token);
    } catch {
      // GitHub 읽기 실패 시 배포 번들 내 로컬 파일 폴백
    }
  }
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(CHANNEL_DIR, channel, safe);
  return fs.readFile(full, "utf-8");
}

/** 바이너리 파일 읽기 → raw base64 반환 */
export async function readChannelFileBase64(channel: ChannelKey, filePath: string, token?: string): Promise<string> {
  if (isVercelProd()) {
    const safe = filePath.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
    return githubReadBase64(`data/channels/${channel}/${safe}`, token);
  }
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(CHANNEL_DIR, channel, safe);
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
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  if (isVercelProd()) {
    await githubWrite(`data/channels/${channel}/${safe.replace(/\\/g, "/")}`, content, token, isBase64);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (isBase64) {
    await fs.writeFile(full, Buffer.from(content, "base64"));
  } else {
    await fs.writeFile(full, content, "utf-8");
  }
}

export async function deleteChannelFile(channel: ChannelKey, filePath: string, token?: string): Promise<void> {
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  if (isVercelProd()) {
    await githubDelete(`data/channels/${channel}/${safe.replace(/\\/g, "/")}`, token);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe);
  await fs.unlink(full);
}

async function deleteGithubDirRecursive(repoPath: string, token?: string): Promise<void> {
  const entries = await githubListDir(repoPath, token);
  for (const entry of entries) {
    if (entry.type === "file") {
      await githubDelete(entry.path, token);
    } else if (entry.type === "dir") {
      await deleteGithubDirRecursive(entry.path, token);
    }
  }
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
  if (isVercelProd()) {
    await deleteGithubDirRecursive(`data/channels/${channel}/${safe}`, token);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe.replace(/\//g, path.sep));
  await fs.rm(full, { recursive: true, force: true });
}

export async function updateChannelMeta(channel: ChannelKey, meta: ChannelMeta, token?: string): Promise<void> {
  if (isVercelProd()) {
    await githubWrite(`data/channels/${channel}/_meta.json`, JSON.stringify(meta, null, 2), token);
    return;
  }
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// AI 시스템 프롬프트용 가이드 파일 자동 수집
// _ 로 시작하는 파일(시스템 파일)과 CLAUDE.md만 제외, 나머지 모든 텍스트 파일 포함
export async function collectGuideFiles(channel: ChannelKey, token?: string): Promise<string[]> {
  const files: string[] = [];

  if (isVercelProd()) {
    async function walkGithub(repoPath: string, relBase: string) {
      const entries = await githubListDir(repoPath, token);
      for (const entry of entries) {
        if (entry.name.startsWith("_") || entry.name === "CLAUDE.md") continue;
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.type === "dir") {
          await walkGithub(entry.path, relPath);
        } else if (isTextFile(entry.name)) {
          files.push(relPath);
        }
      }
    }
    await walkGithub(`data/channels/${channel}`, "");
    return files;
  }

  const root = path.join(CHANNEL_DIR, channel);
  async function walkLocal(dir: string, relBase: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith("_") || entry.name === "CLAUDE.md") continue;
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walkLocal(path.join(dir, entry.name), relPath);
      } else if (isTextFile(entry.name)) {
        files.push(relPath);
      }
    }
  }
  await walkLocal(root, "");
  return files;
}

export async function buildSystemPrompt(channel: ChannelKey, token?: string): Promise<string> {
  const meta = await getChannelMeta(channel, token);

  // 채널 디렉토리의 모든 가이드 파일 자동 수집 (include 목록 의존 없음)
  let guideFiles: string[];
  try {
    guideFiles = await collectGuideFiles(channel, token);
  } catch {
    // 자동 탐색 실패 시 meta.include 폴백
    guideFiles = meta.include;
  }

  if (guideFiles.length === 0) {
    console.warn(`[buildSystemPrompt] ${channel}: 가이드 파일을 찾을 수 없습니다.`);
    return "";
  }

  const parts: string[] = [];
  for (const relPath of guideFiles) {
    if (!isTextFile(relPath.split("/").pop() ?? "")) continue;
    try {
      const content = await readChannelFile(channel, relPath, token);
      parts.push(`\n\n${"=".repeat(60)}\n# 가이드 파일: ${relPath}\n${"=".repeat(60)}\n\n${content}`);
    } catch (e) {
      console.warn(`[buildSystemPrompt] ${channel}/${relPath} 로드 실패:`, e);
    }
  }

  if (parts.length === 0) {
    console.warn(`[buildSystemPrompt] ${channel}: 가이드 파일을 모두 로드하지 못했습니다.`);
    return "";
  }

  const guideList = guideFiles.map((p, i) => `  ${i + 1}. ${p}`).join("\n");

  const header = `당신은 ${meta.label} 채널 전용 마케팅 콘텐츠 작성 AI입니다.

[필수 준수 사항]
아래 가이드 문서(${guideFiles.length}개)는 반드시 읽고 철저히 따라야 합니다.
가이드에 명시된 형식, 구조, 어조, 금지 사항을 어기면 안 됩니다.

[참조 가이드 목록]
${guideList}

[규칙]
- 가이드의 형식과 구조를 그대로 따르세요.
- 가이드에 없는 표현 방식이나 포맷은 사용하지 마세요.
- 가이드의 금지 항목을 절대 위반하지 마세요.
- 채널 특성과 가이드 톤에 맞게 작성하세요.

[가이드 전문]`;

  return header + parts.join("\n");
}

export { CHANNELS };
export type { ChannelKey };
