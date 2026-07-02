import { existsSync } from "fs";
import path from "path";

/**
 * data/ 디렉토리를 담은 루트 경로를 반환한다.
 *
 * - Vercel: 작업 디렉토리(cwd)가 레포 루트(/app) → data/가 거기 있으므로 그대로 사용.
 * - Railway: render-worker/를 Root Directory로 실행 → cwd = /app/render-worker.
 *   그 아래엔 data/가 없고 상위(/app)에 있으므로 한 단계 올라간다.
 *
 * process.cwd() 를 직접 쓰면 Railway에서 /app/render-worker/data/... 를 찾다가
 * ENOENT로 죽는다 (channelFiles.ts와 동일한 해석 로직을 공용화).
 */
export function dataRoot(): string {
  let root = process.cwd();
  if (!existsSync(path.join(root, "data")) && existsSync(path.join(root, "..", "data"))) {
    root = path.join(root, "..");
  }
  return root;
}
