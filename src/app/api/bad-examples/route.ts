import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { listBadExamples, addBadExample, deleteBadExample } from "@/lib/pipelineMemory";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "linkedin", "magazine"];
const isValid = (c: string): c is ChannelKey => VALID.includes(c as ChannelKey);

/** GET /api/bad-examples?channel= — 기각 사례 목록 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  try {
    return NextResponse.json({ badExamples: await listBadExamples(channel) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/bad-examples { channel, content, reason? } — 기각 사례 수동 추가 */
export async function POST(req: NextRequest) {
  try {
    const { channel, content, reason } = await req.json();
    if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
    if (!content || !String(content).trim()) return NextResponse.json({ error: "empty content" }, { status: 400 });
    await addBadExample(channel, String(content), reason ? String(reason) : undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/bad-examples?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "no id" }, { status: 400 });
  try {
    await deleteBadExample(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
