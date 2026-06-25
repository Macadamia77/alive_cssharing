/**
 * Vercel 환경에서 파일 쓰기를 GitHub API로 대체합니다.
 * 로컬 환경에서는 사용되지 않습니다.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "jademin";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "-cs-ai-";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

export function isVercelProd(): boolean {
  return process.env.VERCEL === "1";
}

async function getFileSha(repoPath: string): Promise<string | null> {
  if (!GITHUB_TOKEN) return null;
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}?ref=${GITHUB_BRANCH}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "cs-ai-web" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha ?? null;
}

/** 파일을 GitHub에 커밋합니다 (신규·수정 모두 처리) */
export async function githubWrite(repoPath: string, content: string): Promise<void> {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN 환경 변수가 설정되지 않았습니다.");

  const sha = await getFileSha(repoPath);
  const body: Record<string, string> = {
    message: `chore: update ${repoPath.split("/").pop()}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "cs-ai-web",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `GitHub API 오류 (HTTP ${res.status})`);
  }
}

/** 파일을 GitHub에서 삭제합니다 */
export async function githubDelete(repoPath: string): Promise<void> {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN 환경 변수가 설정되지 않았습니다.");

  const sha = await getFileSha(repoPath);
  if (!sha) throw new Error("파일을 찾을 수 없습니다.");

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "cs-ai-web",
      },
      body: JSON.stringify({
        message: `chore: delete ${repoPath.split("/").pop()}`,
        sha,
        branch: GITHUB_BRANCH,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `GitHub API 오류 (HTTP ${res.status})`);
  }
}
