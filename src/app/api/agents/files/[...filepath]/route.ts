import { NextRequest, NextResponse } from "next/server";
import { readSharedAgentFile, writeSharedAgentFile, isTextFile } from "@/lib/channelFiles";
import { resolveGithubToken } from "@/lib/resolveToken";
import { guard } from "@/lib/authGate";

type RouteContext = { params: Promise<{ filepath: string[] }> };

/** GET — 공용 에이전트 텍스트 읽기 (Supabase _shared → GitHub → 로컬) */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const denied = await guard();
  if (denied) return denied;
  const { filepath } = await params;
  const filePath = filepath.join("/");
  const fileName = filePath.split("/").pop() ?? "";
  if (!isTextFile(fileName)) {
    return NextResponse.json({ error: "공용 에이전트는 텍스트(.md) 파일만 지원합니다." }, { status: 400 });
  }
  try {
    const token = resolveGithubToken(req);
    const content = await readSharedAgentFile(filePath, token);
    return NextResponse.json({ content, encoding: "utf-8" });
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }
}

/** PUT — 공용 에이전트 저장 (Supabase _shared, 미설정 시 로컬) */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const denied = await guard();
  if (denied) return denied;
  const { filepath } = await params;
  const filePath = filepath.join("/");
  const fileName = filePath.split("/").pop() ?? "";
  if (!isTextFile(fileName)) {
    return NextResponse.json({ error: "공용 에이전트는 텍스트(.md) 파일만 지원합니다." }, { status: 400 });
  }
  try {
    const { content } = await req.json();
    if (typeof content !== "string") return NextResponse.json({ error: "content 필드가 없습니다." }, { status: 400 });
    await writeSharedAgentFile(filePath, content);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
