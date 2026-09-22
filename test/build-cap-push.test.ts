/**
 * `ralph-build-cap`'s push step (spec §4.2 step 4, §9).
 *
 * The push is the one part of the build cap that reaches outside the workspace,
 * so every case here is about what it does *not* do as much as what it does: a
 * missing remote and a commitless branch must not fail the phase, `skip_push`
 * must leave no trace at all, and only a rejection may write the abort marker.
 * Getting the last one backwards either fails a healthy run or lets the loop
 * keep committing onto a branch the remote has already refused.
 *
 * The counter and exit paths are covered in `build-cap.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, pushWorkspace } from "../template/scripts/ralph-build-cap.ts";
import { repoState, writeCounter } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

/** `git` in `repo`, with an identity — `withTempRepo` mints none. */
function git(repo: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=T",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

/** A commit in `repo`, which is what a build iteration leaves behind. */
function commit(repo: string, message: string): void {
  writeFileSync(join(repo, message), `${message}\n`);
  git(repo, "add", "--", message);
  git(repo, "commit", "--quiet", "-m", message);
}

/**
 * A bare repository at `<root>/origin.git`, wired up as `origin`.
 *
 * Bare, so it accepts a push to its current branch, and inside `root`, where it
 * costs the test nothing: a bare repository has no `.git` entry, so `repoState`
 * never sees it and the no-op detection is unaffected.
 */
function addOrigin(root: string): string {
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "--bare", "--quiet", origin], { stdio: "ignore" });
  git(root, "remote", "add", "origin", origin);
  return origin;
}

/**
 * An open plan and a build snapshot, so nothing but the push decides the exit.
 *
 * Each item carries a `Spec:` citation (spec-anchored-review §7): a fixture
 * standing in for a plan satisfies the contract the plan now carries. The
 * citation lines are indented, so no marker count moves.
 */
function setup(artifactsDir: string, budget = 6): void {
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    [
      "# Implementation Plan",
      "",
      "## Items",
      "",
      "- [ ] **One**",
      "  Spec: `specs/mock.md` §1",
      "- [ ] **Two**",
      "  Spec: `specs/mock.md` §2",
      "",
    ].join("\n"),
  );
  writeFileSync(join(artifactsDir, "repo-state.txt"), repoState());
  writeCounter(join(artifactsDir, "build-budget.txt"), budget);
}

/** Run `fn` with `console.log` collected; the skip lines are part of the contract. */
function capture<T>(fn: () => T): { value: T; stdout: string } {
  const { log } = console;
  const out: string[] = [];
  console.log = (line: string) => out.push(line);
  try {
    return { value: fn(), stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

function runMain(artifactsDir: string): { code: number; stdout: string } {
  const { value, stdout } = capture(() => main(["bun", "ralph-build-cap.ts", artifactsDir]));
  return { code: value, stdout };
}

function outcome(artifactsDir: string): string {
  const file = join(artifactsDir, "outcome.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("ralph-build-cap push", () => {
  test("pushes the workspace branch to a bare origin and moves it", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      const origin = addOrigin(root);
      commit(root, "one");
      setup(artifactsDir);

      const { code, stdout } = runMain(artifactsDir);
      expect(code).toBe(1);
      expect(stdout).toBe("");

      const branch = git(root, "branch", "--show-current");
      expect(git(origin, "rev-parse", `refs/heads/${branch}`)).toBe(
        git(root, "rev-parse", "HEAD"),
      );
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
      expect(outcome(artifactsDir)).toBe("");
    });
  });

  test("retries with -u when git reports the branch has no upstream", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // Real git never says this for an explicit `git push origin <branch>` —
      // the message belongs to an argumentless push — so the runner is stubbed.
      // The path still has to work: a workspace whose `push.default` or hooks
      // produce it must end up with an upstream rather than a failed run.
      const calls: string[][] = [];
      const stub = (args: string[]): { ok: boolean; output: string } => {
        calls.push(args);
        if (args[0] === "branch") return { ok: true, output: "feature\n" };
        if (args[0] === "push" && args[1] === "origin") {
          return { ok: false, output: "fatal: The current branch feature has no upstream branch.\n" };
        }
        return { ok: true, output: "" };
      };

      const { value, stdout } = capture(() => pushWorkspace(artifactsDir, stub));
      expect(value).toBe(false);
      expect(stdout).toBe("No upstream branch found. Setting upstream...");
      expect(calls).toEqual([
        ["remote", "get-url", "origin"],
        ["rev-parse", "-q", "--verify", "HEAD"],
        ["branch", "--show-current"],
        ["push", "origin", "feature"],
        ["push", "-u", "origin", "feature"],
      ]);
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("treats a failed -u retry as a rejection", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // Ralph ignores the retry's exit status. Doing the same here would push
      // nothing for the rest of the phase and still report a clean run.
      const stub = (args: string[]): { ok: boolean; output: string } => {
        if (args[0] === "branch") return { ok: true, output: "feature\n" };
        if (args[0] !== "push") return { ok: true, output: "" };
        return {
          ok: false,
          output:
            args[1] === "origin"
              ? "fatal: The current branch feature has no upstream branch.\n"
              : "fatal: could not read Username\n",
        };
      };

      expect(capture(() => pushWorkspace(artifactsDir, stub)).value).toBe(true);
      expect(readFileSync(join(artifactsDir, "abort.txt"), "utf8")).toBe(
        "build: push rejected\nfatal: could not read Username\n",
      );
    });
  });

  test("skips with the exact message when there is no origin", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      commit(root, "one");
      setup(artifactsDir);

      const { code, stdout } = runMain(artifactsDir);
      // A workspace with no remote is a normal local run, not a defect: the
      // phase continues and the marker is never written.
      expect(code).toBe(1);
      expect(stdout).toBe("No 'origin' remote — skipping push.");
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("skips with the exact message when there is no commit", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      addOrigin(root);
      setup(artifactsDir);

      const { code, stdout } = runMain(artifactsDir);
      // `withTempRepo` makes no commit, so `HEAD` is unborn. Pushing an unborn
      // branch fails, and that failure would otherwise abort the first
      // iteration of every run that starts from an empty repository.
      expect(code).toBe(1);
      expect(stdout).toBe("No commit on the workspace branch — skipping push.");
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("writes abort.txt and completes the loop when origin rejects the push", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      addOrigin(root);
      commit(root, "one");
      setup(artifactsDir);
      runMain(artifactsDir);

      // Amending the pushed commit leaves the local branch off origin's, so
      // the next push is a non-fast-forward — the rejection an operator
      // actually hits: a branch someone else moved, or a force-push policy.
      git(root, "commit", "--amend", "--quiet", "-m", "one, again");

      const { code } = runMain(artifactsDir);
      // Exit 0 completes the loop — `until_bash` cannot fail a node (§4.3), so
      // `guard` reads the marker and fails the run instead.
      expect(code).toBe(0);
      const abort = readFileSync(join(artifactsDir, "abort.txt"), "utf8");
      expect(abort.split("\n")[0]).toBe("build: push rejected");
      expect(abort).toContain("rejected");
      // The same text reaches the log, so the report has a row even though the
      // guard is what fails the run.
      expect(outcome(artifactsDir)).toBe(abort);
      // The rejection wins over the budget row: the phase stopped because the
      // remote refused it, not because it ran out of passes.
      expect(outcome(artifactsDir)).not.toContain("iterations");
    });
  });

  test("neither pushes nor prints a skip line under skip_push", async () => {
    await withTempRepo(async ({ root, artifactsDir }) => {
      const origin = addOrigin(root);
      commit(root, "one");
      setup(artifactsDir);
      writeFileSync(join(artifactsDir, "settings.json"), JSON.stringify({ skip_push: true }));

      const { code, stdout } = runMain(artifactsDir);
      expect(code).toBe(1);
      // Silence, not a skip line: the operator asked for no push and does not
      // need a row per iteration saying so.
      expect(stdout).toBe("");
      expect(git(origin, "branch", "--list")).toBe("");
    });
  });
});
