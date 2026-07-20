import type { NextConfig } from "next";

// CSP는 report-only(차단 안 하고 위반을 "보고만" 한다). script-src 'self'로 엄격히 둬서 Next/React
// 인라인 스크립트가 위반으로 보고되게 해, 나중에 강제(enforce) 전환 시 nonce 필요 여부를 미리
// 관찰한다. connect-src는 로그인이 Supabase와 통신하므로 허용. 강제(Content-Security-Policy)로
// 바꾸기 전까지는 아무것도 차단하지 않아 화면이 깨지지 않는다.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
  // 보안 응답 헤더(전 경로). HSTS는 Vercel이 이미 설정하므로 제외. CSP는 report-only(비차단).
  // 안전 헤더(X-Frame-Options 등)는 기능을 깨지 않으며, CSP-Report-Only도 차단하지 않는다.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
    ];
  },
};

export default nextConfig;
