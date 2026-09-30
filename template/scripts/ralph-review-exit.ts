#!/usr/bin/env bun
/**
 * Ralph REVIEW-EXIT node — count what the one review pass did (spec §4.4).
 *
 * Review files findings into `IMPLEMENTATION_PLAN.md`, which is gitignored, so
 * a clean pass changes no file and looks exactly like a backend that read the
 * prompt and did nothing. This node prints ralph's exit line, counted here
 * rather than taken from the agent: the open items after the pass, the cited
 * specs, and the files the cycle changed since `.ralph/cycle-base`.
 *
 * The one thing review can do that plan cannot is destroy work: un-ticking a
 * shipped item puts it back in the second build's queue. Review files findings
 * as *new* items and never re-opens an old one, so a `[x]` count below
 * `shipped-before.txt` is a broken pass — it writes `abort.txt` and exits 0,
 * and `guard` fails the run (§4.3).
 *
 * Invoked by Archon as a named script (`runtime: bun`); no args, no stdin, and
 * `ARTIFACTS_DIR` says where the run state lives.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendOutcome,
  citedSpecs,
  countItems,
  cycleChangedFiles,
  planItemsBody,
  readCounter,
} from "./lib/ralph.ts";

export function main(env = process.env): number {
  const artifactsDir = env.ARTIFACTS_DIR;
  if (artifactsDir === undefined || artifactsDir === "") {
    console.error("ralph-review-exit: ARTIFACTS_DIR is not set");
    return 1;
  }

  // A plan that is absent throws and fails the node (§4.4).
  const body = planItemsBody();
  const shipped = countItems(body, "[x]");
  // 0 as the fallback, so a missing baseline can never read as a drop.
  const before = readCounter(join(artifactsDir, "shipped-before.txt"), 0);
  if (shipped < before) {
    const text =
      `review: reduced the shipped item count from ${before} to ${shipped}; review may ` +
      "never un-tick an item. Restore IMPLEMENTATION_PLAN.md before re-running.";
    writeFileSync(join(artifactsDir, "abort.txt"), `${text}\n`);
    appendOutcome(artifactsDir, text);
    return 0;
  }

  const findings = countItems(body, "[ ]");
  const specs = citedSpecs(body).length;
  const changed = cycleChangedFiles().length;
  const exitLine =
    `Review filed ${findings} findings. Reviewed ${specs} specs and ${changed} changed files.`;
  appendOutcome(artifactsDir, `review: ${exitLine}`);
  console.log(exitLine);
  return 0;
}

if (import.meta.main) process.exit(main());
