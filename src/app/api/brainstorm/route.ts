import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { resolveProvider, resolveActiveProvider, resolveResearchProvider } from "@/lib/resolveProvider";
import { loadAIConfig, type Provider, type ProviderKey } from "@/lib/aiConfig";
import { resolveGithubToken } from "@/lib/resolveToken";

/**
 * POST /api/brainstorm { topic } — 리서치 기반 브레인스토밍 작업 등록(워커 비동기).
 * 이 라우트는 LLM을 직접 호출하지 않는다 — brainstorm_runs row + tasks(job_type='brainstorm')
 * row를 등록만 하고 즉시 { runId }를 반환한다. 실제 research/research-voice/brainstorm
 * 실행은 워커(render-worker)가 이 task를 집어 처리한다(웹서치 포함 다중 LLM 호출이라
 * Vercel 서버리스에서 동기로 붙들면 타임아웃 위험 — 기존 /api/generate 큐 패턴 재사용).
 */
export async function POST(req: NextRequest) {
  try {
    const { topic, provider: providerOverride, skipResearch, skipResearchVoice, skipResearchDeep, skipSkeleton, topicFilterAccumulated, autoSkipIfAccumulated, autoSkipThreshold, contextBudget } = (await req.json()) as {
      topic?: string; provider?: string;
      skipResearch?: boolean; skipResearchVoice?: boolean; skipResearchDeep?: boolean; skipSkeleton?: boolean;
      topicFilterAccumulated?: boolean;
      autoSkipIfAccumulated?: boolean; autoSkipThreshold?: number;
      contextBudget?: string;
    };
    if (!topic?.trim()) return NextResponse.json({ error: "주제를 입력해주세요." }, { status: 400 });

    const token = resolveGithubToken(req) || null;
    // page에서 선택한 provider를 우선 사용(없으면 쿠키 활성 provider) — /api/generate와 동일 패턴.
    const provider = (providerOverride || resolveActiveProvider(req) || "mock") as Provider;

    let apiKey: string | null = null;
    // 브라우저에서 고른 모델 — 워커 task에 실어 보내 brainstorm/finalize/generate 전 단계에서
    // env/기본값 대신 이 모델을 쓰게 한다(/api/generate와 동일 패턴).
    let model: string | null = null;
    if (provider !== "mock") {
      const pc = resolveProvider(req, provider as ProviderKey)
        ?? await loadAIConfig(token ?? undefined).then(c => c.providers[provider as ProviderKey]).catch(() => null);
      if (!pc?.apiKey) {
        return NextResponse.json(
          { error: `${provider} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력하고 저장해주세요.` },
          { status: 400 }
        );
      }
      apiKey = pc.apiKey;
      model = pc.model || null;
    }

    const researchProvider = resolveResearchProvider(req);

    const { data: run, error: runErr } = await supabase
      .from("brainstorm_runs")
      .insert({
        topic_seed: topic.trim(), provider, model, research_provider: researchProvider,
        skip_research: !!skipResearch, skip_research_voice: !!skipResearchVoice, skip_research_deep: !!skipResearchDeep,
        skip_skeleton: !!skipSkeleton,
        topic_filter_accumulated: topicFilterAccumulated ?? true,
        auto_skip_if_accumulated: !!autoSkipIfAccumulated,
        auto_skip_threshold: autoSkipThreshold ?? 10,
        context_budget: contextBudget || null, status: "pending",
      })
      .select("id")
      .single();
    if (runErr || !run) throw new Error(runErr?.message ?? "brainstorm_runs 생성 실패");

    const { error: taskErr } = await supabase.from("tasks").insert({
      channel: null,
      topic: topic.trim(),
      status: "pending",
      provider,
      api_key: apiKey,
      model,
      github_token: token,
      job_type: "brainstorm",
      run_id: run.id,
    });
    if (taskErr) throw new Error(`작업 등록 실패: ${taskErr.message}`);

    return NextResponse.json({ runId: run.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/brainstorm?runId=... — 브레인스토밍 진행 상태·후보 폴링.
 * skeleton_content/research_deep_content도 함께 반환 — 후보 폴링 중엔 아직 null이고,
 * finalize 완료 후 results 화면에서 "근거 보기"가 이 값을 lazy 1회 조회한다(폴링 아님).
 */
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId") ?? "";
  if (!runId) return NextResponse.json({ error: "runId가 필요합니다." }, { status: 400 });
  try {
    const { data, error } = await supabase
      .from("brainstorm_runs")
      .select("status, candidates, error, skeleton_content, research_deep_content")
      .eq("id", runId)
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "run을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
