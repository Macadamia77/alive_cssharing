import { NextRequest, NextResponse } from "next/server";
import { listResults, saveResult, newResultId, resolveToken } from "@/lib/resultStorage";
import { guard } from "@/lib/authGate";

export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const token = resolveToken(req);
    const results = await listResults(token);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const { topic, channels, cardAssets } = await req.json();
    if (!topic || !channels) return NextResponse.json({ error: "topic, channels 필드가 필요합니다." }, { status: 400 });
    const token = resolveToken(req);
    const entry = { id: newResultId(), topic, createdAt: new Date().toISOString(), channels, cardAssets };
    await saveResult(entry, token);
    return NextResponse.json({ ok: true, id: entry.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
