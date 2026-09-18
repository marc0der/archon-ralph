/**
 * `ralph-precondition` (spec §9). This node is the run's only chance to stop
 * before `ralph-seed` archives the previous cycle's artifacts, so the four
 * cases below are the ones that must not reach `seed`: a goalless plan, a
 * directory that is not a checkout, and a detached workspace with no branch to
 * push. The unborn branch is the case that must *not* be stopped — `git init`
 * and go is how ralph expects a run to start.
 *
 * The goalless case is the one the mode decides (§12.4): a blank `ARGUMENTS`
 * stops a `plan` but must pass a `build` or a `review`, because those blocks
 * reference no goal and inside `ralph-wiggum` the positional message is the
 * parent's. The modes describe below pins both halves of that, and the
 * remaining cases are asserted in the default mode alone — they do not vary.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { main } from "../template/scripts/ralph-precondition.ts";
import { withTempRepo } from "./helpers.ts";

/**
 * `main()` with its report captured, under the environment Archon hands the
 * node. The verdict lines are the node's contract — the operator reads them
 * instead of the workflow log — and capturing them keeps five lines per test
 * out of the suite's own output. The default keeps the pre-mode tests reading
 * `process.env`, which `beforeEach` owns.
 */
function runMain(env: NodeJS.ProcessEnv = process.env): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    return { code: main(env), out: out.join("\n"), err: err.join("\n") };
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
        'ralph-wiggum requires a goal: archon workflow run ralph-wiggum "<specification or sentence>"; ralph-plan takes the same goal.',
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

/**
 * The environment of a phase block's `precondition` node: a mode and no goal.
 * Blank rather than unset, because a composed run's `ARGUMENTS` is always set
 * and a standalone `ralph-build` is invoked with no positional message.
 */
function modeEnv(mode: string): NodeJS.ProcessEnv {
  return { ...process.env, INPUTS_MODE: mode, ARGUMENTS: "   \n" };
}

describe("ralph-precondition modes", () => {
  // `ralph-build.md` references no goal, so requiring one here would refuse
  // every standalone build and, composed, every `ralph-wiggum` cycle.
  test("passes a blank ARGUMENTS in build mode", async () => {
    await withTempRepo(() => {
      const { code, err, out } = runMain(modeEnv("build"));

      expect(code).toBe(0);
      expect(err).toBe("");
      expect(out).not.toContain("ARGUMENTS carries a goal");
    });
  });

  test("passes a blank ARGUMENTS in review mode", async () => {
    await withTempRepo(() => {
      const { code, err, out } = runMain(modeEnv("review"));

      expect(code).toBe(0);
      expect(err).toBe("");
      expect(out).not.toContain("ARGUMENTS carries a goal");
    });
  });

  // The other half: dropping the goal check in two modes must not drop it in
  // the third, where a goalless run plans against whatever `specs/` it finds.
  test("fails a blank ARGUMENTS in plan mode", async () => {
    await withTempRepo(() => {
      const { code, err } = runMain(modeEnv("plan"));

      expect(code).toBe(1);
      expect(err).toContain("ralph-wiggum requires a goal");
    });
  });

  // A typo in `with: {mode: …}` must not quietly pick a mode. The message
  // names the three so the operator can correct the workflow file from it.
  test("fails an unrecognised INPUTS_MODE and names the three modes", async () => {
    await withTempRepo(() => {
      const { code, err } = runMain(modeEnv("planning"));

      expect(code).toBe(1);
      expect(err).toContain("INPUTS_MODE must be plan, build, review");
      expect(err).toContain('got "planning"');
    });
  });

  // An absent mode is `plan`, the strictest: the script commits land before
  // the composition commit, and `ralph-wiggum.yaml` keeps working in between.
  test("defaults an absent INPUTS_MODE to plan", async () => {
    await withTempRepo(() => {
      const { INPUTS_MODE: _unset, ...env } = process.env;

      expect(runMain({ ...env, ARGUMENTS: "   \n" }).code).toBe(1);
      expect(runMain({ ...env, ARGUMENTS: "ship the thing" }).code).toBe(0);
    });
  });
});
