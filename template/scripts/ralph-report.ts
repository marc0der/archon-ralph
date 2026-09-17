#!/usr/bin/env bun
/**
 * Ralph REPORT node — the lifecycle summary (spec §4.2).
 *
 * Every phase row comes out of `outcome.log` and out of nothing else.
 * `ralph-snapshot` zeroes the per-phase counters at the start of each cycle, so
 * by report time those files hold the last cycle's numbers only; anything a row
 * needs — the build's iteration count, the review's pass and audited count, the
 * open items a cycle left behind — is written into the log line by the cap
 * script that ended the phase.
 *
 * The log splits into cycles on its `cycle N:` lines, which `ralph-cycle-cap`
 * appends when a build-review cycle finishes: the lines before the first one
 * belong to `seed` and `plan`, and the lines after one belong to the next
 * cycle. A phase with no line in its block did not run, and the block's own
 * `cycle N:` line is what says why.
 *
 * It exits 0 in every case, an abort included. This is a report; `ralph-guard`
 * has already failed the run, and a report that failed as well would bury the
 * summary under a second error. Every read is therefore best-effort: a missing
 * log, a missing marker and a missing plan each render as a row rather than
 * throwing.
 *
 * Invoked by Archon as a named script (`runtime: bun`) with `trigger_rule:
 * all_done` and `always_run: true`, so it runs whatever the cycle group did.
 * `ARTIFACTS_DIR` says where the log and the marker are.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { counts } from "./ralph-counts.ts";

/** A cycle block closes on the line `ralph-cycle-cap` appends to end a cycle. */
const CYCLE_END = /^cycle \d+: /;

/** `cycle N: clean — no open items remain`: the finished-lifecycle line. */
const CYCLE_CLEAN = /^cycle \d+: clean\b/;

/** `cycle N: O open items remain — …`: the only cycle line that counts them. */
const CYCLE_OPEN = /^cycle \d+: (\d+) open items remain/;

/** `cycle N: reached the cycle cap of C …`: open items, named but not counted. */
const CYCLE_CAPPED = /^cycle \d+: reached the cycle cap\b/;

/**
 * The state of a phase whose block holds no line for it and says nothing about
 * why. `seed` and `plan` are unguarded (§3.1), so an absent row for either
 * means the run never reached it — ralph's own word for that state.
 */
const NOT_REACHED = "not reached";

/** Where the run left its artifacts. The timestamp stays a placeholder, as in ralph. */
const ARTIFACTS_ROW =
  "Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; " +
  "previous cycle under .ralph/<timestamp>/";

/** One build-review cycle's rows, as `outcome.log` records them. */
export interface Cycle {
  build: string | null;
  review: string | null;
  /** The `cycle N:` line that closed the block, or `null` when the cycle never ended. */
  end: string | null;
}

export interface Outcome {
  seed: string | null;
  plan: string | null;
  cycles: Cycle[];
}

/**
 * Split `outcome.log` into the `seed` and `plan` rows and one block per cycle.
 *
 * Lines that match no phase prefix are dropped, which is what keeps a build
 * abort readable: `ralph-build-cap` appends `build: push rejected` followed by
 * git's own output, and those extra lines are evidence for `abort.txt`, not
 * rows. A trailing block is kept only when it holds a phase line, because the
 * healthy case ends the log with a `cycle N:` line and the block it opens is
 * empty.
 */
export function parseOutcome(log: string): Outcome {
  const cycles: Cycle[] = [];
  let seed: string | null = null;
  let plan: string | null = null;
  let current: Cycle = { build: null, review: null, end: null };

  for (const line of log.split("\n")) {
    if (CYCLE_END.test(line)) {
      current.end = line;
      cycles.push(current);
      current = { build: null, review: null, end: null };
    } else if (line.startsWith("build: ")) current.build = line;
    else if (line.startsWith("review: ")) current.review = line;
    else if (line.startsWith("seed: ")) seed = line;
    else if (line.startsWith("plan: ")) plan = line;
  }
  if (current.build !== null || current.review !== null) cycles.push(current);

  return { seed, plan, cycles };
}

/**
 * The open count a cycle's closing line names: `0` for a clean cycle, the
 * number it states, or `null` when no count is available — the cycle cap's line
 * names open items without counting them, and an unfinished cycle has no line
 * at all.
 */
function openAfter(end: string | null): number | null {
  if (end === null) return null;
  if (CYCLE_CLEAN.test(end)) return 0;
  const named = CYCLE_OPEN.exec(end);
  return named?.[1] === undefined ? null : Number(named[1]);
}

/** Why `review` was skipped, read off the same cycle line the row belongs to. */
function reviewSkipped(open: number | null): string {
  // `open == 0` is the guard `review` is declared with (§3.1), so a clean cycle
  // that skipped review had nothing shipped to audit.
  if (open === 0) return "no shipped items to audit";
  // The cycle cap's wording, uncounted, for the cycle whose line does not count.
  if (open === null) return "open items remain";
  return `${open} open items remain`;
}

/** A top-level row. The state column sits at column 11, as ralph's `%-9s` puts it. */
function topRow(label: string, state: string): string {
  return `  ${label.padEnd(9)}${state}`;
}

/** A row inside a cycle block: indented two further, aligned to the same column. */
function cycleRow(label: string, state: string): string {
  return `    ${label.padEnd(7)}${state}`;
}

/**
 * The state column of one phase row.
 *
 * `absent` is the state for a phase with no line, and `suffix` the clause a
 * `ran` row carries beyond its log line. The `<phase>: ` prefix is sliced off
 * the line because the label already carries it.
 */
function phaseState(
  label: string,
  line: string | null,
  abort: string | null,
  absent: string,
  suffix = "",
): string {
  if (line === null) return absent;
  // Both abort paths append their marker text to `outcome.log` as well as
  // writing `abort.txt`, so the phase that aborted is the one whose line is
  // that text. The first line is printed whole, prefix included: it is the
  // marker verbatim, and a row that disagrees with the marker is worth seeing.
  if (line === abort) return `failed — ${abort}`;
  return `ran — ${line.slice(label.length + 2)}${suffix}`;
}

/**
 * How the lifecycle ended, from the last cycle's closing line.
 *
 * The abort is checked first. Neither guard lets a cycle close after writing
 * the marker, so the two cannot disagree today, but a run that failed must
 * never report a clean result because of a line that arrived anyway.
 */
function resultRow(cycles: Cycle[], abort: string | null): string {
  const n = cycles.length;
  if (n === 0) return `  Result: ${NOT_REACHED}`;
  const after = `after ${n} ${n === 1 ? "cycle" : "cycles"}`;
  const end = cycles[n - 1]?.end ?? null;
  if (abort !== null) return `  Result: failed ${after}`;
  if (end !== null && CYCLE_CLEAN.test(end)) return `  Result: clean ${after}`;
  if (end !== null && CYCLE_CAPPED.test(end)) return `  Result: stopped at the cycle cap ${after}`;
  // A cycle that opened another one and then stopped: the group hit its own
  // `max_iterations`, or a node in it failed for a reason no marker records.
  return `  Result: stopped with open items ${after}`;
}

/** The plan's three counts, through the same path the cycle guards count with. */
function planRow(): string {
  try {
    const { open, shipped, superseded } = counts();
    return `Plan: ${shipped} shipped, ${open} open, ${superseded} superseded`;
  } catch {
    // Reachable: `report` is `always_run`, so it runs after a `seed` that never
    // scaffolded the plan. Naming the gap beats printing three zeroes.
    return "Plan: no IMPLEMENTATION_PLAN.md in the tree";
  }
}

/** An artifact's contents, or `""` when it is missing, unreadable or unlocatable. */
function readArtifact(artifactsDir: string, name: string): string {
  if (artifactsDir === "") return "";
  try {
    return readFileSync(join(artifactsDir, name), "utf8");
  } catch {
    return "";
  }
}

function firstLine(text: string): string | null {
  const line = text.split("\n")[0] ?? "";
  return line === "" ? null : line;
}

/** The summary, one string per line. */
export function report(artifactsDir: string): string[] {
  const { seed, plan, cycles } = parseOutcome(readArtifact(artifactsDir, "outcome.log"));
  const abort = firstLine(readArtifact(artifactsDir, "abort.txt"));

  const lines = [
    "Ralph lifecycle summary",
    topRow("seed", phaseState("seed", seed, abort, NOT_REACHED)),
    topRow("plan", phaseState("plan", plan, abort, NOT_REACHED)),
  ];
  cycles.forEach((cycle, index) => {
    // The index, not the N in the line: a cycle whose guard failed mid-way has
    // no `cycle N:` line at all, and its block still needs a header.
    lines.push(`  cycle ${index + 1}`);
    const open = openAfter(cycle.end);
    lines.push(
      cycleRow("build", phaseState("build", cycle.build, abort, "skipped — no open items")),
    );
    lines.push(
      cycleRow(
        "review",
        phaseState(
          "review",
          cycle.review,
          abort,
          `skipped — ${reviewSkipped(open)}`,
          open === null ? "" : `, filed ${open} findings`,
        ),
      ),
    );
  });
  lines.push(resultRow(cycles, abort), "", planRow(), ARTIFACTS_ROW);
  return lines;
}

export function main(env = process.env): number {
  const artifactsDir = env.ARTIFACTS_DIR ?? "";
  if (artifactsDir === "") {
    // Still exit 0, still print: every row reads `not reached`, which is honest
    // about what could be seen, and stderr says why nothing could be.
    console.error("ralph-report: ARTIFACTS_DIR is not set");
  }
  for (const line of report(artifactsDir)) console.log(line);
  return 0;
}

if (import.meta.main) process.exit(main());
