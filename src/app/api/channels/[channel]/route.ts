import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import {
  getChannelMeta,
  getChannelFileTree,
  updateChannelMeta,
} from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "facebook", "linkedin", "magazine"];

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
    return NextResponse.json({ channel, meta, tree });
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
    await updateChannelMeta(channel, meta, token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
