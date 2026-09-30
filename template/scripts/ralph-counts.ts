#!/usr/bin/env bun
/**
 * Ralph COUNTS node — the phase gate of the build and review blocks (one-shot
 * review §4.1).
 *
 * One script, two modes, read from `INPUTS_MODE` (`with: {mode: …}` in the
 * workflow). It runs at the start of each block, because the block's guard has
 * to see the plan **as it stands at that moment**: the first build rewrites the
 * numbers review reads, and review rewrites the numbers the second build reads.
 *
 * Stdout carries **one JSON object and nothing else** — the three marker
 * counts, `base` and `run`. Archon parses it into the snapshot's `when:`, which
 * reads `run` alone, so the predicate lives here and a diagnostic line would
 * break the guard rather than inform anyone.
 *
 * A skipped node writes nothing, so when `run` is false this node appends the
 * phase's skip row to `outcome.log` itself, in ralph's `auto` wording and
 * ralph's order. Every block that starts writes exactly one row.
 *
 * A missing artifact exits non-zero instead of counting zero. After `seed` both
 * files exist, so their absence is a defect in the run — and counting zero
 * would read as "plan exhausted" and skip the phase silently. Ralph makes the
 * same call in its phase-2 artifact assertion.
 *
 * Invoked by Archon as a named script (`runtime: bun`); no args, no stdin, and
 * `ARTIFACTS_DIR` says where `outcome.log` lives.
 */

import { existsSync } from "node:fs";
import { appendOutcome, CYCLE_BASE, countItems, planItemsBody } from "./lib/ralph.ts";

/** The artifacts both loop phases need in the tree before they start. */
const REQUIRED = ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"] as const;

/** The two phases this node gates. */
const MODES = ["build", "review"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

export interface Counts {
  open: number;
  shipped: number;
  superseded: number;
  /** Whether `.ralph/cycle-base` exists, so review has a cycle to audit. */
  base: boolean;
}

/**
 * The counts, read through `planItemsBody` so the exemplar under
 * `## Entry Format` counts as nothing.
 */
export function counts(): Counts {
  const body = planItemsBody();
  return {
    open: countItems(body, "[ ]"),
    shipped: countItems(body, "[x]"),
    superseded: countItems(body, "[~]"),
    base: existsSync(CYCLE_BASE),
  };
}

/** The first failing check's row for `mode`, or `null` when the phase runs. */
export function skipRow(mode: Mode, { open, shipped, base }: Counts): string | null {
  if (mode === "build") return open === 0 ? "build: skipped — no open items" : null;
  if (shipped === 0) return "review: skipped — no shipped items";
  if (open > 0) return `review: skipped — ${open} open items remain`;
  if (!base) return "review: skipped — no cycle base";
  return null;
}

export function main(env = process.env): number {
  const artifactsDir = env.ARTIFACTS_DIR;
  if (artifactsDir === undefined || artifactsDir === "") {
    console.error("ralph-counts: ARTIFACTS_DIR is not set");
    return 1;
  }

  const mode = env.INPUTS_MODE;
  if (!isMode(mode)) {
    console.error(
      `ralph-counts: INPUTS_MODE must be ${MODES.join(", ")}; got ${JSON.stringify(mode ?? null)}`,
    );
    return 1;
  }

  const missing = REQUIRED.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`ralph-counts: missing workspace artifacts: ${missing.join(", ")}`);
    return 1;
  }

  const current = counts();
  const skip = skipRow(mode, current);
  if (skip !== null) appendOutcome(artifactsDir, skip);
  console.log(JSON.stringify({ ...current, run: skip === null }));
  return 0;
}

if (import.meta.main) process.exit(main());
