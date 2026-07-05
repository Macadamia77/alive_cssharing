import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { listFeedback, addFeedback, deleteFeedback } from "@/lib/pipelineMemory";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "linkedin", "magazine"];
const isValid = (c: string): c is ChannelKey => VALID.includes(c as ChannelKey);

/** GET /api/feedback?channel=linkedin — 채널 피드백 목록 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  try {
    return NextResponse.json({ feedback: await listFeedback(channel) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/feedback { channel, text } — 피드백 추가 */
export async function POST(req: NextRequest) {
  try {
    const { channel, text } = await req.json();
    if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
    if (!text || !String(text).trim()) return NextResponse.json({ error: "empty text" }, { status: 400 });
    await addFeedback(channel, String(text).trim());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/feedback?id=... — 피드백 삭제 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "no id" }, { status: 400 });
  try {
    await deleteFeedback(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
