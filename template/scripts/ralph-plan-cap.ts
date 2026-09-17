#!/usr/bin/env bun
/**
 * Ralph PLAN-CAP — the `until_bash` of the `plan` loop (spec §4.2).
 *
 * The plan phase never commits: `IMPLEMENTATION_PLAN.md` is gitignored, so
 * `HEAD` cannot tell whether a pass did anything. Convergence is measured with
 * `planStateHash()` instead — the plan plus every spec, the only artifacts the
 * phase is allowed to change. A pass that leaves that fingerprint alone has
 * nothing left to say, so the loop completes.
 *
 * `until_bash` exit codes are inverted from a normal script (§2): exit 0
 * **completes** the loop, any non-zero exit means "keep looping". The cap
 * therefore exits 0 on purpose at ralph's `PLAN_DEFAULT_CAP`, well below the
 * node's `max_iterations` — exhausting that ceiling fails the node, and a plan
 * that will not settle is not a failed run.
 *
 * Invoked from the workflow YAML as
 *   until_bash: bun run .archon/scripts/ralph-plan-cap.ts "$ARTIFACTS_DIR"
 * Archon's loop executor injects neither `ARTIFACTS_DIR` nor `INPUTS_*` into
 * the subprocess (§2), so the directory arrives textually as `argv[2]`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendOutcome, planStateHash, readCounter, writeCounter } from "./lib/ralph.ts";

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
    // runs the plan phase to `max_iterations` and fails the node. That is the
    // intended noise: exiting 0 would hide the misconfiguration behind a
    // single plan pass that looks like convergence.
    console.error('ralph-plan-cap: the artifacts directory is required as argv[2] ("$ARTIFACTS_DIR")');
    return 1;
  }

  const n = readCounter(join(artifactsDir, "plan-iter.txt"), 0) + 1;
  writeCounter(join(artifactsDir, "plan-iter.txt"), n);

  const hashFile = join(artifactsDir, "plan-hash.txt");
  const before = readHash(hashFile);
  const after = planStateHash();
  // Written back every iteration, so the next pass compares against this pass
  // and not against the snapshot. An md5 is never `""`, so a missing snapshot
  // cannot read as convergence on pass 1.
  writeFileSync(hashFile, `${after}\n`);

  if (before === after) {
    appendOutcome(artifactsDir, `plan: converged on pass ${n}`);
    return 0;
  }
  // Ralph's `PLAN_DEFAULT_CAP`, spelt out rather than named: the bound and the
  // line the report reads must agree, and they only do so visibly side by side.
  if (n >= 6) {
    appendOutcome(artifactsDir, "plan: reached the cap of 6 passes");
    return 0;
  }
  return 1;
}

if (import.meta.main) process.exit(main());
