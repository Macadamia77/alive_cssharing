import { type NextRequest } from "next/server";
import type { ProviderKey } from "./aiConfig";

export const DEFAULT_MODELS: Record<ProviderKey, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
};

export const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
  path: "/",
};

export interface ResolvedProvider { apiKey: string; model: string; }

/**
 * 우선순위: Vercel 환경변수 > httpOnly 쿠키 > null
 * (GitHub 파일 읽기는 네트워크 실패 가능성이 있어 신뢰성이 낮음)
 */
export function resolveProvider(req: NextRequest, provider: ProviderKey): ResolvedProvider | null {
  // 1. Vercel 환경변수 (CLAUDE_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY)
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  if (envKey) {
    const envModel = process.env[`${provider.toUpperCase()}_MODEL`]?.trim();
    return { apiKey: envKey, model: envModel || DEFAULT_MODELS[provider] };
  }
  // 2. httpOnly 쿠키 (설정 페이지에서 저장)
  const cookieKey = req.cookies.get(`${provider}_api_key`)?.value?.trim();
  if (cookieKey) {
    const cookieModel = req.cookies.get(`${provider}_model`)?.value?.trim();
    return { apiKey: cookieKey, model: cookieModel || DEFAULT_MODELS[provider] };
  }
  return null;
}

export function resolveActiveProvider(req: NextRequest): string {
  return req.cookies.get("ai_active_provider")?.value ?? "mock";
}

/**
 * 리서치 전용 provider(결정 #10) — 미지정("active" 또는 쿠키 없음)이면 null을 반환해
 * 호출부가 활성 provider를 그대로 쓰게 한다(하위호환). API 키는 여기서 다루지 않는다 —
 * 워커가 Railway 자체 환경변수로 해당 provider의 키를 스스로 찾는다.
 */
export function resolveResearchProvider(req: NextRequest): ProviderKey | null {
  const v = req.cookies.get("ai_research_provider")?.value;
  if (!v || v === "active") return null;
  return v as ProviderKey;
}
