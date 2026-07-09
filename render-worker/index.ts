import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import { runAgentPipeline, generateContent, runInstagramStructuralQc } from "../src/lib/agentRunner";
import { hasAgentPipeline, buildSystemPrompt, getChannelMeta } from "../src/lib/channelFiles";
import { runPipeline } from "../src/lib/pipeline/runPipeline";
import type { CardAsset } from "../src/lib/pipeline/cardStorage";
// M5: 채널 배정 이전(브레인스토밍) 작업용 — 채널에 안 묶인 공용 인증·페르소나·호출 유틸 재사용.
import { loadPipelineConfig } from "../src/lib/pipeline/loadConfig";
import { createAuthResolver } from "../src/lib/pipeline/auth";
import { runSharedProducerStage } from "../src/lib/pipeline/producerStage";
import { loadPersona, stripCodeFence } from "../src/lib/pipeline/promptAssembly";
import { callProvider } from "../src/lib/apiClients";
import {
  getRecentResearch, getRecentExampleSummariesAny, getRecentFeedbackAny, contextBudget,
} from "../src/lib/pipelineMemory";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("[Worker] Supabase URL 또는 Key가 설정되지 않았습니다. 프로세스를 종료합니다.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("[Worker] 백그라운드 일꾼 프로세스가 시작되었습니다. 작업 대기 중...");

// 한 번에 동시 처리할 최대 작업 수
const MAX_CONCURRENT = 5;

// ── M5: 브레인스토밍 작업(job_type='brainstorm') ──────────────────
// 채널이 아직 없는 시점(주제 단계)에서 research+research-voice를 병렬 실행하고,
// 그 산출물 + 누적 리서치/우수작 요약/피드백을 근거로 brainstorm 페르소나가 주제 후보
// 여러 개를 순위·사유와 함께 낸다. 결과는 brainstorm_runs에 저장 — 여러 채널이 이후 공유.
// mock provider용 후보(실제 LLM 미호출) — runPipeline.ts의 `provider==='mock'` 얼리리턴과
// 동일한 성격. mock으로 브레인스토밍 UI/폴링 흐름을 키 없이도 검증할 수 있게 한다.
function mockCandidates(topic: string) {
  return Array.from({ length: 8 }, (_, i) => ({
    rank: i + 1,
    topic: `[mock] ${topic} 후보 ${i + 1}`,
    core_question: "mock 질문",
    core_claim: "mock 주장",
    angle: "mock 관점",
    reason: "mock 모드 — 실제 리서치 없이 생성된 더미 후보입니다.",
    cited_research: [],
    overlap_check: "해당 없음(mock)",
    outline: "도입 → 전개1 → 전개2 → 결론 (mock)",
  }));
}

async function processBrainstormJob(task: any) {
  const runId = task.run_id as string;
  const { data: run, error: runFetchErr } = await supabase
    .from("brainstorm_runs").select("*").eq("id", runId).single();
  if (runFetchErr || !run) throw new Error(`brainstorm_runs 조회 실패: ${runFetchErr?.message ?? "행 없음"}`);

  const topic: string = run.topic_seed || task.topic || "";
  const provider = task.provider || "mock";
  const token = task.github_token || undefined;

  // mock: runPipeline.ts와 동일하게 실제 LLM 호출 없이 즉시 완료 처리(키 없어도 흐름 검증 가능).
  if (provider === "mock") {
    const candidates = mockCandidates(topic);
    const { error } = await supabase.from("brainstorm_runs")
      .update({ candidates, status: "brainstormed" }).eq("id", runId);
    if (error) throw new Error(`brainstorm_runs(mock) 업데이트 실패: ${error.message}`);
    console.log(`[Worker] brainstorm run ${runId} (mock) 완료 — 후보 ${candidates.length}개`);
    return;
  }

  const statusCallback = async (stage: string) => {
    console.log(`[Worker] brainstorm run ${runId} 상태 변경 ➔ ${stage}`);
    await supabase.from("tasks").update({ status: stage }).eq("id", task.id);
  };

  try {
    const { resolveModelFor } = createAuthResolver(token, provider, task.api_key || undefined, task.model || undefined);
    const cfg = loadPipelineConfig();
    const stageMap = new Map(cfg.stages.map(s => [s.id, s] as const));
    const researchDef = stageMap.get("research");
    const voiceDef = stageMap.get("research-voice");
    const brainstormDef = stageMap.get("brainstorm");
    if (!brainstormDef) throw new Error("pipeline.json에 'brainstorm' 단계 정의가 없습니다.");

    await statusCallback("research");
    // 신규 리서치(research/research-voice)와, 그와 무관한 누적 컨텍스트 조회를 한 번에 병렬 실행
    // (전엔 신규 리서치가 끝난 뒤에야 누적 조회를 시작해 불필요하게 순차 대기했고, 방금 넣은
    // fire-and-forget 아카이브와 타이밍이 겹쳐 같은 리서치가 "누적"에도 중복 잡힐 여지가 있었음).
    // [결정 #10] 리서치 전용 provider가 지정돼 있으면 research/research-voice에만 강제 적용
    // (brainstorm 자체 호출은 useSearch가 아니라 base provider 그대로 — 아래서 별도 처리 안 함).
    const researchProviderOverride = run.research_provider || undefined;
    // [M8 #3] 1차 리서치(research/research-voice) 생략 옵션 — 켜면 신규 웹서치 없이 누적 데이터만으로
    // 브레인스토밍. 새 검색 비용·시간 절약(누적 데이터가 쌓였을 때 유용).
    const skipInitial = !!run.skip_initial_research;
    const bud = contextBudget(run.context_budget); // [M8 ④] 참조 예산(주입 건수·길이)
    const [researchOut, voiceOut, recentResearch, recentSummaries, recentFeedback] = await Promise.all([
      (!skipInitial && researchDef)
        ? runSharedProducerStage(researchDef, topic, resolveModelFor, token, runId, (n) => void statusCallback(`소스 ${n}개 검색 중`), researchProviderOverride)
        : Promise.resolve(""),
      (!skipInitial && voiceDef)
        ? runSharedProducerStage(voiceDef, topic, resolveModelFor, token, runId, (n) => void statusCallback(`소스 ${n}개 검색 중`), researchProviderOverride)
        : Promise.resolve(""),
      getRecentResearch(bud.research, bud.researchDays).catch(() => []),
      getRecentExampleSummariesAny(bud.examples).catch(() => []),
      getRecentFeedbackAny(bud.feedback).catch(() => []),
    ]);
    if (skipInitial && recentResearch.length === 0) {
      console.warn(`[Worker] brainstorm run ${runId}: 1차 리서치 생략인데 누적 리서치가 없음 — 근거 없이 진행(후보 품질↓ 가능)`);
    }
    console.log(`[Worker] brainstorm run ${runId}: research ${researchOut.length}자 / research-voice ${voiceOut.length}자${skipInitial ? " (1차 생략, 누적만)" : ""}`);

    const contextParts = [
      researchOut && `[research 산출물]\n${researchOut}`,
      voiceOut && `[research-voice 산출물]\n${voiceOut}`,
      recentResearch.length
        ? `[누적 리서치 요약]\n${recentResearch.map(r => `- (${r.stage}) ${r.content.slice(0, bud.cap)}`).join("\n")}`
        : "",
      recentSummaries.length
        ? `[과거 우수작 요약 — 소재·전략 참고용, 문체 참고 아님]\n${recentSummaries.map(s => `- 소재: ${s.subject} / 앵글: ${s.angle} / 확장: ${s.expansion}`).join("\n")}`
        : "",
      recentFeedback.length
        ? `[누적 피드백 — 반드시 반영]\n${recentFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");

    await statusCallback("brainstorm");
    const brainstormPersona = await loadPersona(null, brainstormDef.persona ?? brainstormDef.id, token);
    if (!brainstormPersona) throw new Error("brainstormer.md 페르소나 파일을 찾을 수 없습니다.");
    const bAuth = await resolveModelFor({ model: brainstormDef.model, modelId: brainstormDef.modelId, stageId: "brainstorm" });
    const baseUser =
      `[주제]\n${topic}\n\n` +
      (contextParts ? `${contextParts}\n\n` : "") +
      `위 자료를 바탕으로 절차대로 후보를 발산·정리해 출력 형식 그대로 JSON만 출력하세요.`;

    // 대형 구조화 출력(≈9개 후보) 파싱 실패 시 1회 repair 재시도.
    let candidates: unknown[] | null = null;
    let lastRaw = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const user = attempt === 1
        ? baseUser
        : `${baseUser}\n\n[이전 응답이 유효한 JSON이 아니었습니다. 다른 텍스트 없이 지정된 JSON 형식만 다시 출력하세요.]`;
      lastRaw = stripCodeFence(await callProvider(bAuth.p, bAuth.apiKey, bAuth.model, brainstormPersona, user, brainstormDef.maxTokens ?? 8000, {
        thinkingBudget: brainstormDef.thinking?.budgetTokens,
      }));
      const m = lastRaw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]) as { candidates?: unknown[] };
          if (Array.isArray(parsed.candidates) && parsed.candidates.length > 0) { candidates = parsed.candidates; break; }
        } catch { /* 다음 시도 또는 실패 처리 */ }
      }
      console.warn(`[Worker] brainstorm run ${runId}: JSON 파싱 실패(시도 ${attempt}/2)`);
    }
    if (!candidates) throw new Error(`브레인스토밍 결과 JSON 파싱 실패(2회 시도). 원본 일부: ${lastRaw.slice(0, 300)}`);

    const { error: updateErr } = await supabase.from("brainstorm_runs").update({
      research_content: { research: researchOut, researchVoice: voiceOut },
      candidates,
      status: "brainstormed",
    }).eq("id", runId);
    if (updateErr) throw new Error(`brainstorm_runs 업데이트 실패: ${updateErr.message}`);

    console.log(`[Worker] brainstorm run ${runId} 완료 — 후보 ${candidates.length}개`);
  } catch (e: any) {
    // tasks뿐 아니라 brainstorm_runs 자체도 실패로 기록 — 안 그러면 프론트 폴링이 'pending'에서
    // 영원히 멈춘다(M2에서 만든 status/error 컬럼을 실제로 쓴다).
    try {
      await supabase.from("brainstorm_runs")
        .update({ status: "failed", error: e.message || String(e) })
        .eq("id", runId);
    } catch (dbErr) {
      console.error(`[Worker] brainstorm_runs 실패 기록 중 DB 오류 (run ${runId}):`, dbErr);
    }
    throw e;
  }
}

// ── M6: finalize 작업(job_type='finalize') ────────────────────────
// 모드 A(주제 확정)는 선택된 후보 기준 research-deep, 모드 B(초안 개선)는 doResearch가
// 켜져 있을 때만 research-deep을 돌린 뒤 skeleton을 실행하고, 그 결과를 brainstorm_runs에
// 저장한다. 완료되면 그 자리에서 channels 만큼 job_type='generate' task를 insert한다(갭2) —
// 생성 task는 skeleton이 준비된 이후에야 존재하므로 큐에 별도 의존성 기능이 필요 없다.
async function insertGenerateTasksForRun(run: any, task: any, selectedTopic: string): Promise<number> {
  // [M8 재개선] reimprove_channels가 있으면 그 부분집합만 (재)생성한다(전체 아님).
  const channels: string[] = (Array.isArray(run.reimprove_channels) && run.reimprove_channels.length)
    ? run.reimprove_channels
    : (Array.isArray(run.channels) ? run.channels : []);
  if (channels.length === 0) throw new Error("brainstorm_runs.channels가 비어 있습니다.");
  const isImproveMode = !!run.improve_mode;
  // [결정 #11] task.topic도 selected_topic(사용자 입력 또는 초안에서 추출한 한 줄)으로 통일한다.
  // 이전엔 모드 B에서 초안 앞부분(slice)을 주제로 보여줘 사용자가 "결과 카드 제목"과 실제 리서치·
  // 스켈레톤이 쓴 주제가 달라 헷갈릴 수 있었다. selected_topic이 비었을 때만(mock 등) 초안 앞부분으로 폴백.
  const topicForTasks = selectedTopic || (isImproveMode ? (run.user_draft || "").slice(0, 60) : "") || task.topic || "";
  const rows = channels.map((channel) => ({
    channel,
    topic: topicForTasks,
    draft: isImproveMode ? (run.user_draft || "") : "",
    status: "pending",
    provider: task.provider,
    api_key: task.api_key,
    github_token: task.github_token,
    model: task.model || null,
    // [M8 재개선] 방향·누적참조를 채널 task에 실어 writer가 반영
    improve_direction: run.improve_direction || null,
    use_accumulated: run.reimprove_research_mode === "accumulated",
    context_budget: run.context_budget || null, // [M8 ④] 참조 예산 승계
    job_type: "generate",
    run_id: run.id,
  }));
  // 워커-레벨 idempotency: 삽입 전 이 run의 기존 generate task를 제거한다(중복 방어).
  // [M8 재개선] 단, "지금 (재)생성하는 채널"만 지운다 — 재개선 안 한 다른 채널 결과는 보존.
  await supabase.from("tasks").delete().eq("run_id", run.id).eq("job_type", "generate").in("channel", channels);
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) throw new Error(`채널별 generate task 등록 실패: ${error.message}`);
  return rows.length;
}

// [결정 #12] 사용자가 고른 후보의 기획 의도(중심질문·핵심주장·관점·개요)를 하위 단계(skeleton·writer)로
// 승계하는 블록. 지금까지는 `.topic`(제목)만 흘러가 skeleton이 제목만으로 구조를 재발명했다.
// Mode A 전용 — candidates/selected_candidate_idx가 있을 때만 채워지고, 없으면(모드 B 등) 빈 문자열.
function buildSelectedBriefBlock(run: any): string {
  const candidates = Array.isArray(run.candidates) ? run.candidates : [];
  const idx = run.selected_candidate_idx;
  if (typeof idx !== "number" || !candidates[idx]) return "";
  const c = candidates[idx];
  const lines = [
    c.topic ? `- 주제: ${c.topic}` : "",
    c.core_question ? `- 중심 질문: ${c.core_question}` : "",
    c.core_claim ? `- 핵심 주장: ${c.core_claim}` : "",
    c.angle ? `- 관점: ${c.angle}` : "",
    c.outline ? `- 개요: ${c.outline}` : "",
  ].filter(Boolean);
  return lines.length ? `[선정 기획안]\n${lines.join("\n")}` : "";
}

// [결정 #11] 모드 B에서 사용자가 '핵심 주제(한 줄)'를 안 넣었을 때, 초안에서 한 줄 주제를 값싸게 추출한다.
// research-deep가 초안 전체가 아니라 한 줄 주제로 특화 검색어를 만들게 하기 위함(mismatch 제거).
// LLM 실패 시 초안 앞부분으로 폴백(fail-soft) — finalize 전체가 죽지 않게.
async function extractTopicFromDraft(draft: string, resolveModelFor: any): Promise<string> {
  const fallback = draft.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!draft.trim()) return "";
  try {
    const auth = await resolveModelFor({ stageId: "topic-extract" });
    const system = "너는 편집자다. 주어진 초안이 다루는 핵심 주제를 한국어 한 줄(30자 이내, 명사구)로만 답한다. 설명·따옴표·접두어 없이 주제만 출력한다.";
    const user = `[초안]\n${draft.slice(0, 4000)}\n\n이 초안의 핵심 주제를 한 줄로:`;
    const out = (await callProvider(auth.p, auth.apiKey, auth.model, system, user, 120, {})).trim();
    const firstLine = out.split("\n").map((l: string) => l.trim()).filter(Boolean)[0] || "";
    return firstLine.slice(0, 80) || fallback;
  } catch (e) {
    console.warn(`[Worker] 초안 주제 추출 실패 — 초안 앞부분으로 폴백:`, e);
    return fallback;
  }
}

// [작업 4] 협조적 취소: 재생성 POST는 이 run의 finalize task row를 지운다. 워커는 비싼 단계
// 직전마다 "내 task row가 아직 있나?"를 재조회해, 없으면(=새 세대가 시작됨) 즉시 중단한다.
// in-flight LLM 호출은 못 멈추지만 다음 단계부터 스킵해 낭비를 최소화한다(틀린 결과 저장도 방지).
async function isTaskAlive(taskId: string): Promise<boolean> {
  const { data } = await supabase.from("tasks").select("id").eq("id", taskId).maybeSingle();
  return !!data;
}

async function processFinalizeJob(task: any) {
  const runId = task.run_id as string;
  const { data: run, error: runFetchErr } = await supabase
    .from("brainstorm_runs").select("*").eq("id", runId).single();
  if (runFetchErr || !run) throw new Error(`brainstorm_runs 조회 실패: ${runFetchErr?.message ?? "행 없음"}`);

  const provider = task.provider || "mock";
  const token = task.github_token || undefined;
  const isImproveMode = !!run.improve_mode;

  let selectedTopic = "";
  if (!isImproveMode) {
    const candidates = Array.isArray(run.candidates) ? run.candidates : [];
    const idx = run.selected_candidate_idx;
    if (typeof idx !== "number" || !candidates[idx]) throw new Error("선택된 후보를 찾을 수 없습니다(selected_candidate_idx).");
    selectedTopic = candidates[idx].topic || run.topic_seed || task.topic || "";
  } else {
    // [결정 #11] 모드 B: 사용자가 준 한 줄 주제를 우선 사용. 비었으면 아래 non-mock 경로에서 초안으로부터 추출.
    selectedTopic = (run.selected_topic || "").trim();
  }

  const statusCallback = async (stage: string) => {
    console.log(`[Worker] finalize run ${runId} 상태 변경 ➔ ${stage}`);
    await supabase.from("tasks").update({ status: stage }).eq("id", task.id);
  };

  // mock: 실제 LLM 호출 없이 즉시 완료 처리(키 없어도 흐름 검증 가능).
  if (provider === "mock") {
    const { error } = await supabase.from("brainstorm_runs").update({
      selected_topic: selectedTopic || null,
      research_deep_content: "[mock] research-deep 생략",
      skeleton_content: "[mock] skeleton 생략",
      status: "finalized",
    }).eq("id", runId);
    if (error) throw new Error(`brainstorm_runs(mock) 업데이트 실패: ${error.message}`);
    const n = await insertGenerateTasksForRun(run, task, selectedTopic);
    console.log(`[Worker] finalize run ${runId} (mock) 완료 — 채널 ${n}개 generate task 등록`);
    return;
  }

  try {
    const { resolveModelFor } = createAuthResolver(token, provider, task.api_key || undefined, task.model || undefined);
    const cfg = loadPipelineConfig();
    const stageMap = new Map(cfg.stages.map(s => [s.id, s] as const));
    const deepDef = stageMap.get("research-deep");
    const skeletonDef = stageMap.get("skeleton");
    if (!skeletonDef) throw new Error("pipeline.json에 'skeleton' 단계 정의가 없습니다.");

    // 모드A는 항상 research-deep, 모드B는 doResearch 토글(기본 true)을 따른다.
    const shouldResearch = isImproveMode ? (run.do_research ?? true) : true;
    const researchProviderOverride = run.research_provider || undefined;

    // [작업 4] 체크포인트①: 비싼 단계(추출·research-deep) 시작 전. 이미 재생성돼 내 task가 지워졌으면 중단.
    if (!(await isTaskAlive(task.id))) { console.log(`[Worker] finalize run ${runId} 중단 — 새 세대로 대체됨(research-deep 전)`); return; }

    // [결정 #11] 모드 B에서 한 줄 주제가 비었으면 초안에서 값싸게 추출 → research-deep/skeleton이
    // 초안 전체가 아니라 한 줄 주제를 받는다(모드 A/B 입력 형태 통일). 초안 원문은 아래에서 별도 주입.
    if (isImproveMode && !selectedTopic) {
      selectedTopic = await extractTopicFromDraft(run.user_draft || "", resolveModelFor);
    }
    const researchTopic = selectedTopic;

    let deepOut = "";
    if (shouldResearch && deepDef) {
      await statusCallback("research-deep");
      // [M8] 모드 B는 초안 논지 조준형 페르소나(researcher-deep-improve)로, 입력도 한 줄 주제가
      // 아니라 초안 전문을 넣는다. 모드 A는 기존대로 확정 주제(researchTopic)로 심화 검색.
      const deepDefEff = isImproveMode ? { ...deepDef, persona: "researcher-deep-improve" } : deepDef;
      const deepInput = isImproveMode ? (run.user_draft || researchTopic) : researchTopic;
      deepOut = await runSharedProducerStage(
        deepDefEff, deepInput, resolveModelFor, token, runId,
        (n) => void statusCallback(`소스 ${n}개 검색 중`),
        researchProviderOverride,
        // [M8 Q2] 모드 B는 입력이 초안 전문이지만 아카이브엔 한 줄 주제(selected_topic)를 저장
        isImproveMode ? (selectedTopic || undefined) : undefined
      );
    }

    // [작업 4] 체크포인트②: skeleton 호출 직전. research-deep 도중 재생성됐다면 여기서 중단(skeleton 스킵).
    if (!(await isTaskAlive(task.id))) { console.log(`[Worker] finalize run ${runId} 중단 — 새 세대로 대체됨(skeleton 전)`); return; }

    // [M8] 모드 B는 skeleton(구조 재설계)을 건너뛴다 — "충실한 개선"은 원문 구조 보존이 목적이라
    // 새 뼈대가 오히려 방해. 모드 A만 skeleton으로 채널 무관 구조를 설계한다.
    let skeletonOut = "";
    if (!isImproveMode) {
      await statusCallback("skeleton");
      const skeletonPersona = await loadPersona(null, skeletonDef.persona ?? skeletonDef.id, token);
      if (!skeletonPersona) throw new Error("skeleton.md 페르소나 파일을 찾을 수 없습니다.");
      const skAuth = await resolveModelFor({ model: skeletonDef.model, modelId: skeletonDef.modelId, stageId: "skeleton" });
      const contextParts = [
        buildSelectedBriefBlock(run), // [결정 #12] 선정 후보의 각도·핵심주장·개요를 skeleton에 승계(모드 A)
        run.research_content?.research ? `[research 산출물]\n${run.research_content.research}` : "",
        run.research_content?.researchVoice ? `[research-voice 산출물]\n${run.research_content.researchVoice}` : "",
        deepOut ? `[research-deep 산출물]\n${deepOut}` : "",
      ].filter(Boolean).join("\n\n");
      const skeletonUser =
        `[주제]\n${researchTopic}\n\n` +
        (contextParts ? `${contextParts}\n\n` : "") +
        `위 자료를 바탕으로 이 단계의 역할을 수행해 결과를 직접 출력하세요.`;
      skeletonOut = stripCodeFence(await callProvider(skAuth.p, skAuth.apiKey, skAuth.model, skeletonPersona, skeletonUser, skeletonDef.maxTokens ?? 6000, {
        thinkingBudget: skeletonDef.thinking?.budgetTokens,
      }));
    }

    // [작업 4] 체크포인트③: 커밋 직전. skeleton 도중 재생성됐다면 여기서 중단(brainstorm_runs 갱신·채널 task 생성 안 함).
    if (!(await isTaskAlive(task.id))) { console.log(`[Worker] finalize run ${runId} 중단 — 새 세대로 대체됨(커밋 전)`); return; }

    const { error: updateErr } = await supabase.from("brainstorm_runs").update({
      selected_topic: selectedTopic || null,
      research_deep_content: deepOut || null,
      skeleton_content: skeletonOut || null,
      status: "finalized",
    }).eq("id", runId);
    if (updateErr) throw new Error(`brainstorm_runs 업데이트 실패: ${updateErr.message}`);

    const n = await insertGenerateTasksForRun(run, task, selectedTopic);
    console.log(`[Worker] finalize run ${runId} 완료 — 채널 ${n}개 generate task 등록`);
  } catch (e: any) {
    try {
      await supabase.from("brainstorm_runs")
        .update({ status: "failed", error: e.message || String(e) })
        .eq("id", runId);
    } catch (dbErr) {
      console.error(`[Worker] brainstorm_runs(finalize) 실패 기록 중 DB 오류 (run ${runId}):`, dbErr);
    }
    throw e;
  }
}

// pending/completed/failed는 "끝났거나 아직 시작 안 한" 정상 상태. 그 외(예: "writer",
// "tone-review 반영 재작성" 등 statusCallback이 남긴 진행 중 문자열)인데 오래됐다면,
// 그 작업을 처리하던 워커가 중간에 죽었다는 뜻이다(크레딧 소진·프로세스 재시작·크래시 등).
// 이런 작업은 pending이 아니라서 processBatch()가 다시 집어가지도 못하고 영원히 고아로
// 남아 프론트엔드가 완료/실패 응답을 못 받아 무한 로딩처럼 보인다 — 그래서 주기적으로 훑어서
// 강제로 failed 처리한다.
const STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10분 — naver-blog 최악(검수 재시도 3회 등)도 이 안에 끝난다. 프론트 폴링 타임아웃(12분)보다 짧아, 하드 크래시여도 프론트가 자기 타임아웃 전에 명확한 실패 사유를 받는다.
const TERMINAL_STATUSES = ["pending", "completed", "failed"];

async function reapStaleTasks() {
  const cutoff = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString();
  const { data: staleTasks, error } = await supabase
    .from("tasks")
    .select("id, status, created_at, run_id, job_type")
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .lt("created_at", cutoff);

  if (error) {
    console.error("[Worker] stale 작업 조회 중 오류:", error.message);
    return;
  }
  if (!staleTasks || staleTasks.length === 0) return;

  for (const t of staleTasks) {
    const minutesStuck = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
    console.warn(`[Worker] stale 작업 감지 → 자동 실패 처리 (ID: ${t.id}, 마지막 상태: "${t.status}", ${minutesStuck}분 경과)`);
    await supabase
      .from("tasks")
      .update({
        status: "failed",
        error: `타임아웃: "${t.status}" 단계에서 ${minutesStuck}분 넘게 응답이 없어 자동으로 실패 처리했습니다 ` +
          `(워커 중단·API 크레딧 소진 등으로 추정). 다시 시도해주세요.`,
      })
      .eq("id", t.id);

    // 하드 크래시(프로세스 사망)로 processBrainstormJob/processFinalizeJob의 catch가 못 돈 경우,
    // brainstorm_runs.status가 'pending'/'brainstormed'에 멈춰 프론트(brainstorm_runs 폴링)가
    // 실패 신호를 못 받고 자기 타임아웃까지 대기하게 된다. 여기서 run도 함께 failed로 전파해
    // 프론트가 곧바로(다음 폴링 틱에) 명확한 사유로 실패를 보게 한다. generate task는 run이 이미
    // 성공(finalized)한 뒤 나오는 것이라 run을 건드리면 안 되므로 brainstorm/finalize만 전파한다.
    if (t.run_id && (t.job_type === "brainstorm" || t.job_type === "finalize")) {
      const { error: runErr } = await supabase
        .from("brainstorm_runs")
        .update({
          status: "failed",
          error: `타임아웃: ${t.job_type === "brainstorm" ? "브레인스토밍" : "심화 리서치/기획"} 단계가 ` +
            `${minutesStuck}분 넘게 응답이 없어 자동 실패 처리했습니다. 다시 시도해주세요.`,
        })
        .eq("id", t.run_id)
        .neq("status", "failed"); // 이미 failed면 덮어쓰지 않음(멱등)
      if (runErr) console.error(`[Worker] stale run 전파 실패 (run ${t.run_id}):`, runErr.message);
      else console.warn(`[Worker] stale run 전파 → brainstorm_runs ${t.run_id} failed 처리`);
    }
  }
}

// 이미 선점(processing)된 작업 하나를 끝까지 처리한다.
async function processTask(task: any) {
  const activeTaskId: string = task.id;
  try {
    console.log(`[Worker] 작업 시작 (ID: ${task.id}, 타입: ${task.job_type || "generate"}, 채널: ${task.channel}, 주제: ${task.topic})`);

    // job_type이 'generate'가 아니면(브레인스토밍 등) 채널 파이프라인을 안 타고 여기서 처리·종료한다.
    if (task.job_type === "brainstorm") {
      await processBrainstormJob(task);
      await supabase.from("tasks").update({ status: "completed" }).eq("id", task.id);
      console.log(`[Worker] brainstorm 작업 완료 (ID: ${task.id})`);
      return;
    }
    if (task.job_type === "finalize") {
      await processFinalizeJob(task);
      await supabase.from("tasks").update({ status: "completed" }).eq("id", task.id);
      console.log(`[Worker] finalize 작업 완료 (ID: ${task.id})`);
      return;
    }

    const token = task.github_token || undefined;
    // [M6] run_id가 있으면(브레인스토밍 경유) finalize가 저장해둔 리서치+심화+스켈레톤을
    // 이 채널의 sharedContext로 조립한다. 채널별 자체 producer 단계보다 우선 주입된다.
    let sharedContext: string | undefined;
    if (task.run_id) {
      const { data: run } = await supabase.from("brainstorm_runs").select("*").eq("id", task.run_id).single();
      if (run) {
        const parts = [
          buildSelectedBriefBlock(run), // [결정 #12] 선정 후보의 기획 의도를 writer에도 승계(모드 A)
          run.research_content?.research ? `[research 산출물]\n${run.research_content.research}` : "",
          run.research_content?.researchVoice ? `[research-voice 산출물]\n${run.research_content.researchVoice}` : "",
          run.research_deep_content ? `[research-deep 산출물]\n${run.research_deep_content}` : "",
          run.skeleton_content ? `[skeleton 산출물]\n${run.skeleton_content}` : "",
        ].filter(Boolean);
        if (parts.length) sharedContext = parts.join("\n\n");
      }
    }
    // 채널 설정에서 엔진 선택: "pipeline"이면 통합 엔진, 아니면 기존 경로.
    const meta = await getChannelMeta(task.channel, token).catch(() => null);
    const useEngine = meta?.engine === "pipeline";
    const isPipeline = !useEngine && (await hasAgentPipeline(task.channel, token));

    // 진행 상태 실시간 콜백
    const statusCallback = async (stage: string) => {
      console.log(`[Worker] 작업 ${task.id} 상태 변경 ➔ ${stage}`);
      await supabase
        .from("tasks")
        .update({ status: stage })
        .eq("id", task.id);
    };

    // 이미지 카드가 실제 PNG로 캡처·업로드되면 여기 담긴다(image-gen 스테이지가 없는 채널은 계속 빈 배열).
    let cardAssets: CardAsset[] | undefined;
    const onCardAssets = (assets: CardAsset[]) => { cardAssets = assets; };

    let content = "";
    if (useEngine) {
      content = await runPipeline(
        task.channel,
        task.topic,
        task.draft || "",
        token,
        task.provider || "mock",
        statusCallback,
        task.api_key || undefined,
        onCardAssets,
        sharedContext,
        task.model || undefined,
        task.improve_direction || undefined,
        !!task.use_accumulated,
        task.context_budget || undefined
      );
      // runPipeline.ts(공용 엔진)은 건드리지 않고, 인스타그램일 때만 결과물에
      // 기존 JSON 구조 자동검수(카드 수·items 개수·해시태그 보정 등)를 덧씌운다.
      // 다른 채널은 이 분기를 안 타므로 영향 없다.
      if (task.channel === "instagram") {
        await statusCallback("content-review");
        content = await runInstagramStructuralQc(
          task.channel,
          content,
          task.topic,
          task.draft || "",
          task.provider || "mock",
          token,
          task.api_key || undefined,
          task.model || undefined
        );
      }
    } else if (isPipeline) {
      content = await runAgentPipeline(
        task.channel,
        task.topic,
        task.draft || "",
        token,
        task.provider || "mock",
        statusCallback,
        task.api_key || undefined,
        onCardAssets,
        task.model || undefined,
        task.improve_direction || undefined
      );
    } else {
      await statusCallback("generating");
      const systemPrompt = await buildSystemPrompt(task.channel, token);
      content = await generateContent(
        task.channel,
        task.topic,
        task.draft || "",
        systemPrompt || "",
        task.provider || "mock",
        token,
        task.suggestions || [],
        task.api_key || undefined,
        undefined,
        task.model || undefined,
        task.improve_direction || undefined
      );
    }

    // 완료 업데이트. card_assets 컬럼이 아직 없는 환경(마이그레이션 전)에서도 작업 완료
    // 자체는 항상 성공해야 하므로, 먼저 포함해서 시도하고 실패하면 그 필드만 빼고 재시도한다.
    if (cardAssets && cardAssets.length > 0) {
      const { error: withAssetsError } = await supabase
        .from("tasks")
        .update({ status: "completed", result: content, card_assets: cardAssets })
        .eq("id", task.id);
      if (withAssetsError) {
        console.warn(`[Worker] card_assets 저장 실패(컬럼 미존재 가능성) — 기본 필드만 재저장: ${withAssetsError.message}`);
        await supabase.from("tasks").update({ status: "completed", result: content }).eq("id", task.id);
      }
    } else {
      await supabase
        .from("tasks")
        .update({ status: "completed", result: content })
        .eq("id", task.id);
    }

    console.log(`[Worker] 작업 완료 (ID: ${task.id})`);
  } catch (e: any) {
    console.error(`[Worker] 작업 실패 (ID: ${activeTaskId}):`, e);
    try {
      await supabase
        .from("tasks")
        .update({
          status: "failed",
          error: e.message || String(e),
        })
        .eq("id", activeTaskId);
    } catch (dbErr) {
      console.error("[Worker] 실패 로그 기록 중 DB 오류:", dbErr);
    }
  }
}

// 한 번에 여러 작업을 가져와 각각 다른 작업을 선점한 뒤,
// 선점에 성공한 것들을 진짜 병렬로 처리한다.
async function processBatch() {
  // 1. pending 상태의 작업을 한 번에 최대 N개 조회 (1개가 아니라 N개)
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_CONCURRENT);

  if (error) {
    console.error("[Worker] DB 조회 중 오류 발생:", error.message);
    return;
  }

  if (!tasks || tasks.length === 0) {
    return;
  }

  // 2. 각 작업을 개별적으로 선점 (서로 다른 id 라 충돌 없음)
  //    옵티미스틱 락은 다중 인스턴스 환경의 안전장치로 그대로 유지한다.
  const grabbed: any[] = [];
  for (const task of tasks) {
    const { data: grabbedTasks, error: updateError } = await supabase
      .from("tasks")
      .update({ status: "processing" })
      .eq("id", task.id)
      .eq("status", "pending")
      .select();

    if (updateError) {
      console.error(`[Worker] 작업 선점 중 오류 발생 (ID: ${task.id}):`, updateError.message);
      continue;
    }
    if (grabbedTasks && grabbedTasks.length > 0) {
      grabbed.push(task);
    }
  }

  if (grabbed.length === 0) {
    return;
  }

  // 3. 메모리에 올라온 이후 DB의 민감 정보를 즉시 삭제
  await Promise.all(grabbed.map(task =>
    supabase.from("tasks")
      .update({ api_key: null, github_token: null })
      .eq("id", task.id)
  ));

  // 4. 선점한 작업들을 진짜 병렬로 처리 (api_key/github_token은 메모리 내 task 객체에 유지)
  await Promise.all(grabbed.map((task) => processTask(task)));
}

// 3초 주기로 새 작업을 폴링해서 처리하는 루프.
// stale 작업 청소는 매 틱마다 할 필요는 없어서(가벼운 쿼리지만) 10틱(~30초)에 한 번만 돈다.
async function startLoop() {
  let tick = 0;
  while (true) {
    await processBatch();
    if (tick % 10 === 0) await reapStaleTasks().catch(e => console.error("[Worker] reapStaleTasks 실패:", e));
    tick++;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

startLoop();
