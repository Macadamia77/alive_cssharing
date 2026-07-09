import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { CHANNELS, type ChannelKey } from "@/lib/channels";
import { resolveGithubToken } from "@/lib/resolveToken";
import { type ProviderKey } from "@/lib/aiConfig";
import { resolveProvider, resolveActiveProvider, resolveResearchProvider } from "@/lib/resolveProvider";
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
      topic = "",
      draft = "",
      angle = "",
      channels: requestedChannels,
      provider: providerOverride,
      suggestions,
      runId,
      selectedCandidateIndex,
      userDraft,
      doResearch,
      reimprove,
      reimproveChannels,
      improveDirection,
      researchMode,
      contextBudget,
    } = (await req.json()) as {
      topic?: string;
      draft?: string;
      angle?: string;
      channels?: string[];
      provider?: string;
      suggestions?: string[];
      runId?: string;
      selectedCandidateIndex?: number;
      userDraft?: string;
      doResearch?: boolean;
      reimprove?: boolean;
      reimproveChannels?: string[];
      improveDirection?: string;
      researchMode?: "reuse" | "accumulated" | "fresh";
      contextBudget?: string;
    };

    const token = resolveGithubToken(req) || null;
    const activeProvider = providerOverride || resolveActiveProvider(req) || "mock";
    let activeApiKey: string | null = null;
    // 브라우저 설정에서 고른 모델(예: gemini-3.5-flash) — 워커 task에 실어 보내 env/기본값
    // 대신 이 모델로 생성하게 한다(이전엔 model이 버려져 워커가 항상 GEMINI_MODEL env나
    // 코드 기본값만 썼음 — 브라우저 모델 선택이 새 브레인스토밍 파이프라인에 전혀 안 먹혔던 갭).
    let activeModel: string | null = null;
    if (activeProvider !== "mock") {
      const resolved = resolveProvider(req, activeProvider as ProviderKey);
      activeApiKey = resolved?.apiKey || null;
      activeModel = resolved?.model || null;
    }
    const researchProvider = resolveResearchProvider(req);
    const targetChannels: ChannelKey[] = Array.isArray(requestedChannels)
      ? requestedChannels.filter((c): c is ChannelKey => CHANNELS.includes(c as ChannelKey))
      : [];

    // ── [M8 재개선] 결과가 맘에 안 들 때: 선택 채널만 방향을 주고 다시 개선 ──
    if (reimprove && runId) {
      if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase 설정이 필요합니다." }, { status: 400 });
      const reChannels: ChannelKey[] = (Array.isArray(reimproveChannels) ? reimproveChannels : [])
        .filter((c): c is ChannelKey => CHANNELS.includes(c as ChannelKey));
      if (reChannels.length === 0) return NextResponse.json({ error: "재개선할 채널을 선택해주세요." }, { status: 400 });
      const mode = researchMode ?? "reuse";

      const { data: run } = await supabase.from("brainstorm_runs")
        .select("user_draft, selected_topic, improve_mode, context_budget").eq("id", runId).single();
      if (!run) return NextResponse.json({ error: "run을 찾을 수 없습니다." }, { status: 404 });

      // 재개선 상태를 run에 기록(fresh 경로의 finalize + 워커 insertGenerateTasksForRun이 참조)
      const { error: upErr } = await supabase.from("brainstorm_runs").update({
        improve_direction: improveDirection?.trim() || null,
        reimprove_channels: reChannels,
        reimprove_research_mode: mode,
      }).eq("id", runId);
      if (upErr) throw new Error(`재개선 상태 저장 실패: ${upErr.message}`);

      // 타깃 삭제: 이번에 재개선하는 채널의 기존 generate task만(다른 채널 결과는 보존)
      await supabase.from("tasks").delete().eq("run_id", runId).eq("job_type", "generate").in("channel", reChannels);

      if (mode === "fresh") {
        // 새 리서치: finalize 재실행(research-deep 다시) → 워커가 reimprove_channels만 재생성
        await supabase.from("tasks").delete().eq("run_id", runId).eq("job_type", "finalize");
        const { error: fErr } = await supabase.from("tasks").insert({
          channel: null, topic: null, status: "pending",
          provider: activeProvider, api_key: activeApiKey, model: activeModel,
          github_token: token, job_type: "finalize", run_id: runId,
        });
        if (fErr) throw new Error(`재개선 finalize 등록 실패: ${fErr.message}`);
      } else {
        // reuse/accumulated: 기존 저장 리서치 재사용 → generate task 직접 생성(선택 채널만)
        const isImprove = !!run.improve_mode;
        const topicForTasks = (run.selected_topic || (isImprove ? (run.user_draft || "").slice(0, 60) : "")) || "";
        const rows = reChannels.map((channel) => ({
          channel, topic: topicForTasks,
          draft: isImprove ? (run.user_draft || "") : "",
          status: "pending",
          provider: activeProvider, api_key: activeApiKey, model: activeModel, github_token: token,
          improve_direction: improveDirection?.trim() || null,
          use_accumulated: mode === "accumulated",
          context_budget: run.context_budget || null,
          job_type: "generate", run_id: runId,
        }));
        const { error: gErr } = await supabase.from("tasks").insert(rows);
        if (gErr) throw new Error(`재개선 generate 등록 실패: ${gErr.message}`);
      }
      return NextResponse.json({ success: true, runId });
    }

    // ── 모드 A(runId)/모드 B(userDraft): 브레인스토밍 run 기반 finalize 작업 등록.
    // 워커가 finalize 작업(research-deep+skeleton) 완료 후 채널별 generate task를 직접
    // insert한다(갭2) — 여기선 finalize task 하나만 등록하고 즉시 반환(워커 비동기).
    if (runId || userDraft?.trim()) {
      if (!isSupabaseConfigured()) {
        return NextResponse.json({ error: "이 모드는 Supabase 설정이 필요합니다." }, { status: 400 });
      }
      if (targetChannels.length === 0) {
        return NextResponse.json({ error: "채널을 하나 이상 선택해주세요." }, { status: 400 });
      }

      let resolvedRunId = runId;
      if (runId) {
        if (typeof selectedCandidateIndex !== "number") {
          return NextResponse.json({ error: "selectedCandidateIndex가 필요합니다." }, { status: 400 });
        }
        const { error: updateErr } = await supabase.from("brainstorm_runs").update({
          selected_candidate_idx: selectedCandidateIndex,
          channels: targetChannels,
          research_provider: researchProvider,
          // 일반 생성이므로 이전 재개선 상태 초기화(안 하면 finalize가 부분집합만 생성).
          reimprove_channels: null,
          improve_direction: null,
          reimprove_research_mode: null,
        }).eq("id", runId);
        if (updateErr) throw new Error(`brainstorm_runs 업데이트 실패: ${updateErr.message}`);
      } else {
        const { data: run, error: runErr } = await supabase.from("brainstorm_runs").insert({
          user_draft: userDraft!.trim(),
          // [결정 #11] 사용자가 '핵심 주제(한 줄)'를 채웠으면 그대로 저장 → 워커 research-deep가
          // 초안 전체 대신 이 한 줄로 특화 검색어를 만든다. 비었으면 null(워커가 초안에서 추출).
          selected_topic: topic.trim() || null,
          channels: targetChannels,
          do_research: doResearch ?? true,
          improve_mode: true,
          provider: activeProvider,
          model: activeModel,
          research_provider: researchProvider,
          context_budget: contextBudget || null,
          status: "pending",
        }).select("id").single();
        if (runErr || !run) throw new Error(runErr?.message ?? "brainstorm_runs 생성 실패");
        resolvedRunId = run.id;
      }

      // 재생성 대비 idempotency: 같은 run의 이전 finalize/generate task를 먼저 지운다.
      // (후보로 돌아가 다시 생성하면 같은 run_id에 task가 누적돼, 폴링이 옛 완료본을 먼저
      //  보여줬다가 새 task로 바뀌는 "완료→대기→새 결과" 플리커가 났음. 정리 후 삽입으로 제거.)
      await supabase.from("tasks").delete().eq("run_id", resolvedRunId).in("job_type", ["finalize", "generate"]);

      const { error: taskErr } = await supabase.from("tasks").insert({
        channel: null,
        topic: topic.trim() || null,
        status: "pending",
        provider: activeProvider,
        api_key: activeApiKey,
        model: activeModel,
        github_token: token,
        job_type: "finalize",
        run_id: resolvedRunId,
      });
      if (taskErr) throw new Error(`작업 등록 실패: ${taskErr.message}`);

      return NextResponse.json({ success: true, runId: resolvedRunId });
    }

    // ── 하위호환: draft를 직접 전달하는 기존 경로(shared 단계 없이 즉시 채널별 생성) ──
    if (!topic?.trim()) {
      return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });
    }
    const directChannels: ChannelKey[] = targetChannels.length > 0 ? targetChannels : [...CHANNELS];

    // ── Supabase 미설정 시 로컬 백그라운드 생성 ────────────────
    if (!isSupabaseConfigured()) {
      const resultId = makeResultId();
      const taskIds = directChannels.map((channel) => `local_${resultId}_${channel}`);

      taskIds.forEach((id) => writeTask(id, { status: "pending" }));

      void (async () => {
        const resultsDir = join(process.cwd(), "data", "results");
        mkdirSync(resultsDir, { recursive: true });
        const channelResults: Record<string, string> = {};

        await Promise.all(
          directChannels.map(async (channel) => {
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
        tasks: directChannels.map((channel) => ({
          channel,
          taskId: `local_${resultId}_${channel}`,
        })),
      });
    }

    // 네이버 블로그는 실검색·자기검증 파이프라인을 위해 항상 Claude로 강제한다
    const isBlogRequested = directChannels.includes("naver-blog");
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
    const tasksData = directChannels.map((channel) => {
      const isBlog = channel === "naver-blog" && activeProvider !== "mock";
      return {
        topic: topic.trim(),
        draft,
        channel,
        status: "pending",
        provider: isBlog ? "claude" : activeProvider,
        api_key: isBlog ? blogApiKey : activeApiKey,
        // isBlog는 provider를 claude로 강제하므로, activeProvider(다른 provider)의 모델 문자열을
        // 그대로 넘기면 provider-모델 불일치가 난다 — 그 경우는 null(claude 기본값/env로 해석).
        model: isBlog ? null : activeModel,
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

    // ── 모드 A/B(finalize 경유) 폴링: run_id로 진행상태 + 채널 생성 task 목록을 한 번에 반환.
    // finalize가 research-deep+skeleton을 끝내고 채널별 generate task를 만들 때까지 tasks는
    // 비어 있다 → 프론트는 tasks가 채워질 때까지 finalizeStage/runStatus로 진행을 보여준다.
    const runId = searchParams.get("runId");
    if (runId) {
      const { data: run } = await supabase
        .from("brainstorm_runs").select("status, error, selected_topic").eq("id", runId).single();
      const { data: finalizeTask } = await supabase
        .from("tasks").select("status").eq("run_id", runId).eq("job_type", "finalize").maybeSingle();
      const { data: genTasks } = await supabase
        .from("tasks").select("id, channel, status, result, error, card_assets")
        .eq("run_id", runId).eq("job_type", "generate");
      return NextResponse.json({
        runStatus: run?.status ?? "unknown",
        runError: run?.error ?? null,
        // [M8 함정1] 보관함 제목용 — 모드 B는 후보가 없어 프론트가 이걸 제목으로 씀(초안서 추출/입력한 한 줄).
        selectedTopic: run?.selected_topic ?? null,
        finalizeStage: finalizeTask?.status ?? null,
        tasks: (genTasks ?? []).map((t) => ({
          taskId: t.id, channel: t.channel, status: t.status,
          result: t.result, error: t.error, cardAssets: t.card_assets ?? undefined,
        })),
      });
    }

    const taskId = searchParams.get("taskId");
    if (!taskId) {
      return NextResponse.json({ error: "taskId 또는 runId가 필요합니다." }, { status: 400 });
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
      .select("status, result, error, card_assets")
      .eq("id", taskId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      status: task.status,
      result: task.result,
      error: task.error,
      cardAssets: task.card_assets ?? undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
