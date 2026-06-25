import { NextRequest } from "next/server";

export function resolveGithubToken(req: NextRequest): string | undefined {
  return req.cookies.get("gh_token")?.value ?? process.env.GITHUB_TOKEN;
}
