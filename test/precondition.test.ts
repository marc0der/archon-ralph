/**
 * `ralph-precondition` (spec §9). This node is the run's only chance to stop
 * before `ralph-seed` archives the previous cycle's artifacts, so the four
 * cases below are the ones that must not reach `seed`: a goalless plan, a
 * directory that is not a checkout, and a detached workspace with no branch to
 * push. The unborn branch is the case that must *not* be stopped — `git init`
 * and go is how ralph expects a run to start.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { main } from "../template/scripts/ralph-precondition.ts";
import { withTempRepo } from "./helpers.ts";

/**
 * `main()` with its report captured. The verdict lines are the node's contract
 * — the operator reads them instead of the workflow log — and capturing them
 * keeps five lines per test out of the suite's own output.
 */
function runMain(): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    return { code: main(), out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** A commit of our own: `withTempRepo` deliberately makes none. */
function commit(): string {
  // `-c commit.gpgsign=false`: `withTempRepo` mints a repository with no
  // identity, and a global signing default would fail this on one machine only.
  const identity = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
  execFileSync("git", [...identity, "commit", "--quiet", "--allow-empty", "-m", "seed"], {
    stdio: "ignore",
  });
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

// `withTempRepo` restores ARTIFACTS_DIR and the working directory, not
// ARGUMENTS, and the goal reaches the node through the environment alone.
let previousArguments: string | undefined;

beforeEach(() => {
  previousArguments = process.env.ARGUMENTS;
  process.env.ARGUMENTS = "ship the thing";
});

afterEach(() => {
  if (previousArguments === undefined) delete process.env.ARGUMENTS;
  else process.env.ARGUMENTS = previousArguments;
});

describe("ralph-precondition", () => {
  test("passes on an unborn branch", async () => {
    await withTempRepo(() => {
      const { code, err } = runMain();

      expect(code).toBe(0);
      expect(err).toBe("");
    });
  });

  test("prints every check it ran", async () => {
    await withTempRepo(() => {
      const { out } = runMain();

      expect(out.split("\n")).toHaveLength(5);
      expect(out).not.toContain("FAIL");
    });
  });

  test("fails on a blank ARGUMENTS", async () => {
    await withTempRepo(() => {
      process.env.ARGUMENTS = "   \n";

      const { code, err } = runMain();

      expect(code).toBe(1);
      expect(err).toContain(
        'ralph-wiggum requires a goal: archon workflow run ralph-wiggum "<specification or sentence>"',
      );
    });
  });

  test("fails on an unset ARGUMENTS", async () => {
    await withTempRepo(() => {
      delete process.env.ARGUMENTS;

      expect(runMain().code).toBe(1);
    });
  });

  test("fails outside a work tree", async () => {
    await withTempRepo(({ root }) => {
      rmSync(`${root}/.git`, { recursive: true });

      const { code, err } = runMain();

      expect(code).toBe(1);
      expect(err).toContain("not inside a git work tree");
    });
  });

  test("fails on a detached HEAD with a commit", async () => {
    await withTempRepo(() => {
      const sha = commit();
      execFileSync("git", ["checkout", "--quiet", "--detach", sha], { stdio: "ignore" });

      const { code, err } = runMain();

      expect(code).toBe(1);
      expect(err).toContain("HEAD is detached");
    });
  });

  // A commit on a branch is the ordinary case, and the one a detached-HEAD
  // check gets wrong if it tests for the absence of a commit instead.
  test("passes on a branch with a commit", async () => {
    await withTempRepo(() => {
      commit();

      expect(runMain().code).toBe(0);
    });
  });
});
