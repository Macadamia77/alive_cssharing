// 프롬프트 조립 공용 유틸 — runPipeline.ts에서 추출(동작 무변화).
// 통합 엔진과 신규 인터랙티브 라우트(브레인스토밍 등)가 페르소나·가이드 로딩을
// 동일 로직으로 재사용하기 위해 별도 모듈로 분리한다.
import fs from "fs/promises";
import { join } from "path";
import { dataRoot } from "../dataRoot";
import { type ChannelKey } from "../channels";
import { readChannelFile, readSharedAgentFile, collectGuideFiles, isTextFile } from "../channelFiles";
import { parseFrontmatter } from "./frontmatter";
import type { ResolvedStage } from "./types";

// ─── 코드펜스 제거 (LLM이 감싸는 ```html 등) ────────────────────
export function stripCodeFence(text: string): string {
  let s = text.trim();
  const m = s.match(/^(?:```|~~~)[\w-]*\n?([\s\S]*?)\n?(?:```|~~~)\s*$/);
  if (m) return m[1].trim();
  s = s.replace(/^(?:```|~~~)[\w-]*[ \t]*\r?\n/, "");
  s = s.replace(/\r?\n(?:```|~~~)[ \t]*$/, "");
  return s.trim();
}

// ─── 페르소나 파일 로딩 (채널 우선 → 공통 폴백) ────────────────
// 1) data/channels/<채널>/agents/<persona>.md  (Supabase→GitHub→로컬)
// 2) data/agents/<persona>.md                  (공통 — Supabase _shared→GitHub→로컬)
// channel이 null이면(채널 배정 이전 단계: research/brainstorm 등) 1순위를 건너뛰고
// 공통 페르소나만 읽는다. 공통 페르소나도 채널 가이드와 동일한 라이브 경로로 읽으므로,
// 웹(공용 에이전트 편집)에서 고치면 재배포 없이 다음 생성부터 반영된다.
export async function loadPersona(
  channel: ChannelKey | null,
  persona: string,
  token?: string
): Promise<string | null> {
  if (channel) {
    try {
      const txt = await readChannelFile(channel, `agents/${persona}.md`, token);
      if (txt && txt.trim()) return parseFrontmatter(txt).body.trim();
    } catch { /* 채널 전용 없음 → 공통으로 */ }
  }
  try {
    const txt = await readSharedAgentFile(`${persona}.md`, token);
    if (txt && txt.trim()) return parseFrontmatter(txt).body.trim();
  } catch { /* 공통도 없음 */ }
  return null;
}

// ─── 채널 조각(가이드) 파일 전체 로딩 (frontmatter stages 태그 포함) ──
export interface GuideFile { path: string; body: string; stages: string[]; }

export async function loadAllGuides(channel: ChannelKey, token?: string): Promise<GuideFile[]> {
  let keys: string[];
  try {
    keys = await collectGuideFiles(channel, token);
  } catch {
    return [];
  }
  const guideKeys = keys.filter(
    k => isTextFile(k.split("/").pop() ?? "")
      && !k.startsWith("agents/")
      && !k.startsWith("templates/")
  );
  const out: GuideFile[] = [];
  for (const k of guideKeys) {
    try {
      const raw = await readChannelFile(channel, k, token);
      if (!raw.trim()) continue;
      const parsed = parseFrontmatter(raw);
      out.push({
        path: k,
        body: (parsed.body.trim() || raw.trim()),
        stages: parsed.meta.stages ?? [],
      });
    } catch { /* skip */ }
  }
  // 회사 서비스 관련 검증된 사실 정보(지어낸 서비스·수치 방지)는 인스타그램/페이스북 채널에만 포함한다.
  // legacy 엔진(channelFiles.ts::buildSystemPrompt)과 동일한 특례 — 파일 위치가 채널 폴더 밖(data/company-facts.md)이라 collectGuideFiles로는 못 잡는다.
  if (channel === "instagram") {
    try {
      const facts = await fs.readFile(join(dataRoot(), "data", "company-facts.md"), "utf-8");
      if (facts.trim()) out.push({ path: "company-facts.md", body: facts.trim(), stages: ["writer", "content-review"] });
    } catch { /* 없으면 스킵 */ }
  }
  return out;
}

// 한 단계에 주입할 조각 텍스트를 조립한다.
// 우선순위: ① _meta.pipeline[단계].guides(명시 할당) → ② frontmatter stages 태그
//          → ③ (writer 한정) 태그 없는 파일 전부 (기존 호환)
export function selectGuides(all: GuideFile[], stage: ResolvedStage): GuideFile[] {
  if (stage.guides !== undefined) {
    // 명시 할당(빈 배열이면 "아무것도 안 붙임"을 의미)
    return all.filter(g => stage.guides!.includes(g.path));
  }
  return all.filter(g =>
    g.stages.includes(stage.id) || (stage.id === "writer" && g.stages.length === 0)
  );
}

export function guidesText(selected: GuideFile[]): string {
  if (selected.length === 0) return "";
  return selected
    .map(g => `\n\n${"=".repeat(60)}\n# ${g.path}\n${"=".repeat(60)}\n\n${g.body}`)
    .join("");
}
