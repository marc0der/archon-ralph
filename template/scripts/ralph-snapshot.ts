#!/usr/bin/env bun
/**
 * Ralph SNAPSHOT node — record the pre-phase state the cap and exit scripts
 * compare against (§4.2).
 *
 * One script, three modes, read from `INPUTS_MODE` (`with: {mode: …}` in the
 * workflow). It runs once per block, not once per cycle, immediately before the
 * phase it snapshots, and writes into `ARTIFACTS_DIR` — except the cycle base.
 *
 * Two things follow from running per block rather than per run:
 *
 * - The build budget is recomputed from the open count each block, exactly as
 *   a fresh `ralph build` would compute it. A budget carried over from the
 *   first build would strangle the second, whose plan is the review's findings.
 * - Every counter is reset here, so the counters hold the current block's
 *   numbers only. That is why each cap script writes its figures into
 *   `outcome.log` as well: by report time these files are gone (§4.2 decision).
 *
 * `build` mode also writes `.ralph/cycle-base` at the checkout root, once: the
 * second build of a cycle keeps the first build's base.
 *
 * `plan-hash.txt` belongs to `plan` alone. `review` is one pass with no loop to
 * cap, so it records only the shipped count its exit script checks.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeBudget,
  countItems,
  planItemsBody,
  planStateHash,
  repoState,
  writeCounter,
  writeCycleBase,
} from "./lib/ralph.ts";

/** The three phases that take a snapshot. */
const MODES = ["plan", "build", "review"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

/**
 * Write the snapshot files for `mode`, returning the names written so the node
 * says what it did in the workflow log.
 *
 * The plan is read through `planItemsBody`, never whole: the exemplar under
 * `## Entry Format` would otherwise inflate the budget of a freshly scaffolded
 * plan and make an audit of a plan with nothing shipped look like an audit of
 * one item.
 */
export function snapshot(artifactsDir: string, mode: Mode): string[] {
  const written: string[] = [];
  const write = (name: string, text: string) => {
    writeFileSync(join(artifactsDir, name), text);
    written.push(name);
  };
  const counter = (name: string, n: number) => {
    writeCounter(join(artifactsDir, name), n);
    written.push(name);
  };

  if (mode === "build") {
    // `repoState()` and not `HEAD`: a build iteration can commit into a nested
    // repository without moving the workspace, and that is still progress.
    write("repo-state.txt", repoState());
    counter("build-budget.txt", computeBudget(countItems(planItemsBody(), "[ ]")));
    counter("build-iter.txt", 0);
    counter("build-noops.txt", 0);
    return written;
  }

  if (mode === "review") {
    counter("shipped-before.txt", countItems(planItemsBody(), "[x]"));
    return written;
  }

  // Newline-terminated, as `echo "$hash" >` leaves it upstream; the cap script
  // trims what it reads back.
  write("plan-hash.txt", `${planStateHash()}\n`);
  counter("plan-iter.txt", 0);
  return written;
}

export function main(env = process.env): number {
  const artifactsDir = env.ARTIFACTS_DIR;
  if (artifactsDir === undefined || artifactsDir === "") {
    console.error("ralph-snapshot: ARTIFACTS_DIR is not set");
    return 1;
  }

  const mode = env.INPUTS_MODE;
  if (!isMode(mode)) {
    // A typo in `with: {mode: …}` would otherwise snapshot nothing, and the
    // loop that follows would compare its state against a stale file — or
    // against the previous block's counters, and exit on the first iteration.
    console.error(
      `ralph-snapshot: INPUTS_MODE must be ${MODES.join(", ")}; got ${JSON.stringify(mode ?? null)}`,
    );
    return 1;
  }

  if (mode === "build" && writeCycleBase()) console.log("build: wrote cycle-base");
  for (const name of snapshot(artifactsDir, mode)) console.log(`${mode}: wrote ${name}`);
  return 0;
}

if (import.meta.main) process.exit(main());
