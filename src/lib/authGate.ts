// API 라우트 안에서 호출하는 2차 인증 방어(defense in depth).
// proxy(1차 게이트)가 matcher 실수·리팩터 등으로 특정 라우트를 못 지켜도, 여기서 다시
// 세션을 확인한다 — Next proxy 문서(proxy.md)가 "proxy만 의존하지 말고 각 라우트에서도
// 인증을 검증하라"고 권고한 바에 대응한다.
//
// AUTH_ENABLED가 "true"가 아니면 no-op(통과) → 인계 전(플래그 OFF)엔 아무 영향이 없다.
// 팀원 워크플로에도 무영향(플래그를 켜야 비로소 로그인이 강제됨).
import { NextResponse } from "next/server";
import { createServerSupabase } from "./supabase/server";

export function authEnabled(): boolean {
  return process.env.AUTH_ENABLED === "true";
}

// 라우트 핸들러 첫 줄에서 호출한다:
//   const denied = await guard(); if (denied) return denied;
// 인증 실패 시 401 응답을 반환하고, 통과(또는 게이트 OFF)면 null을 반환한다.
// 예외를 던지지 않으므로 기존 라우트의 try/catch(500 처리)와 충돌하지 않는다.
export async function guard(): Promise<NextResponse | null> {
  if (!authEnabled()) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
