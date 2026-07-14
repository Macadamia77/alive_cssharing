// 채널별 generate task row 조립 — Vercel(api/generate/route.ts, 재개선 reuse/accumulated
// 직접 insert)과 Railway 워커(render-worker/index.ts, insertGenerateTasksForRun) 두 곳이
// 각자 손으로 같은 모양의 row를 만들고 있었다. 필드가 하나 늘 때마다 두 곳을 똑같이 고쳐야 해서
// 한쪽만 고치고 잊어버릴 위험이 있었다 — row "모양" 자체만 여기로 뽑아 공유한다.
// (channel 목록 계산·topic 폴백 등 호출 맥락별 로직은 두 호출부가 서로 다르게 필요로 해서
// 그대로 각자 유지하고, 여긴 순수 row 조립 함수만 둔다.)
export interface GenerateTaskRowInput {
  channel: string;
  topic: string;
  isImproveMode: boolean;
  userDraft: string | null;
  provider: string | null;
  apiKey: string | null;
  model: string | null;
  githubToken: string | null;
  improveDirection: string | null;
  useAccumulated: boolean;
  accumulatedTopicFilter: boolean;
  contextBudget: string | null;
  runId: string;
}

export function buildGenerateTaskRow(input: GenerateTaskRowInput) {
  return {
    channel: input.channel,
    topic: input.topic,
    draft: input.isImproveMode ? (input.userDraft || "") : "",
    status: "pending",
    provider: input.provider,
    api_key: input.apiKey,
    model: input.model,
    github_token: input.githubToken,
    improve_direction: input.improveDirection || null,
    use_accumulated: input.useAccumulated,
    accumulated_topic_filter: input.accumulatedTopicFilter,
    context_budget: input.contextBudget || null,
    job_type: "generate" as const,
    run_id: input.runId,
  };
}
