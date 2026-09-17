/**
 * The one test fixture. Spec §9: no test rolls its own.
 *
 * Every script under `template/scripts/` reads the repository through the
 * current working directory and writes state into `ARTIFACTS_DIR`, so a test
 * needs both pointed somewhere disposable before it imports anything. Ralph
 * keeps the same fixture in `test/test_helper.bash`.
 *
 * Deliberately no initial commit: `ralph-precondition` must pass on an unborn
 * branch, and a fixture commit would hide that case.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempRepo {
  root: string;
  artifactsDir: string;
}

export async function withTempRepo<T>(fn: (repo: TempRepo) => T | Promise<T>): Promise<T> {
  // realpathSync because $TMPDIR is a symlink on macOS: without it `root` and
  // `process.cwd()` disagree, and scripts that print an absolute path print
  // the resolved one.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "archon-ralph-")));
  const artifactsDir = join(root, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });

  const previousCwd = process.cwd();
  const previousArtifactsDir = process.env.ARTIFACTS_DIR;
  process.env.ARTIFACTS_DIR = artifactsDir;
  process.chdir(root);
  try {
    return await fn({ root, artifactsDir });
  } finally {
    process.chdir(previousCwd);
    if (previousArtifactsDir === undefined) delete process.env.ARTIFACTS_DIR;
    else process.env.ARTIFACTS_DIR = previousArtifactsDir;
  }
}
