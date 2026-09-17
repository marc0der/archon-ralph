#!/usr/bin/env bun
/**
 * Ralph REVIEW-CAP — the `until_bash` of the `review` loop (spec §4.2).
 *
 * The review phase converges on the same fingerprint as the plan phase, and
 * for the same reason: it writes findings into `IMPLEMENTATION_PLAN.md`, which
 * is gitignored, so `HEAD` says nothing about whether a pass did anything. A
 * pass that leaves `planStateHash()` alone found nothing to file. The counter
 * and hash idiom below is `ralph-plan-cap`'s, message text aside.
 *
 * The one thing review can do that plan cannot is destroy work: un-ticking a
 * shipped item puts it back in the build phase's queue and the next cycle
 * rebuilds what is already built. Review files findings as *new* items and
 * never re-opens an old one, so a `[x]` count that dropped is a broken pass and
 * not a judgement — it writes `abort.txt` and lets `review-guard` fail the run
 * (§4.3). The baseline is `shipped-before.txt`, taken once per cycle by
 * `ralph-snapshot`, so a drop is caught on whichever pass causes it.
 *
 * `until_bash` exit codes are inverted from a normal script (§2): exit 0
 * **completes** the loop, any non-zero exit means "keep looping". Every stop
 * here is therefore a deliberate exit 0, well below the node's
 * `max_iterations` — exhausting that ceiling fails the node, and a review that
 * will not settle is not a failed run.
 *
 * Invoked from the workflow YAML as
 *   until_bash: bun run .archon/scripts/ralph-review-cap.ts "$ARTIFACTS_DIR"
 * Archon's loop executor injects neither `ARTIFACTS_DIR` nor `INPUTS_*` into
 * the subprocess (§2), so the directory arrives textually as `argv[2]`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendOutcome,
  countItems,
  planItemsBody,
  planStateHash,
  readCounter,
  writeCounter,
} from "./lib/ralph.ts";

/** The fingerprint `ralph-snapshot` left, or `""` when there is no file. */
function readHash(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

export function main(argv = process.argv): number {
  const artifactsDir = argv[2];
  if (artifactsDir === undefined || artifactsDir === "") {
    // Non-zero here means "keep looping", so a workflow that drops the argument
    // runs the review phase to `max_iterations` and fails the node. That is the
    // intended noise: exiting 0 would hide the misconfiguration behind a single
    // review pass that looks like convergence.
    console.error(
      'ralph-review-cap: the artifacts directory is required as argv[2] ("$ARTIFACTS_DIR")',
    );
    return 1;
  }

  const iterFile = join(artifactsDir, "review-iter.txt");
  const n = readCounter(iterFile, 0) + 1;
  writeCounter(iterFile, n);

  // `planItemsBody` and not the whole file: the exemplar under `## Entry Format`
  // carries no `[x]`, but the count has to come from the same path the snapshot
  // counted with or the two are not comparable. A plan that is absent throws —
  // `counts-pre-review` has already failed the run by then (§4.2).
  const shipped = countItems(planItemsBody(), "[x]");
  // 0 as the fallback, so a missing baseline can never read as a drop: a review
  // whose snapshot did not run must audit, not abort.
  const before = readCounter(join(artifactsDir, "shipped-before.txt"), 0);
  if (shipped < before) {
    const text =
      `review: reduced the shipped item count from ${before} to ${shipped}; review may ` +
      "never un-tick an item. Restore IMPLEMENTATION_PLAN.md before re-running.";
    writeFileSync(join(artifactsDir, "abort.txt"), `${text}\n`);
    appendOutcome(artifactsDir, text);
    return 0;
  }

  const hashFile = join(artifactsDir, "plan-hash.txt");
  const hashBefore = readHash(hashFile);
  const hashAfter = planStateHash();
  // Written back every pass, so the next pass compares against this pass and
  // not against the snapshot. An md5 is never `""`, so a missing snapshot
  // cannot read as convergence on pass 1.
  writeFileSync(hashFile, `${hashAfter}\n`);

  if (hashBefore === hashAfter) {
    appendOutcome(artifactsDir, `review: converged on pass ${n}, audited ${shipped} shipped items`);
    return 0;
  }
  // Ralph's `PLAN_DEFAULT_CAP`, spelt out rather than named: the bound and the
  // line the report reads must agree, and they only do so visibly side by side.
  if (n >= 6) {
    appendOutcome(artifactsDir, "review: reached the cap of 6 passes");
    return 0;
  }
  return 1;
}

if (import.meta.main) process.exit(main());
