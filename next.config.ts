import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 서버리스 함수 번들에 data/ 디렉토리를 포함시켜
  // GitHub API 실패 시 로컬 파일 폴백이 작동하도록 함
  outputFileTracingIncludes: {
    "/api/**": ["./data/**/*"],
  },
  // @resvg/resvg-js는 네이티브(.node) 바이너리, pretendard는 정적 폰트 파일(.otf)을 그대로
  // require.resolve()로 가리킨다 — 둘 다 webpack이 일반 JS/ESM 모듈처럼 번들링하려 하면 빌드가
  // 깨진다("Unknown module type" / "non-ecmascript placeable asset"). cardCapture.ts는 항상
  // 동적 import(await import)로만 불러오지만, agentRunner.ts → api/generate/route.ts 체인이
  // 정적으로 그 경로까지 참조 가능해서 Vercel의 파일 트레이싱이 어차피 끝까지 따라가 번들링을
  // 시도한다 — 그래서 아예 번들 대상에서 빼고 런타임에 node_modules에서 직접 require하도록
  // 명시적으로 제외해야 한다.
  serverExternalPackages: ["@resvg/resvg-js", "pretendard"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
