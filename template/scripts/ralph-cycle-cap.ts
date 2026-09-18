#!/usr/bin/env bun
/**
 * Ralph CYCLE-CAP — the `until_bash` of the `cycle` loop_group (spec §4.2).
 *
 * One `loop_group` iteration is one ralph cycle: build to exhaustion, then
 * review. This is the fixpoint test between cycles, and the whole lifecycle's
 * outer bound. It is the follow-up ralph's `specs/auto-lifecycle.md` §13
 * deferred for want of a cost bound (§1) — Archon supplies the bound, and this
 * script spends it.
 *
 * Zero open items after a cycle is a finished lifecycle however it came about:
 * review ran and filed nothing, build shipped everything and review was
 * skipped, or the plan arrived empty and neither phase ran (§3.2). Open items
 * mean review filed findings or build stopped short, so another cycle runs both
 * phases again — until `cycle_cap`, where the run stops with the open items
 * named rather than quietly claiming success.
 *
 * `until_bash` exit codes are inverted from a normal script (§2): exit 0
 * **completes** the group, any non-zero exit means "run another cycle". The cap
 * is therefore a deliberate exit 0, well below the group's `max_iterations: 20`
 * — exhausting that ceiling fails the node, and a lifecycle that used its
 * budgeted cycles is not a failed run. That is also why the README requires
 * `cycle_cap` to stay under 20.
 *
 * Unlike every per-phase counter, `cycle-iter.txt` is never reset: it counts
 * across the cycles it bounds, and `ralph-snapshot` resets only the counters of
 * the phase it snapshots (§4.2). `ralph-seed` does not write it either, so the
 * first cycle reads the `readCounter` fallback of 0.
 *
 * Invoked from the workflow YAML as
 *   until_bash: bun run .archon/scripts/ralph-cycle-cap.ts "$ARTIFACTS_DIR"
 * Archon's loop executor injects neither `ARTIFACTS_DIR` nor `INPUTS_*` into
 * the subprocess (§2), so the directory arrives textually as `argv[2]`.
 */

import { join } from "node:path";
import {
  appendOutcome,
  countItems,
  planItemsBody,
  readCounter,
  readSettings,
  writeCounter,
} from "./lib/ralph.ts";

export function main(argv = process.argv): number {
  const artifactsDir = argv[2];
  if (artifactsDir === undefined || artifactsDir === "") {
    // Non-zero here means "run another cycle", so a workflow that drops the
    // argument burns all 20 cycles and fails the node. That is the intended
    // noise: exiting 0 would end the lifecycle after one cycle, which is
    // indistinguishable from a clean run in the report.
    console.error(
      'ralph-cycle-cap: the artifacts directory is required as argv[2] ("$ARTIFACTS_DIR")',
    );
    return 1;
  }

  const iterFile = join(artifactsDir, "cycle-iter.txt");
  const cycles = readCounter(iterFile, 0) + 1;
  writeCounter(iterFile, cycles);

  // `planItemsBody` and not the whole file: the exemplar under `## Entry Format`
  // is an open item textually, and counting it would make `open` 1 on an
  // exhausted plan — every run would then spend its full `cycle_cap`. A plan
  // that is absent throws; the build block's `counts` has already failed the
  // run (§4.2).
  const open = countItems(planItemsBody(), "[ ]");
  if (open === 0) {
    appendOutcome(artifactsDir, `cycle ${cycles}: clean — no open items remain`);
    return 0;
  }

  // The report reads the open count out of these lines (§4.2), so each one
  // names the cycle it ends and what it left behind.
  const cap = readSettings(artifactsDir).cycle_cap;
  if (cycles >= cap) {
    appendOutcome(
      artifactsDir,
      `cycle ${cycles}: reached the cycle cap of ${cap} with open items remaining`,
    );
    return 0;
  }

  appendOutcome(
    artifactsDir,
    `cycle ${cycles}: ${open} open items remain — starting cycle ${cycles + 1}`,
  );
  return 1;
}

if (import.meta.main) process.exit(main());
