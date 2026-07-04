// 에이전트/가이드 파일 맨 위의 frontmatter(---로 감싼 메타)를 파싱한다.
// 태그 기반 매칭(파일 이름·위치 무관)의 핵심 — role/stages 등으로 파일을 고른다.
//
// 예:
// ---
// type: persona
// role: writer
// stages: [writer, content-review]
// ---
// 본문...

export interface FrontmatterMeta {
  type?: string;              // persona | guide
  role?: string;              // 역할 정체성 (안정적 ID)
  stages?: string[];          // 이 파일이 쓰이는 stage id 목록
  order?: number;
  [key: string]: unknown;
}

export interface ParsedFile {
  meta: FrontmatterMeta;
  body: string;               // frontmatter 제거한 본문
}

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** 간단한 스칼라 파서 (따옴표 제거) */
function parseScalar(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "");
}

/** "[a, b, c]" 또는 "a, b" → 문자열 배열 */
function parseArray(v: string): string[] {
  const t = v.trim().replace(/^\[|\]$/g, "");
  if (!t.trim()) return [];
  return t.split(",").map(s => parseScalar(s)).filter(Boolean);
}

/**
 * frontmatter를 파싱한다. frontmatter가 없으면 meta는 빈 객체, body는 원문.
 * 우리가 쓰는 필드(type/role/stages/order)만 얕게 해석 (완전한 YAML 파서 아님).
 */
export function parseFrontmatter(text: string): ParsedFile {
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, body: text };

  const meta: FrontmatterMeta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2];
    if (key === "stages") meta.stages = parseArray(raw);
    else if (key === "order") meta.order = Number(parseScalar(raw)) || undefined;
    else meta[key] = parseScalar(raw);
  }
  return { meta, body: m[2] };
}
