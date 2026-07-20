import { NextResponse } from "next/server";
import { listSharedAgentFiles } from "@/lib/channelFiles";
import { guard } from "@/lib/authGate";

// 공용 에이전트(data/agents) 메타 — 라벨/설명/그룹. 파일이 여기 없으면 "기타"로 표시.
const AGENT_META: Record<string, { label: string; desc: string; group: string }> = {
  "researcher.md":              { label: "리서처 · 전문 정보", desc: "통계·사례·전문 자료 웹 수집(모드 A 1차 리서치)", group: "리서치 (공용)" },
  "researcher-voice.md":        { label: "리서처 · 현장 목소리", desc: "직장인·CS담당자의 실제 경험·고민 웹 수집", group: "리서치 (공용)" },
  "researcher-deep.md":         { label: "리서처 · 심화", desc: "확정 주제로 통계·사례·출처 심층 수집", group: "리서치 (공용)" },
  "researcher-deep-improve.md": { label: "리서처 · 심화(초안 개선)", desc: "모드 B 초안의 논지 3~5개를 식별하고 논지별 근거 수집", group: "리서치 (공용)" },
  "brainstormer.md":            { label: "기획 · 브레인스토머", desc: "주제 후보 다건 발산 + 순위·사유·개요(모드 A)", group: "기획·구조 (공용)" },
  "skeleton.md":                { label: "뼈대 설계", desc: "채널 무관 논리 구조·섹션 설계", group: "기획·구조 (공용)" },
  "example-summarizer.md":      { label: "우수작 요약 추출", desc: "우수작 저장 시 소재·앵글·확장전략만 요약(문체 제외)", group: "기획·구조 (공용)" },
  "tone-reviewer.md":           { label: "AI 톤 검수 (기본)", desc: "채널 전용 톤 검수가 없을 때 쓰이는 기본 검수자", group: "검수·이미지 (채널 폴백 기본)" },
  "image-maker.md":             { label: "이미지 생성 (기본)", desc: "썸네일·시각화 카드 생성 기본 프롬프트", group: "검수·이미지 (채널 폴백 기본)" },
  "image-reviewer.md":          { label: "이미지 검수 (기본)", desc: "텍스트 잘림·가독성 검수 기본 프롬프트", group: "검수·이미지 (채널 폴백 기본)" },
};

const GROUP_ORDER = ["리서치 (공용)", "기획·구조 (공용)", "검수·이미지 (채널 폴백 기본)", "기타"];

/** GET /api/agents — 공용 에이전트 파일 목록(그룹·라벨 포함) */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  try {
    // 정본은 로컬 번들의 .md 목록. Vercel 서버리스에서 readdir이 비면(파일 트레이싱 누락 등)
    // 알려진 메타 키로 폴백해 목록이 항상 뜨도록 한다.
    let files = await listSharedAgentFiles();
    if (files.length === 0) files = Object.keys(AGENT_META);
    const agents = files.map(file => {
      const m = AGENT_META[file] ?? { label: file.replace(/\.md$/, ""), desc: "", group: "기타" };
      return { file, ...m };
    });
    agents.sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.group); const gb = GROUP_ORDER.indexOf(b.group);
      if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
      return a.file.localeCompare(b.file);
    });
    return NextResponse.json({ agents, groupOrder: GROUP_ORDER });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
