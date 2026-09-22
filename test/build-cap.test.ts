/**
 * `ralph-build-cap`'s counters and its three exits (spec §9).
 *
 * The exit codes are inverted here (§2): 0 completes the build loop, 1 runs
 * another iteration. Every test asserts the code together with the counters and
 * `outcome.log`, because a wrong code alone is invisible — it either burns the
 * node's `max_iterations` or ends the build phase with the plan half done, and
 * both look like a working run until the report is read.
 *
 * The push step of §4.2 step 4 is covered separately; this file only exercises
 * the paths a repository with no `origin` takes, which is every path below.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../template/scripts/ralph-build-cap.ts";
import { readCounter, repoState, writeCounter } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

/**
 * The citation every seeded item carries (spec-anchored-review §7).
 *
 * A fixture standing in for a plan satisfies the contract the plan now
 * carries, so a later test that starts reading citations finds them here
 * already. Indented by two spaces, so no marker count moves.
 */
const CITATION = "  Spec: `specs/mock.md` §1";

/** A plan whose `## Items` body holds `items`, each under a `CITATION` line. */
function writePlan(items: string[]): void {
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    ["# Implementation Plan", "", "## Items", "", ...items.flatMap((item) => [item, CITATION]), ""].join(
      "\n",
    ),
  );
}

/** What `ralph-snapshot --mode build` leaves behind. */
function snapshot(artifactsDir: string, budget: number): void {
  writeFileSync(join(artifactsDir, "repo-state.txt"), repoState());
  writeCounter(join(artifactsDir, "build-budget.txt"), budget);
  writeCounter(join(artifactsDir, "build-iter.txt"), 0);
  writeCounter(join(artifactsDir, "build-noops.txt"), 0);
}

/** `main()` with the artifacts directory in `argv[2]` and stderr captured. */
function runMain(artifactsDir: string | undefined): { code: number; stderr: string } {
  const { error } = console;
  const err: string[] = [];
  console.error = (line: string) => err.push(line);
  try {
    return {
      code: main([
        "bun",
        "ralph-build-cap.ts",
        ...(artifactsDir === undefined ? [] : [artifactsDir]),
      ]),
      stderr: err.join("\n"),
    };
  } finally {
    console.error = error;
  }
}

/** A counter, with `-1` as the fallback so an absent file never reads as 0. */
function counter(artifactsDir: string, name: string): number {
  return readCounter(join(artifactsDir, name), -1);
}

function outcome(artifactsDir: string): string[] {
  const file = join(artifactsDir, "outcome.log");
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
}

/** One commit in `repo`, which is what an iteration that shipped looks like. */
function commit(repo: string, message: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  writeFileSync(join(repo, message), `${message}\n`);
  git("add", "--", message);
  git("-c", "user.email=t@t", "-c", "user.name=T", "commit", "--quiet", "-m", message);
}

describe("ralph-build-cap", () => {
  test("continues while repositories move, counting each iteration", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**", "- [ ] **Three**"]);
      snapshot(artifactsDir, 6);

      commit(root, "one");
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-iter.txt")).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);

      commit(root, "two");
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-iter.txt")).toBe(2);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);

      // Nothing is appended until the loop completes: the report reads one row
      // per phase, not one per iteration.
      expect(outcome(artifactsDir)).toEqual([]);
    });
  });

  test("records the new listing on every iteration", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      snapshot(artifactsDir, 6);

      commit(root, "one");
      runMain(artifactsDir);
      // Written back every iteration, so iteration 2 compares against iteration
      // 1. Comparing against the snapshot instead would report progress for the
      // rest of the phase after a single commit, and the no-op exit would never
      // fire.
      expect(readFileSync(join(artifactsDir, "repo-state.txt"), "utf8")).toBe(repoState());
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(1);
    });
  });

  test("treats a commit in a nested repository as progress", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      const nested = join(root, "source", "svc");
      mkdirSync(nested, { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: nested, stdio: "ignore" });
      snapshot(artifactsDir, 6);

      // The workspace `HEAD` never moves here. A cap that watched one `HEAD`
      // would count this iteration as a no-op and stop a phase that is shipping.
      commit(nested, "one");
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);
    });
  });

  test("completes after two consecutive iterations that changed nothing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      snapshot(artifactsDir, 6);

      // One no-op is grace, not a verdict: an iteration that reads the plan and
      // finds its top item blocked has to be allowed to try the next one.
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(1);
      expect(outcome(artifactsDir)).toEqual([]);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(2);
      expect(outcome(artifactsDir)).toEqual([
        "build: 2 iterations, no changes for 2 consecutive iterations",
      ]);
    });
  });

  test("resets the no-op count when a repository moves again", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      snapshot(artifactsDir, 9);

      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(1);

      commit(root, "one");
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);

      // Without the reset the next single no-op would end the phase, so a build
      // that alternates between shipping and thinking would get two iterations.
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(1);
    });
  });

  test("completes when the plan is exhausted", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      snapshot(artifactsDir, 6);

      commit(root, "one");
      writePlan(["- [x] **One**"]);
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["build: 1 iterations, plan exhausted"]);
    });
  });

  test("completes on a freshly scaffolded plan, whose exemplar is not an item", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // `## Entry Format` carries an open marker at column zero. Counting the
      // file whole would leave this plan one item short of exhausted, and the
      // phase would run to its budget on an empty plan instead.
      writeFileSync(
        "IMPLEMENTATION_PLAN.md",
        [
          "# Implementation Plan",
          "",
          "## Entry Format",
          "",
          "- [ ] **Short imperative title**",
          "",
          "## Items",
          "",
        ].join("\n"),
      );
      snapshot(artifactsDir, 6);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["build: 1 iterations, plan exhausted"]);
    });
  });

  test("prefers the exhausted-plan row over the no-op row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);
      snapshot(artifactsDir, 6);
      writeCounter(join(artifactsDir, "build-noops.txt"), 1);

      // Both conditions hold: nothing moved and nothing is left to do. The
      // report must read this as the healthy exit, not as an agent that stalled.
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["build: 1 iterations, plan exhausted"]);
    });
  });

  test("completes when the iteration count reaches the budget", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      snapshot(artifactsDir, 3);

      commit(root, "one");
      expect(runMain(artifactsDir).code).toBe(1);
      commit(root, "two");
      expect(runMain(artifactsDir).code).toBe(1);
      commit(root, "three");
      expect(runMain(artifactsDir).code).toBe(0);
      expect(counter(artifactsDir, "build-iter.txt")).toBe(3);
      expect(outcome(artifactsDir)).toEqual(["build: 3 iterations, budget of 3 spent"]);
    });
  });

  test("completes on the first iteration when no budget was snapshotted", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      // No `build-budget.txt`: the default of 1 bounds a phase whose snapshot
      // did not run, instead of letting it reach the node's `max_iterations`.
      writeFileSync(join(artifactsDir, "repo-state.txt"), repoState());

      commit(root, "one");
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["build: 1 iterations, budget of 1 spent"]);
    });
  });

  test("does not read a missing snapshot as a no-op", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      writeCounter(join(artifactsDir, "build-budget.txt"), 6);

      // `readState` returns `""` and the checkout always holds its own `.git`,
      // so the listings differ. Reading equal here would start the no-op count
      // on iteration 1 and end a healthy phase on iteration 2.
      expect(runMain(artifactsDir).code).toBe(1);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);
    });
  });

  test("counts the first iteration when the counter file is absent", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);
      writeFileSync(join(artifactsDir, "repo-state.txt"), repoState());

      expect(runMain(artifactsDir).code).toBe(0);
      expect(counter(artifactsDir, "build-iter.txt")).toBe(1);
      expect(outcome(artifactsDir)).toEqual(["build: 1 iterations, plan exhausted"]);
    });
  });

  test("exits 1 naming the missing argument and writes nothing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);

      for (const argv of [undefined, ""]) {
        const { code, stderr } = runMain(argv);
        // 1 means "keep looping", so the phase runs to `max_iterations` and
        // fails the node. Exiting 0 would hide the misconfiguration.
        expect(code).toBe(1);
        expect(stderr).toContain("ARTIFACTS_DIR");
        expect(existsSync(join(artifactsDir, "build-iter.txt"))).toBe(false);
        expect(existsSync(join(artifactsDir, "outcome.log"))).toBe(false);
      }
    });
  });
});
