import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { readChannelFile, writeChannelFile, deleteChannelFile, deleteChannelFolder, moveChannelFile } from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "facebook", "linkedin", "magazine"];

function isValid(ch: string): ch is ChannelKey {
  return VALID.includes(ch as ChannelKey);
}

type RouteContext = { params: Promise<{ channel: string; filepath: string[] }> };

/** GET — 파일 내용 읽기 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const token = resolveGithubToken(req);
    const content = await readChannelFile(channel, filepath.join("/"), token);
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
    const token = resolveGithubToken(req);
    await writeChannelFile(channel, filepath.join("/"), content, token);
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
    const token = resolveGithubToken(req);
    await writeChannelFile(channel, filepath.join("/"), content, token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** PATCH — 파일 이동 (드래그 앤 드롭) */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { moveTo } = await req.json();
    if (!moveTo || typeof moveTo !== "string") return NextResponse.json({ error: "moveTo 경로가 필요합니다." }, { status: 400 });
    const token = resolveGithubToken(req);
    await moveChannelFile(channel, filepath.join("/"), moveTo, token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE — 파일 또는 폴더 삭제 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { channel, filepath } = await params;
  if (!isValid(channel)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isFolder = req.nextUrl.searchParams.get("type") === "folder";

  try {
    const token = resolveGithubToken(req);
    if (isFolder) {
      await deleteChannelFolder(channel, filepath.join("/"), token);
    } else {
      await deleteChannelFile(channel, filepath.join("/"), token);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
