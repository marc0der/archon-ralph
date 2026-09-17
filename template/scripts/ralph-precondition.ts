#!/usr/bin/env bun
/**
 * Ralph PRECONDITION node — refuse a run the loop cannot finish (spec §4.2).
 *
 * The first node of the workflow, and the only one that can stop it before
 * `ralph-seed` archives the previous cycle's artifacts. Each defect below makes
 * a later phase fail in a way that is expensive to read: a goalless plan run
 * plans against whatever `specs/` it resolves — the wrong node's, in a meta
 * repository — and a detached workspace has no branch for the build loop to
 * push.
 *
 * Every check runs before the exit code is decided, so one run reports every
 * defect rather than one per restart. A `bun` or `git` missing from `PATH`
 * therefore also fails the checks that shell out to them; that cascade is
 * honest about what was tried.
 *
 * Invoked by Archon as a named script (`runtime: bun`); no args, no stdin, and
 * `ARTIFACTS_DIR` is unused — nothing has been seeded yet.
 */

import { execFileSync } from "node:child_process";

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

export function main(): number {
  const goal = (process.env.ARGUMENTS ?? "").trim();
  // `--is-inside-work-tree` prints `false` and exits 0 in a bare repository and
  // inside `.git`, so the value is checked and not just the exit code.
  const worktree = run("git", ["rev-parse", "--is-inside-work-tree"]);
  // `-q` makes a detached `HEAD` exit 1 silently. An unborn branch keeps HEAD a
  // symbolic ref, so the same check passes a freshly initialised repository.
  const branch = run("git", ["symbolic-ref", "-q", "HEAD"]);

  const checks: Check[] = [
    {
      label: "ARGUMENTS carries a goal",
      ok: goal !== "",
      message:
        'ralph-wiggum requires a goal: archon workflow run ralph-wiggum "<specification or sentence>"',
    },
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
