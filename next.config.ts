import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 서버리스 함수 번들에 data/ 디렉토리를 포함시켜
  // GitHub API 실패 시 로컬 파일 폴백이 작동하도록 함
  outputFileTracingIncludes: {
    "/api/**": ["./data/**/*"],
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
