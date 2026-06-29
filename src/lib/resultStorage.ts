import fs from "fs/promises";
import path from "path";
import { isVercelProd, githubWrite, githubDelete, githubRead, githubListDir } from "./githubStorage";
import { resolveGithubToken } from "./resolveToken";
import { type NextRequest } from "next/server";

import { existsSync } from "fs";

let rootDir = process.cwd();
if (!existsSync(path.join(rootDir, "data")) && existsSync(path.join(rootDir, "..", "data"))) {
  rootDir = path.join(rootDir, "..");
}
const RESULTS_DIR = path.join(rootDir, "data", "results");
const GH_PATH = "data/results";

export interface ResultEntry {
  id: string;
  topic: string;
  createdAt: string;
  channels: Partial<Record<string, string>>;
}

export function newResultId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

export function resolveToken(req?: NextRequest): string | undefined {
  if (req) return resolveGithubToken(req);
  return process.env.GITHUB_TOKEN;
}

export async function saveResult(result: ResultEntry, token?: string): Promise<void> {
  const json = JSON.stringify(result, null, 2);
  if (isVercelProd()) {
    await githubWrite(`${GH_PATH}/${result.id}.json`, json, token);
    return;
  }
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(path.join(RESULTS_DIR, `${result.id}.json`), json, "utf-8");
}

export async function listResults(token?: string): Promise<ResultEntry[]> {
  if (isVercelProd()) {
    const entries = await githubListDir(GH_PATH, token);
    const results: ResultEntry[] = [];
    for (const e of entries) {
      if (e.type === "file" && e.name.endsWith(".json")) {
        try {
          const raw = await githubRead(e.path, token);
          results.push(JSON.parse(raw));
        } catch { /* skip corrupted */ }
      }
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  try {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const files = await fs.readdir(RESULTS_DIR);
    const results: ResultEntry[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(RESULTS_DIR, f), "utf-8");
        results.push(JSON.parse(raw));
      } catch { /* skip */ }
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export async function getResult(id: string, token?: string): Promise<ResultEntry | null> {
  try {
    if (isVercelProd()) {
      const raw = await githubRead(`${GH_PATH}/${id}.json`, token);
      return JSON.parse(raw);
    }
    const raw = await fs.readFile(path.join(RESULTS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function updateResult(id: string, patch: Partial<ResultEntry>, token?: string): Promise<void> {
  const existing = await getResult(id, token);
  if (!existing) throw new Error("결과물을 찾을 수 없습니다.");
  await saveResult({ ...existing, ...patch, channels: { ...existing.channels, ...(patch.channels ?? {}) } }, token);
}

export async function deleteResult(id: string, token?: string): Promise<void> {
  if (isVercelProd()) {
    await githubDelete(`${GH_PATH}/${id}.json`, token);
    return;
  }
  await fs.unlink(path.join(RESULTS_DIR, `${id}.json`));
}
