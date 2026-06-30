import { NextRequest, NextResponse } from "next/server";
import { CHANNELS, type ChannelKey } from "@/lib/channels";
import { resolveGithubToken } from "@/lib/resolveToken";
import { type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";
import { supabase } from "@/lib/supabaseClient";

export const maxDuration = 300;

// ─── POST /api/generate ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      topic,
      draft = "",
      channels: requestedChannels,
      provider: providerOverride,
      suggestions,
    } = (await req.json()) as {
      topic: string;
      draft?: string;
      channels?: string[];
      provider?: string;
      suggestions?: string[];
    };

    if (!topic?.trim()) {
      return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });
    }

    const targetChannels: ChannelKey[] = Array.isArray(requestedChannels)
      ? requestedChannels.filter((c): c is ChannelKey => CHANNELS.includes(c as ChannelKey))
      : [...CHANNELS];

    if (targetChannels.length === 0) {
      return NextResponse.json({ error: "채널을 하나 이상 선택해주세요." }, { status: 400 });
    }

    const token = resolveGithubToken(req) || null;

    const activeProvider = providerOverride || resolveActiveProvider(req) || "mock";
    let activeApiKey: string | null = null;
    if (activeProvider !== "mock") {
      const resolved = resolveProvider(req, activeProvider as ProviderKey);
      activeApiKey = resolved?.apiKey || null;
    }

    const tasksData = targetChannels.map((channel) => ({
      topic: topic.trim(),
      draft,
      channel,
      status: "pending",
      provider: activeProvider,
      api_key: activeApiKey,
      suggestions: suggestions || null,
      github_token: token,
    }));

    const { data: insertedTasks, error: dbError } = await supabase
      .from("tasks")
      .insert(tasksData)
      .select("id, channel");

    if (dbError) {
      throw new Error(`작업 등록 실패: ${dbError.message}`);
    }

    return NextResponse.json({
      success: true,
      tasks: insertedTasks.map((t) => ({
        channel: t.channel,
        taskId: t.id,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "작업 요청에 실패했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");
    if (!taskId) {
      return NextResponse.json({ error: "taskId가 필요합니다." }, { status: 400 });
    }

    const { data: task, error } = await supabase
      .from("tasks")
      .select("status, result, error")
      .eq("id", taskId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      status: task.status,
      result: task.result,
      error: task.error
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
