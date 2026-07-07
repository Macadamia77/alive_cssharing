import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import {
  getChannelMeta,
  getChannelFileTree,
  updateChannelMeta,
  collectGuideFiles,
  readChannelFile,
  isTextFile,
} from "@/lib/channelFiles";
import { loadPipelineConfig } from "@/lib/pipeline/loadConfig";
import { parseFrontmatter } from "@/lib/pipeline/frontmatter";
import { resolveGithubToken } from "@/lib/resolveToken";

/** 채널 조각(가이드) 파일 목록 + frontmatter stages 태그 (조각 할당 UI용) */
async function listChannelGuides(channel: ChannelKey, token?: string) {
  let keys: string[];
  try { keys = await collectGuideFiles(channel, token); } catch { return []; }
  const guideKeys = keys.filter(
    k => isTextFile(k.split("/").pop() ?? "") && !k.startsWith("agents/") && !k.startsWith("templates/")
  );
  const out: { path: string; stages: string[] }[] = [];
  for (const k of guideKeys) {
    try {
      const raw = await readChannelFile(channel, k, token);
      out.push({ path: k, stages: parseFrontmatter(raw).meta.stages ?? [] });
    } catch { /* skip */ }
  }
  return out;
}

const VALID: ChannelKey[] = ["naver-blog", "instagram", "linkedin", "magazine"];

function isValid(ch: string): ch is ChannelKey {
  return VALID.includes(ch as ChannelKey);
}

/** GET /api/channels/[channel] — 메타 + 파일 트리 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const token = resolveGithubToken(req);
    const [meta, tree] = await Promise.all([
      getChannelMeta(channel, token),
      getChannelFileTree(channel, token),
    ]);
    // 전역 파이프라인 단계 정의(토글 UI가 어떤 단계가 있는지 알아야 함)
    const pipelineStages = loadPipelineConfig().stages;
    const guides = await listChannelGuides(channel, token);
    return NextResponse.json({ channel, meta, tree, pipelineStages, guides });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** PUT /api/channels/[channel] — 메타(include 목록) 업데이트 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const token = resolveGithubToken(req);
    const meta = await getChannelMeta(channel, token);
    if (Array.isArray(body.include)) meta.include = body.include;
    // 통합 파이프라인 엔진 토글
    if (body.engine === "pipeline" || body.engine === "legacy") meta.engine = body.engine;
    // 채널 기본 모델(provider) / 모델 ID — 빈 값이면 해제(기본으로)
    if (body.model !== undefined) meta.model = body.model || undefined;
    if (body.modelId !== undefined) meta.modelId = body.modelId || undefined;
    // 단계별 오버라이드 병합 — stage-id 단위로 "깊게" 병합(다른 필드 보존).
    // patch 값이 null이면 해당 필드 삭제(= "기본으로 되돌리기").
    if (body.pipeline && typeof body.pipeline === "object") {
      const merged = { ...(meta.pipeline ?? {}) } as Record<string, Record<string, unknown>>;
      for (const [stageId, patch] of Object.entries(body.pipeline as Record<string, Record<string, unknown>>)) {
        const next = { ...(merged[stageId] ?? {}) };
        for (const [k, v] of Object.entries(patch ?? {})) {
          if (v === null) delete next[k];   // null → 필드 제거(기본으로)
          else next[k] = v;
        }
        merged[stageId] = next;
      }
      meta.pipeline = merged as typeof meta.pipeline;
    }
    await updateChannelMeta(channel, meta, token);
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
