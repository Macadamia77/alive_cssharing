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

    // 네이버 블로그는 실검색·자기검증 파이프라인을 위해 항상 Claude로 강제한다
    // (mock 모드는 실제 API를 호출하지 않으므로 예외).
    const isBlogRequested = targetChannels.includes("naver-blog");
    let blogApiKey: string | null = null;
    if (isBlogRequested && activeProvider !== "mock") {
      const blogProvider = resolveProvider(req, "claude");
      if (!blogProvider) {
        return NextResponse.json(
          { error: "네이버 블로그 채널은 Claude API 키가 필요합니다. 설정 페이지에서 Claude API 키를 등록해주세요." },
          { status: 400 }
        );
      }
      blogApiKey = blogProvider.apiKey;
    }

    const tasksData = targetChannels.map((channel) => {
      const isBlog = channel === "naver-blog" && activeProvider !== "mock";
      return {
        topic: topic.trim(),
        draft,
        channel,
        status: "pending",
        provider: isBlog ? "claude" : activeProvider,
        api_key: isBlog ? blogApiKey : activeApiKey,
        suggestions: suggestions || null,
        github_token: token,
      };
    });

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
