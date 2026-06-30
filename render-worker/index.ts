import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import { runAgentPipeline, generateContent } from "../src/lib/agentRunner";
import { hasAgentPipeline, buildSystemPrompt } from "../src/lib/channelFiles";

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

// 이미 선점(processing)된 작업 하나를 끝까지 처리한다.
async function processTask(task: any) {
  const activeTaskId: string = task.id;
  try {
    console.log(`[Worker] 작업 시작 (ID: ${task.id}, 채널: ${task.channel}, 주제: ${task.topic})`);

    const token = task.github_token || undefined;
    const isPipeline = await hasAgentPipeline(task.channel, token);

    // 진행 상태 실시간 콜백
    const statusCallback = async (stage: string) => {
      console.log(`[Worker] 작업 ${task.id} 상태 변경 ➔ ${stage}`);
      await supabase
        .from("tasks")
        .update({ status: stage })
        .eq("id", task.id);
    };

    let content = "";
    if (isPipeline) {
      content = await runAgentPipeline(
        task.channel,
        task.topic,
        task.draft || "",
        token,
        task.provider || "mock",
        statusCallback,
        task.api_key || undefined
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
        task.api_key || undefined
      );
    }

    // 완료 업데이트
    await supabase
      .from("tasks")
      .update({
        status: "completed",
        result: content,
      })
      .eq("id", task.id);

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

  // 3. 선점한 작업들을 진짜 병렬로 처리
  await Promise.all(grabbed.map((task) => processTask(task)));
}

// 3초 주기로 새 작업을 폴링해서 처리하는 루프
async function startLoop() {
  while (true) {
    await processBatch();
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

startLoop();
