#!/usr/bin/env bun
/**
 * Ralph COUNTS node — publish the plan's three item counts (spec §4.2).
 *
 * Runs before `build` and again before `review`, because both phase guards read
 * `$counts-*.output` and both have to see the plan **as it stands at that
 * moment**: `build` runs on `open > 0`, `review` on `open == 0 && shipped > 0`,
 * and the build loop in between rewrites all three numbers.
 *
 * Stdout carries **one JSON object and nothing else**; Archon parses it into
 * the `when:` expressions above, so a diagnostic line here would break a guard
 * rather than inform anyone.
 *
 * A missing artifact exits non-zero instead of counting zero. After `seed` both
 * files exist, so their absence is a defect in the run — and counting zero
 * would read as "plan exhausted" and skip both phases silently. Ralph makes the
 * same call in its phase-2 artifact assertion.
 *
 * Invoked by Archon as a named script (`runtime: bun`); no args, no stdin, and
 * `ARTIFACTS_DIR` is unused — this node records nothing.
 */

import { existsSync } from "node:fs";
import { countItems, planItemsBody } from "./lib/ralph.ts";

/** The artifacts both loop phases need in the tree before they start. */
const REQUIRED = ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"] as const;

export interface Counts {
  open: number;
  shipped: number;
  superseded: number;
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
  };
}

export function main(): number {
  const missing = REQUIRED.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`ralph-counts: missing workspace artifacts: ${missing.join(", ")}`);
    return 1;
  }

  console.log(JSON.stringify(counts()));
  return 0;
}

if (import.meta.main) process.exit(main());
