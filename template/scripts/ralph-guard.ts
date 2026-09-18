#!/usr/bin/env bun
/**
 * Ralph GUARD node — fail the run on an abort marker (spec §4.3).
 *
 * `until_bash` has two outcomes, complete and continue, and Archon fails a loop
 * node only when its `max_iterations` runs out. Two of ralph's conditions have
 * to stop the whole run from inside a loop: a push git rejects, and a review
 * pass that un-ticks a shipped item. Neither cap script can fail its own node,
 * so each writes `abort.txt` and completes the loop; this node is what turns
 * that marker into a non-zero exit. It is the only place a run fails for a
 * loop-side reason.
 *
 * It runs twice per cycle, after `build` and after `review`, with
 * `trigger_rule: all_done` and `always_run: true`. That pair is what lets it
 * run when the loop it follows was skipped by a `when:` guard — in which case
 * there is no marker and it exits 0, which is also the ordinary outcome.
 *
 * The marker is never cleared here. `ralph-report` reads the same file to print
 * its `failed — <first line>` row, and nothing else touches it. The marker
 * lives in `ARTIFACTS_DIR`, which belongs to the run, while `ralph-seed` moves
 * only the two plan artifacts in the checkout — so an abort stays readable for
 * as long as Archon keeps the run's artifacts, and a mistaken `workflow resume`
 * fails at this guard again on the same marker (§12.2).
 *
 * Invoked by Archon as a named script (`runtime: bun`); no args, no stdin, and
 * `ARTIFACTS_DIR` says where the marker would be.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function main(env = process.env): number {
  const artifactsDir = env.ARTIFACTS_DIR;
  if (artifactsDir === undefined || artifactsDir === "") {
    // A guard that cannot look for the marker has to assume the worst. Exiting
    // 0 here would report a rejected push or a destroyed plan as a clean run,
    // which is the one failure this node exists to prevent.
    console.error("ralph-guard: ARTIFACTS_DIR is not set");
    return 1;
  }

  const marker = join(artifactsDir, "abort.txt");
  if (!existsSync(marker)) {
    console.log("ralph-guard: no abort marker");
    return 0;
  }

  // Deliberately unguarded: a marker that exists but cannot be read still means
  // a loop aborted, and the throw exits non-zero with the reason attached.
  console.error(readFileSync(marker, "utf8").trimEnd());
  return 1;
}

if (import.meta.main) process.exit(main());
