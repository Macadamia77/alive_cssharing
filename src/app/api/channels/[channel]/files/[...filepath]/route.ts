import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { readChannelFile, writeChannelFile, deleteChannelFile } from "@/lib/channelFiles";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "facebook", "linkedin", "magazine"];

function isValid(ch: string): ch is ChannelKey {
  return VALID.includes(ch as ChannelKey);
}

type RouteContext = { params: Promise<{ channel: string; filepath: string[] }> };

/** GET — 파일 내용 읽기 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const content = await readChannelFile(channel, filepath.join("/"));
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }
}

/** PUT — 파일 내용 저장 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { content } = await req.json();
    if (typeof content !== "string") return NextResponse.json({ error: "content 필드가 없습니다." }, { status: 400 });
    await writeChannelFile(channel, filepath.join("/"), content);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST — 새 파일 생성 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { content = "" } = await req.json();
    await writeChannelFile(channel, filepath.join("/"), content);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE — 파일 삭제 */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = filepath.join("/");
  if (filePath === "guide.md") {
    return NextResponse.json({ error: "기본 가이드 파일은 삭제할 수 없습니다." }, { status: 400 });
  }

  try {
    await deleteChannelFile(channel, filePath);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
