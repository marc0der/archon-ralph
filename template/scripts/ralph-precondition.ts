#!/usr/bin/env bun
/**
 * Ralph PRECONDITION node — refuse a run the loop cannot finish (spec §4.2).
 *
 * The first node of every workflow, and in `ralph-wiggum` the only one that can
 * stop the run before `ralph-seed` archives the previous cycle's artifacts.
 * Each defect below makes a later phase fail in a way that is expensive to
 * read: a goalless plan run plans against whatever `specs/` it resolves — the
 * wrong node's, in a meta repository — and a detached workspace has no branch
 * for the build loop to push.
 *
 * One script, three modes, read from `INPUTS_MODE` (`with: {mode: …}` in the
 * workflow). Only `plan` requires a goal; `ralph-build` and `ralph-review`
 * reference none, and inside `ralph-wiggum` a positional message is the
 * parent's goal, so refusing it in those modes would refuse every composed run
 * (§12.4). The work tree, the branch and the tools are checked in every mode.
 *
 * In `build` and `review` mode the node also fails on `$ARTIFACTS_DIR/abort.txt`
 * (one-shot review spec §3.2). A block's report always succeeds, so a failed
 * guard does not stop the next block in `ralph-wiggum`; this check does. A
 * standalone block starts in a fresh `ARTIFACTS_DIR`, so it fires only there.
 *
 * Every check runs before the exit code is decided, so one run reports every
 * defect rather than one per restart. A `bun` or `git` missing from `PATH`
 * therefore also fails the checks that shell out to them; that cascade is
 * honest about what was tried.
 *
 * Invoked by Archon as a named script (`runtime: bun`); no args, no stdin.
 * `ARTIFACTS_DIR` is read for the abort check alone, and skipped when unset.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The three phases that can run on their own, each with its own entry conditions. */
const MODES = ["plan", "build", "review"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

/** One verdict line of the report, plus the operator-facing defect message. */
interface Check {
  label: string;
  ok: boolean;
  message: string;
}

/** Trimmed stdout, or `undefined` for a non-zero exit and for a missing binary. */
function run(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function main(env = process.env): number {
  // An absent mode is `plan`, the strictest of the three, so this script lands
  // before the composition commit that declares `with: {mode: …}` everywhere
  // and `ralph-wiggum.yaml` keeps working in between (§12.7). An
  // *unrecognised* mode is a different case and fails, as `ralph-snapshot`
  // fails it: a typo must not quietly drop the goal check.
  const declared = env.INPUTS_MODE;
  const mode = declared === undefined || declared === "" ? "plan" : declared;
  if (!isMode(mode)) {
    console.error(
      `ralph-precondition: INPUTS_MODE must be ${MODES.join(", ")}; got ${JSON.stringify(declared)}`,
    );
    return 1;
  }

  const goal = (env.ARGUMENTS ?? "").trim();
  // `--is-inside-work-tree` prints `false` and exits 0 in a bare repository and
  // inside `.git`, so the value is checked and not just the exit code.
  const worktree = run("git", ["rev-parse", "--is-inside-work-tree"]);
  // `-q` makes a detached `HEAD` exit 1 silently. An unborn branch keeps HEAD a
  // symbolic ref, so the same check passes a freshly initialised repository.
  const branch = run("git", ["symbolic-ref", "-q", "HEAD"]);

  const goalCheck: Check = {
    label: "ARGUMENTS carries a goal",
    ok: goal !== "",
    message:
      'ralph-wiggum requires a goal: archon workflow run ralph-wiggum "<specification or sentence>"; ralph-plan takes the same goal.',
  };

  // No `ARTIFACTS_DIR`, no marker to read: a block run outside Archon has no
  // earlier block that could have aborted.
  const artifactsDir = env.ARTIFACTS_DIR ?? "";
  const checksAbort = mode !== "plan" && artifactsDir !== "";
  const marker = join(artifactsDir, "abort.txt");
  const abortLine =
    checksAbort && existsSync(marker) ? readFileSync(marker, "utf8").split("\n")[0] : undefined;
  const abortCheck: Check = {
    label: "no earlier block aborted the run",
    ok: abortLine === undefined,
    message: `ralph-precondition: an earlier block aborted the run: ${abortLine}`,
  };

  const checks: Check[] = [
    ...(mode === "plan" ? [goalCheck] : []),
    ...(checksAbort ? [abortCheck] : []),
    {
      label: "the working directory is inside a git work tree",
      ok: worktree === "true",
      message: "ralph-precondition: not inside a git work tree. Run 'git init' first.",
    },
    {
      label: `HEAD is on a branch (${branch ?? "detached"})`,
      ok: branch !== undefined,
      message:
        "ralph-precondition: HEAD is detached. Check out a branch; the build loop pushes it.",
    },
    {
      label: "bun is on PATH",
      ok: run("bun", ["--version"]) !== undefined,
      message: "ralph-precondition: 'bun' is not on PATH.",
    },
    {
      label: "git is on PATH",
      ok: run("git", ["--version"]) !== undefined,
      message: "ralph-precondition: 'git' is not on PATH.",
    },
  ];

  for (const check of checks) console.log(`${check.ok ? "ok" : "FAIL"}: ${check.label}`);
  const failed = checks.filter((check) => !check.ok);
  for (const check of failed) console.error(check.message);
  return failed.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
