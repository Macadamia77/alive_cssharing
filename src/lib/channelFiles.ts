import fs from "fs/promises";
import path from "path";
import { type ChannelKey, CHANNELS } from "./channels";
import { isVercelProd, githubWrite, githubDelete } from "./githubStorage";

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
  path: string;       // relative to channel root
  type: "file" | "dir";
  children?: FileNode[];
  included: boolean;  // whether it's in the system prompt
}

export async function getChannelMeta(channel: ChannelKey): Promise<ChannelMeta> {
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  const raw = await fs.readFile(metaPath, "utf-8");
  // BOM 제거 (Windows PowerShell이 UTF-8 BOM으로 저장하는 경우)
  return JSON.parse(raw.replace(/^﻿/, ""));
}

export async function getChannelFileTree(channel: ChannelKey): Promise<FileNode[]> {
  const meta = await getChannelMeta(channel);
  const root = path.join(CHANNEL_DIR, channel);

  async function walk(dir: string, relBase: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith("_")) continue; // skip _meta.json
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const children = await walk(path.join(dir, entry.name), relPath);
        nodes.push({ name: entry.name, path: relPath, type: "dir", included: false, children });
      } else if (entry.name.endsWith(".md")) {
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

export async function readChannelFile(channel: ChannelKey, filePath: string): Promise<string> {
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(CHANNEL_DIR, channel, safe);
  return fs.readFile(full, "utf-8");
}

export async function writeChannelFile(
  channel: ChannelKey,
  filePath: string,
  content: string
): Promise<void> {
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  if (isVercelProd()) {
    await githubWrite(`app/data/channels/${channel}/${safe.replace(/\\/g, "/")}`, content);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

export async function deleteChannelFile(channel: ChannelKey, filePath: string): Promise<void> {
  const safe = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  if (isVercelProd()) {
    await githubDelete(`app/data/channels/${channel}/${safe.replace(/\\/g, "/")}`);
    return;
  }
  const full = path.join(CHANNEL_DIR, channel, safe);
  await fs.unlink(full);
}

export async function updateChannelMeta(channel: ChannelKey, meta: ChannelMeta): Promise<void> {
  if (isVercelProd()) {
    await githubWrite(`app/data/channels/${channel}/_meta.json`, JSON.stringify(meta, null, 2));
    return;
  }
  const metaPath = path.join(CHANNEL_DIR, channel, "_meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

/** 채널의 시스템 프롬프트를 포함 파일들을 합쳐서 빌드 */
export async function buildSystemPrompt(channel: ChannelKey): Promise<string> {
  const meta = await getChannelMeta(channel);
  const parts: string[] = [];

  for (const relPath of meta.include) {
    try {
      const content = await readChannelFile(channel, relPath);
      parts.push(`\n\n${"=".repeat(60)}\n# 파일: ${relPath}\n${"=".repeat(60)}\n\n${content}`);
    } catch {
      // 파일이 없으면 스킵
    }
  }

  return parts.join("\n");
}

export { CHANNELS };
export type { ChannelKey };
