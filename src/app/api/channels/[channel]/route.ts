import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import {
  getChannelMeta,
  getChannelFileTree,
  updateChannelMeta,
} from "@/lib/channelFiles";
import { loadPipelineConfig } from "@/lib/pipeline/loadConfig";
import { resolveGithubToken } from "@/lib/resolveToken";

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
    return NextResponse.json({ channel, meta, tree, pipelineStages });
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
    // 단계별 오버라이드 병합 (예: { "skeleton": { "enabled": true } })
    if (body.pipeline && typeof body.pipeline === "object") {
      meta.pipeline = { ...(meta.pipeline ?? {}), ...body.pipeline };
    }
    await updateChannelMeta(channel, meta, token);
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
