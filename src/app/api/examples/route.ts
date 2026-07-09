import { NextRequest, NextResponse } from "next/server";
import { type ChannelKey } from "@/lib/channels";
import { listExamples, addExample, deleteExample } from "@/lib/pipelineMemory";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";
import { loadAIConfig, type Provider, type ProviderKey } from "@/lib/aiConfig";
import { resolveGithubToken } from "@/lib/resolveToken";

const VALID: ChannelKey[] = ["naver-blog", "instagram", "linkedin", "magazine"];
const isValid = (c: string): c is ChannelKey => VALID.includes(c as ChannelKey);

/** GET /api/examples?channel=linkedin — 채널 우수작 목록 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  try {
    return NextResponse.json({ examples: await listExamples(channel) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/examples { channel, content, note? } — 우수작 저장 */
export async function POST(req: NextRequest) {
  try {
    const { channel, content, note } = await req.json();
    if (!isValid(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
    if (!content || !String(content).trim()) return NextResponse.json({ error: "empty content" }, { status: 400 });
    // 저장 시점에 "소재/앵글/확장전략" 요약을 함께 뽑아둔다(브레인스토밍이 문체 오염 없이 참고).
    // provider/키 해석에 실패하거나 요약이 실패해도 원문 저장은 항상 진행(fail-soft).
    const provider = resolveActiveProvider(req) as Provider;
    let auth: { provider: Provider; apiKey: string; model: string } | undefined;
    if (provider && provider !== "mock") {
      const pc = resolveProvider(req, provider as ProviderKey)
        ?? await loadAIConfig(resolveGithubToken(req)).then(c => c.providers[provider as ProviderKey]).catch(() => null);
      if (pc?.apiKey) auth = { provider, apiKey: pc.apiKey, model: pc.model };
    }
    await addExample(channel, String(content), note ? String(note) : undefined, auth);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/examples?id=... — 우수작 삭제 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "no id" }, { status: 400 });
  try {
    await deleteExample(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
