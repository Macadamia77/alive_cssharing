import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { CHANNELS, type ChannelKey } from "@/lib/channels";
import { resolveGithubToken } from "@/lib/resolveToken";
import { type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider } from "@/lib/resolveProvider";
import { supabase } from "@/lib/supabaseClient";
import {
  generateContent as agentGenerateContent,
  runAgentPipeline as agentRunPipeline,
} from "@/lib/agentRunner";
import { hasAgentPipeline, buildSystemPrompt } from "@/lib/channelFiles";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  return url.length > 0 && !url.includes("placeholder");
}

function makeResultId(): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

// 로컬 모드 태스크 상태를 파일로 저장 (모듈 리로드에 안전)
function getTaskPath(taskId: string) {
  const dir = join(process.cwd(), "data", "results", ".tasks");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${taskId.replace(/[/\\:*?"<>|]/g, "_")}.json`);
}

function writeTask(taskId: string, data: object) {
  try { writeFileSync(getTaskPath(taskId), JSON.stringify(data), "utf-8"); } catch {}
}

function readTask(taskId: string): { status: string; result?: string; error?: string } | null {
  try {
    const raw = readFileSync(getTaskPath(taskId), "utf-8");
    return JSON.parse(raw);
  } catch { return null; }
}

export const maxDuration = 300;

// ─── POST /api/generate ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      topic,
      draft = "",
      angle = "",
      channels: requestedChannels,
      provider: providerOverride,
      suggestions,
    } = (await req.json()) as {
      topic: string;
      draft?: string;
      angle?: string;
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

    // ── Supabase 미설정 시 로컬 백그라운드 생성 ────────────────
    if (!isSupabaseConfigured()) {
      const resultId = makeResultId();
      const taskIds = targetChannels.map((channel) => `local_${resultId}_${channel}`);

      taskIds.forEach((id) => writeTask(id, { status: "pending" }));

      void (async () => {
        const resultsDir = join(process.cwd(), "data", "results");
        mkdirSync(resultsDir, { recursive: true });
        const channelResults: Record<string, string> = {};

        await Promise.all(
          targetChannels.map(async (channel) => {
            const taskId = `local_${resultId}_${channel}`;
            try {
              let content: string;
              const usePipeline = await hasAgentPipeline(channel, token ?? undefined);
              if (usePipeline) {
                content = await agentRunPipeline(
                  channel, topic.trim(), draft,
                  token ?? undefined,
                  activeProvider as import("@/lib/aiConfig").Provider,
                  undefined,
                  activeApiKey ?? undefined
                );
              } else {
                const systemPrompt = await buildSystemPrompt(channel, token ?? undefined);
                content = await agentGenerateContent(
                  channel, topic.trim(), draft, systemPrompt,
                  activeProvider as import("@/lib/aiConfig").Provider,
                  token ?? undefined,
                  suggestions ?? [],
                  activeApiKey ?? undefined,
                  angle
                );
              }
              channelResults[channel] = content;
              writeTask(taskId, { status: "done", result: content });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              writeTask(taskId, { status: "error", error: msg });
            }
          })
        );

        writeFileSync(
          join(resultsDir, `${resultId}.json`),
          JSON.stringify({
            id: resultId,
            topic: topic.trim(),
            createdAt: new Date().toISOString(),
            channels: channelResults,
          }, null, 2),
          "utf-8"
        );
      })();

      return NextResponse.json({
        success: true,
        tasks: targetChannels.map((channel) => ({
          channel,
          taskId: `local_${resultId}_${channel}`,
        })),
      });
    }

    // 네이버 블로그는 실검색·자기검증 파이프라인을 위해 항상 Claude로 강제한다
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

    // ── Supabase 비동기 큐 등록 ──────────────────────────────────
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

    // ── 로컬 백그라운드 생성 결과 조회 ───────────────────────
    if (taskId.startsWith("local_")) {
      const task = readTask(taskId);
      if (!task || task.status === "pending") {
        return NextResponse.json({ status: "pending" });
      }
      if (task.status === "error") {
        return NextResponse.json({ status: "error", error: task.error });
      }
      return NextResponse.json({ status: "completed", result: task.result });
    }

    // ── Supabase 큐 조회 ─────────────────────────────────────
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
