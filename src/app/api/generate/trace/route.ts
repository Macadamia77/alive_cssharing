import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

/**
 * GET /api/generate/trace — 파이프라인 트레이스 조회(관측).
 *  - ?taskId=  : 그 채널 generate task의 단계 트레이스(요약 리스트, 폴링용)
 *  - ?runId=   : shared 단계(research/brainstorm/deep/skeleton) 트레이스(요약, task_id null)
 *  - ?eventId= : 한 이벤트의 전문(prompt+output) — 상세 펼치기 클릭 시 1회
 * 요약/상세를 분리해 폴링 페이로드를 가볍게 유지(프롬프트 전문은 클릭할 때만).
 */
function summarize(row: { id: string; seq: number; stage: string; kind: string | null; phase: string; data: Record<string, unknown> | null }) {
  const d = row.data ?? {};
  const { prompt, output, ...rest } = d as Record<string, unknown>;
  return {
    id: row.id, seq: row.seq, stage: row.stage, kind: row.kind, phase: row.phase,
    data: {
      ...rest,
      ...(output !== undefined ? { outputPreview: String(output).slice(0, 160), hasOutput: true } : {}),
      ...(prompt !== undefined ? { hasPrompt: true } : {}),
    },
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("eventId");
  const taskId = sp.get("taskId");
  const runId = sp.get("runId");
  try {
    if (eventId) {
      const { data, error } = await supabase.from("pipeline_traces").select("*").eq("id", eventId).single();
      if (error || !data) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
      return NextResponse.json({ event: data }); // 전문(prompt+output 포함)
    }
    let q = supabase.from("pipeline_traces").select("id, seq, stage, kind, phase, data, created_at");
    if (taskId) q = q.eq("task_id", taskId);
    else if (runId) q = q.eq("run_id", runId).is("task_id", null);
    else return NextResponse.json({ error: "taskId 또는 runId가 필요합니다." }, { status: 400 });
    const { data, error } = await q.order("seq", { ascending: true }).order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: (data ?? []).map(summarize) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
