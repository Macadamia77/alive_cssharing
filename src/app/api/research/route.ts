import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { listResearch, deleteResearch } from "@/lib/pipelineMemory";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "linkedin", "magazine"];
const isValid = (c: string): c is ChannelKey => VALID.includes(c as ChannelKey);

/** GET /api/research?channel= — 웹서치(리서치) 아카이브 목록 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  try {
    return NextResponse.json({ research: await listResearch(channel) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/research?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "no id" }, { status: 400 });
  try {
    await deleteResearch(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
