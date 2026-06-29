/**
 * Vercel 환경에서 파일 쓰기를 GitHub API로 대체합니다.
 * 로컬 환경에서는 사용되지 않습니다.
 */

const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "jademin";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "alive_cssharing";
// Vercel 프리뷰 배포 시 VERCEL_GIT_COMMIT_REF가 현재 브랜치명을 자동으로 갖고 있음
// → 민석 브랜치 프리뷰는 민석 브랜치 파일을, main 프로덕션은 main 파일을 읽음
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? process.env.VERCEL_GIT_COMMIT_REF ?? "main";

// Vercel 환경변수는 대소문자 구분 — 소문자로 저장된 경우도 인식
const ENV_GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.github_token;

export function isVercelProd(): boolean {
  return process.env.VERCEL === "1";
}

function resolveToken(token?: string): string {
  const tok = token ?? ENV_GITHUB_TOKEN;
  if (!tok) throw new Error("GitHub 토큰이 설정되지 않았습니다. 설정 페이지에서 GitHub 토큰을 입력해주세요.");
  return tok;
}

async function getFileSha(repoPath: string, token: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}?ref=${GITHUB_BRANCH}`,
    {
      headers: { Authorization: `token ${token}`, "User-Agent": "cs-ai-web" },
      cache: "no-store",
    } as any
  );
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.sha ?? null;
}

/** 파일을 GitHub에 커밋합니다 (신규·수정 모두 처리)
 *  alreadyBase64=true 이면 content를 그대로 GitHub에 전달 (바이너리 업로드용) */
export async function githubWrite(repoPath: string, content: string, token?: string, alreadyBase64 = false): Promise<void> {
  const tok = resolveToken(token);
  const sha = await getFileSha(repoPath, tok);
  const body: Record<string, string> = {
    message: `chore: update ${repoPath.split("/").pop()}`,
    content: alreadyBase64 ? content : Buffer.from(content, "utf-8").toString("base64"),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${tok}`,
        "Content-Type": "application/json",
        "User-Agent": "cs-ai-web",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    } as any
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.message ?? `GitHub API 오류 (HTTP ${res.status})`);
  }
}

/** GitHub에서 파일 내용을 읽습니다 (텍스트 디코딩) */
export async function githubRead(repoPath: string, token?: string): Promise<string> {
  const raw = await githubReadBase64(repoPath, token);
  return Buffer.from(raw, "base64").toString("utf-8");
}

/** GitHub에서 파일의 raw base64 콘텐츠를 그대로 반환합니다 (바이너리용) */
export async function githubReadBase64(repoPath: string, token?: string): Promise<string> {
  const tok = token ?? ENV_GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cs-ai-web",
  };
  if (tok) headers["Authorization"] = `token ${tok}`;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}?ref=${GITHUB_BRANCH}`,
    { headers, cache: "no-store" } as any
  );
  if (!res.ok) throw new Error(`GitHub 읽기 실패 (${repoPath}): ${res.status}`);
  const json = await res.json() as any;
  if (typeof json.content !== "string") throw new Error("GitHub 응답에 content가 없습니다.");
  // GitHub API는 줄바꿈 포함 base64를 반환하므로 제거
  return json.content.replace(/\n/g, "");
}

export interface GithubDirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

/** GitHub에서 디렉토리 목록을 가져옵니다 (Vercel 읽기용) */
export async function githubListDir(repoPath: string, token?: string): Promise<GithubDirEntry[]> {
  const tok = token ?? ENV_GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cs-ai-web",
  };
  if (tok) headers["Authorization"] = `token ${tok}`;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}?ref=${GITHUB_BRANCH}`,
    { headers, cache: "no-store" } as any
  );
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`GitHub 디렉토리 조회 실패 (${repoPath}): ${res.status}`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json.map((item: { name: string; path: string; type: string }) => ({
    name: item.name,
    path: item.path,
    type: item.type as "file" | "dir",
  }));
}

/** 파일을 GitHub에서 삭제합니다 */
export async function githubDelete(repoPath: string, token?: string): Promise<void> {
  const tok = resolveToken(token);
  const sha = await getFileSha(repoPath, tok);
  if (!sha) throw new Error("파일을 찾을 수 없습니다.");

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `token ${tok}`,
        "Content-Type": "application/json",
        "User-Agent": "cs-ai-web",
      },
      body: JSON.stringify({
        message: `chore: delete ${repoPath.split("/").pop()}`,
        sha,
        branch: GITHUB_BRANCH,
      }),
      cache: "no-store",
    } as any
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.message ?? `GitHub API 오류 (HTTP ${res.status})`);
  }
}
