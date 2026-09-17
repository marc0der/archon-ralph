/**
 * The report's `Repositories that moved:` line (spec §4.2, §9).
 *
 * This is the only figure in the summary that is not read out of
 * `outcome.log`: it is `run-start.txt` diffed against `repoState()` at report
 * time. It is what tells an operator that a build that reported iterations
 * actually committed, and in a meta repository it is the only place a commit
 * inside a nested repository is visible at all — the workspace `HEAD` never
 * moved for it.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { movedRepos, report } from "../template/scripts/ralph-report.ts";
import { repoState } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

/** One commit in `repo`, as a build iteration that shipped leaves behind. */
function commit(repo: string, message: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  writeFileSync(join(repo, message), `${message}\n`);
  git("add", "--", message);
  git("-c", "user.email=t@t", "-c", "user.name=T", "commit", "--quiet", "-m", message);
}

/** What `ralph-seed` records before the first phase runs. */
function runStart(artifactsDir: string): void {
  writeFileSync(join(artifactsDir, "run-start.txt"), repoState());
}

/** The state column of the line under test, or `undefined` when it is absent. */
function movedLine(lines: string[]): string | undefined {
  return lines.find((line) => line.startsWith("Repositories that moved: "));
}

describe("ralph-report repositories", () => {
  test("counts the commits a repository gained during the run", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      commit(root, "before");
      runStart(artifactsDir);
      commit(root, "one");
      commit(root, "two");

      expect(movedRepos(artifactsDir)).toEqual([". (2 commits)"]);
      expect(movedLine(report(artifactsDir))).toBe("Repositories that moved: . (2 commits)");
    });
  });

  test("says `moved` where a start sha is `-` or absent", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      // The workspace starts commitless, so its start sha is `-`; the nested
      // repository is not in the listing at all, so it has no start sha.
      runStart(artifactsDir);
      commit(root, "first");
      mkdirSync(join(root, "svc"));
      execFileSync("git", ["init", "--quiet"], { cwd: join(root, "svc"), stdio: "ignore" });
      commit(join(root, "svc"), "nested");

      expect(movedRepos(artifactsDir)).toEqual([". moved", "svc moved"]);
      expect(movedLine(report(artifactsDir))).toBe("Repositories that moved: . moved, svc moved");
    });
  });

  test("prints the count as a singular commit", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      commit(root, "before");
      runStart(artifactsDir);
      commit(root, "one");

      expect(movedRepos(artifactsDir)).toEqual([". (1 commit)"]);
    });
  });

  test("omits the line when no repository moved", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      commit(root, "before");
      runStart(artifactsDir);
      // A dirty worktree is not progress (§4.1), so it is not movement either.
      writeFileSync(join(root, "scratch"), "uncommitted\n");

      expect(movedRepos(artifactsDir)).toEqual([]);
      expect(movedLine(report(artifactsDir))).toBeUndefined();
    });
  });

  test("reads a missing run-start.txt as an absent start sha", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      // `report` is `always_run`, so it runs after a `seed` that never got as
      // far as recording the listing, and with `ARTIFACTS_DIR` unset. Every
      // start sha is absent either way, which §4.2 renders `moved`: a report
      // with no baseline cannot count, and naming the repository beats hiding
      // commits the run really made.
      commit(root, "one");

      expect(movedRepos(artifactsDir)).toEqual([". moved"]);
      expect(movedLine(report(""))).toBe("Repositories that moved: . moved");
    });
  });
});
