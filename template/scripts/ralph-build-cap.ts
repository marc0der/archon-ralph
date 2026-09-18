#!/usr/bin/env bun
/**
 * Ralph BUILD-CAP — the `until_bash` of the `build` loop (spec §4.2).
 *
 * The build phase does commit, so unlike the plan phase it has a real signal
 * for progress. It is not the workspace `HEAD`: a build iteration may commit
 * only into a nested repository, which moves nothing at the root. The listing
 * from `repoState()` is compared instead, and any difference counts as work.
 *
 * Every iteration pushes the workspace branch before the exit decision, as
 * ralph's push block precedes its early-exit check, so the commits of the
 * iteration that ends the phase are not left behind.
 *
 * Three conditions stop the loop, in this order:
 *
 *   1. `open == 0` — the plan is exhausted, which is the healthy exit.
 *   2. two no-op iterations in a row — the agent has stopped shipping. One
 *      no-op is not enough: a build iteration that only reads the plan and
 *      finds its item blocked is normal, and ralph gives it the same grace.
 *   3. the budget is spent — `computeBudget(open)` iterations, recomputed for
 *      this cycle by `ralph-snapshot`.
 *
 * A push git refuses is the fourth way out, and the only unhealthy one: it
 * writes `abort.txt` and completes the loop, leaving `build-guard` to fail the
 * run (§4.3). Continuing would pile more commits on a branch the remote has
 * already refused.
 *
 * `until_bash` exit codes are inverted from a normal script (§2): exit 0
 * **completes** the loop, any non-zero exit means "keep looping". Every stop
 * above is therefore a deliberate exit 0, well below the node's
 * `max_iterations` — exhausting that ceiling fails the node, and a build that
 * runs out of budget is not a failed run.
 *
 * Invoked from the workflow YAML as
 *   until_bash: bun run .archon/scripts/ralph-build-cap.ts "$ARTIFACTS_DIR"
 * Archon's loop executor injects neither `ARTIFACTS_DIR` nor `INPUTS_*` into
 * the subprocess (§2), so the directory arrives textually as `argv[2]`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendOutcome,
  countItems,
  planItemsBody,
  readCounter,
  readSettings,
  repoState,
  writeCounter,
} from "./lib/ralph.ts";

/**
 * Ralph's build budget when `build-budget.txt` is missing, empty or corrupt.
 *
 * One iteration, as ralph's `cat … 2>/dev/null || echo 1` gives: a build phase
 * whose snapshot did not run gets one pass rather than an unbounded run to the
 * node's `max_iterations`.
 */
const BUDGET_DEFAULT = 1;

/** The `repoState()` listing `ralph-snapshot` left, or `""` when absent. */
function readState(file: string): string {
  try {
    // Untrimmed: the listing is newline-terminated per line and written back
    // here verbatim, so the comparison has to be byte-for-byte.
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Whether a git command succeeded, and its combined output as `2>&1` gives. */
interface GitResult {
  ok: boolean;
  output: string;
}

/**
 * One git command, never throwing and never writing to this process's streams.
 *
 * Output is merged the way ralph's `push_output=$(git push … 2>&1)` merges it,
 * because the string the upstream check looks for is on stderr. Piping stderr
 * rather than inheriting it also keeps a failed push out of the node log twice:
 * `abort.txt` is where the operator reads it.
 */
function gitRun(args: string[]): GitResult {
  try {
    return {
      ok: true,
      output: execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/**
 * Push the workspace branch (§4.2 step 4). Returns `true` when git refused it,
 * which is the caller's signal to complete the loop and let the guard fail.
 *
 * Only the workspace is pushed. A build iteration that committed into a nested
 * repository has pushed it itself if it could — the prompts make that the
 * agent's job — and this script has no way to know which remote, branch or
 * credentials any of them wants.
 *
 * The state is re-read from the workspace every iteration rather than cached at
 * snapshot time: the agent may add the remote, or make the first commit, part
 * way through the phase.
 *
 * `git` is injectable so the upstream retry has a test. There is no portable way
 * to make real git report `has no upstream branch` for an explicit
 * `git push origin <branch>`; the string only appears for an argumentless push.
 * The branch is kept because ralph keeps it, and because a workspace `push.default`
 * of `nothing` makes the explicit form the only one that works at all.
 */
export function pushWorkspace(artifactsDir: string, git = gitRun): boolean {
  if (readSettings(artifactsDir).skip_push) return false;
  if (!git(["remote", "get-url", "origin"]).ok) {
    console.log("No 'origin' remote — skipping push.");
    return false;
  }
  // `-q --verify` and not plain `rev-parse HEAD`: the plain form prints the
  // literal `HEAD` and exits 0 in a commitless repository, so this would push
  // a branch that does not exist yet.
  if (!git(["rev-parse", "-q", "--verify", "HEAD"]).ok) {
    console.log("No commit on the workspace branch — skipping push.");
    return false;
  }

  const branch = git(["branch", "--show-current"]).output.trim();
  let result = git(["push", "origin", branch]);
  if (!result.ok && result.output.includes("has no upstream branch")) {
    console.log("No upstream branch found. Setting upstream...");
    // A retry that also fails is a rejection, and gets what the first push's
    // rejection gets: `abort.txt`, the outcome row, exit 0. Ralph reaches the
    // same outcome through `set -e` — its retry is a bare command, so a
    // failure ends the run where it happens rather than at a guard. Swallowing
    // it here would push nothing for the rest of the phase and report a clean
    // run.
    result = git(["push", "-u", "origin", branch]);
  }
  if (result.ok) return false;

  // Git's own words, not a summary: a rejection is a non-fast-forward, a
  // protected branch, a missing credential or a dead host, and the operator
  // needs to know which before re-running.
  const text = `build: push rejected\n${result.output.trim()}`;
  writeFileSync(join(artifactsDir, "abort.txt"), `${text}\n`);
  appendOutcome(artifactsDir, text);
  return true;
}

export function main(argv = process.argv): number {
  const artifactsDir = argv[2];
  if (artifactsDir === undefined || artifactsDir === "") {
    // Non-zero here means "keep looping", so a workflow that drops the argument
    // runs the build phase to `max_iterations` and fails the node. That is the
    // intended noise: exiting 0 would hide the misconfiguration behind a single
    // build iteration that looks like an exhausted plan.
    console.error(
      'ralph-build-cap: the artifacts directory is required as argv[2] ("$ARTIFACTS_DIR")',
    );
    return 1;
  }

  const iterFile = join(artifactsDir, "build-iter.txt");
  const n = readCounter(iterFile, 0) + 1;
  writeCounter(iterFile, n);

  const stateFile = join(artifactsDir, "repo-state.txt");
  const before = readState(stateFile);
  const after = repoState();
  // Written back every iteration, so the next iteration compares against this
  // one and not against the snapshot. Without that, every iteration after the
  // first commit would read as progress for the rest of the phase.
  writeFileSync(stateFile, after);

  const noopFile = join(artifactsDir, "build-noops.txt");
  // A missing `repo-state.txt` reads as `""`, and a checkout always holds at
  // least its own `.git`, so a snapshot that did not run cannot read as a
  // no-op and stall the phase two iterations in.
  const noops = before === after ? readCounter(noopFile, 0) + 1 : 0;
  writeCounter(noopFile, noops);

  // Before the exit decision, not after it: the iteration that ends the phase
  // commits like any other, and a phase that exits with its work unpushed looks
  // identical to one that never ran.
  if (pushWorkspace(artifactsDir)) return 0;

  const budget = readCounter(join(artifactsDir, "build-budget.txt"), BUDGET_DEFAULT);
  // `planItemsBody` and not the whole file: the exemplar under `## Entry Format`
  // is an open item at column zero, so counting the file whole would leave an
  // exhausted plan one item short of exhausted and the loop would never take
  // its healthy exit. A plan that is absent throws — `counts-pre-build` has
  // already failed the run by then (§4.2).
  const open = countItems(planItemsBody(), "[ ]");

  if (open === 0) {
    appendOutcome(artifactsDir, `build: ${n} iterations, plan exhausted`);
    return 0;
  }
  // The bound and the line the report reads must agree, so the 2 is spelt out
  // on both rather than named once: a constant scores 0 on the grep that pins
  // this message, and the two drift apart unread.
  if (noops >= 2) {
    appendOutcome(artifactsDir, `build: ${n} iterations, no changes for 2 consecutive iterations`);
    return 0;
  }
  if (n >= budget) {
    appendOutcome(artifactsDir, `build: ${n} iterations, budget of ${budget} spent`);
    return 0;
  }
  return 1;
}

if (import.meta.main) process.exit(main());
