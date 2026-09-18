#!/usr/bin/env bun
/**
 * Ralph REPORT node — the lifecycle summary (spec §4.2).
 *
 * One script, four modes, read from `INPUTS_MODE` (`with: {mode: …}` in the
 * workflow). `auto` prints the summary §4.2 quotes and belongs to
 * `ralph-wiggum`; `plan`, `build` and `review` print one phase block's interim
 * report and belong to the phase workflows of §12.3. Composed, the block
 * reports run too: their lines say what each phase did while the run is still
 * going, and the summary at the end is the record (§12.4).
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
 * throwing. An unrecognised `INPUTS_MODE` is the one exception, because it is a
 * typo in the workflow rather than a run outcome: it fails, as `ralph-snapshot`
 * fails it.
 *
 * Invoked by Archon as a named script (`runtime: bun`) with `trigger_rule:
 * all_done` and `always_run: true`, so it runs whatever the cycle group did.
 * `ARTIFACTS_DIR` says where the log and the marker are.
 *
 * The repositories row is the one figure that comes from outside the log:
 * `run-start.txt` holds the sha listing from the start of the run, and the diff
 * against `repoState()` at report time is what the run committed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoState } from "./lib/ralph.ts";
import { counts } from "./ralph-counts.ts";

/** The lifecycle summary, then one mode per phase workflow (§12.4). */
const MODES = ["auto", "plan", "build", "review"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

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

/* ── The repositories a run moved ─────────────────────────────────────────── */

/** A `<path> <sha>` listing, keyed by path, as `repoState` writes it. */
function parseRepoState(text: string): Map<string, string> {
  const shas = new Map<string, string>();
  for (const line of text.split("\n")) {
    // The sha is the last field, so a repository path with a space parses too.
    const space = line.lastIndexOf(" ");
    if (space > 0) shas.set(line.slice(0, space), line.slice(space + 1));
  }
  return shas;
}

/**
 * How far one repository moved: the commits it gained, or the bare word
 * `moved` where no count can be taken (§4.2).
 *
 * `-` is `repoState`'s sha for a repository whose `HEAD` does not resolve, and
 * a repository absent from `run-start.txt` appeared during the run; neither end
 * of `<start>..HEAD` exists in those two cases. The `catch` covers the third:
 * a start sha that is no longer reachable, which is what a rebase or a reset
 * during the run leaves behind.
 */
function movement(repo: string, start: string, now: string): string {
  if (start === "-" || now === "-") return "moved";
  try {
    const count = execFileSync("git", ["-C", repo, "rev-list", "--count", `${start}..HEAD`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `(${count} ${count === "1" ? "commit" : "commits"})`;
  } catch {
    return "moved";
  }
}

/**
 * Every repository whose `HEAD` differs from the listing `ralph-seed` recorded
 * in `run-start.txt`, in the byte order `repoState` sorts them into.
 *
 * Only repositories that exist now are listed. `repoState` counts one that
 * vanished as a change, because the build loop needs any change to read as
 * progress (§4.1); this line is about commits, and a directory that is gone
 * has none to count.
 */
export function movedRepos(artifactsDir: string): string[] {
  const started = parseRepoState(readArtifact(artifactsDir, "run-start.txt"));
  const rows: string[] = [];
  for (const [repo, now] of parseRepoState(repoState())) {
    const start = started.get(repo) ?? "-";
    if (start === now) continue;
    // `repoState` scans from `.`, so every nested path carries that prefix;
    // §4.2 prints the path relative to the checkout root.
    rows.push(`${repo.replace(/^\.\//, "")} ${movement(repo, start, now)}`);
  }
  return rows;
}

/** What every renderer reads: the parsed log and the abort marker's first line. */
function readRun(artifactsDir: string): { outcome: Outcome; abort: string | null } {
  return {
    outcome: parseOutcome(readArtifact(artifactsDir, "outcome.log")),
    abort: firstLine(readArtifact(artifactsDir, "abort.txt")),
  };
}

/** The summary, one string per line. */
export function report(artifactsDir: string): string[] {
  const {
    outcome: { seed, plan, cycles },
    abort,
  } = readRun(artifactsDir);

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
  lines.push(resultRow(cycles, abort), "", planRow());
  // No line at all when nothing moved: a run that shipped nothing says so in
  // its phase rows already, and an empty list reads as a missing number.
  const moved = movedRepos(artifactsDir);
  if (moved.length > 0) lines.push(`Repositories that moved: ${moved.join(", ")}`);
  lines.push(ARTIFACTS_ROW);
  return lines;
}

/* ── The block reports (§12.4) ───────────────────────────────────── */

/**
 * The cycle a block is reporting on: the one block `ralph-cycle-cap` has not
 * closed yet, or `null` when the current cycle appended no row at all.
 *
 * The last `build:` or `review:` row in the whole log is the wrong row. A
 * review block skipped on its `when:` guard — the build stopped short and left
 * open items — would otherwise report the row of an earlier cycle's review as
 * if this one had run. A closed trailing block means the same thing as no
 * block: whatever this cycle did, it wrote no row for it.
 */
function currentCycle(cycles: Cycle[]): Cycle | null {
  const last = cycles.at(-1);
  return last === undefined || last.end !== null ? null : last;
}

/**
 * One phase block's report: the row its cap script appended, then the plan
 * counts.
 *
 * The row goes through the same `topRow` and `phaseState` as the summary, so
 * the interim lines a composed run prints line up with the summary that
 * follows them. Neither the cycle's `filed F findings` clause nor a counted
 * skip reason is available here: both are read off the `cycle N:` line, which
 * `ralph-cycle-cap` appends after the block has already reported.
 */
function phaseReport(
  label: string,
  line: string | null,
  abort: string | null,
  absent: string,
): string[] {
  return [topRow(label, phaseState(label, line, abort, absent)), "", planRow()];
}

/** The `plan` block's report. An absent row means the loop never ran (§3.1). */
export function planReport(artifactsDir: string): string[] {
  const { outcome, abort } = readRun(artifactsDir);
  return phaseReport("plan", outcome.plan, abort, NOT_REACHED);
}

/**
 * The `build` block's report, with the repositories the run moved.
 *
 * The block commits, so this is the one block report that says what landed;
 * `movedRepos` is measured against the same `run-start.txt` the summary uses,
 * so a standalone `ralph-build` reports its commits exactly as the lifecycle
 * does.
 */
export function buildReport(artifactsDir: string): string[] {
  const { outcome, abort } = readRun(artifactsDir);
  const build = currentCycle(outcome.cycles)?.build ?? null;
  const lines = phaseReport("build", build, abort, "skipped — no open items");
  const moved = movedRepos(artifactsDir);
  if (moved.length > 0) lines.push(`Repositories that moved: ${moved.join(", ")}`);
  return lines;
}

/**
 * The `review` block's report.
 *
 * The absent row is the guard's first clause and not its second: a block with
 * open items outstanding skipped for that reason, but the row it prints names
 * the audit, because that is the phase that did not happen.
 */
export function reviewReport(artifactsDir: string): string[] {
  const { outcome, abort } = readRun(artifactsDir);
  const review = currentCycle(outcome.cycles)?.review ?? null;
  return phaseReport("review", review, abort, "skipped — no shipped items to audit");
}

/** The renderer each mode prints. Exhaustive over `MODES` by type. */
const RENDER: Record<Mode, (artifactsDir: string) => string[]> = {
  auto: report,
  plan: planReport,
  build: buildReport,
  review: reviewReport,
};

export function main(env = process.env): number {
  // An absent mode is `auto`, today's behaviour, so this script lands before
  // the composition commit that declares `with: {mode: …}` everywhere and
  // `ralph-wiggum.yaml` keeps working in between (§12.7). An *unrecognised*
  // mode is checked before anything is printed: a typo must not print the
  // lifecycle summary in the middle of a run and call it a phase report.
  const declared = env.INPUTS_MODE;
  const mode = declared === undefined || declared === "" ? "auto" : declared;
  if (!isMode(mode)) {
    console.error(
      `ralph-report: INPUTS_MODE must be ${MODES.join(", ")}; got ${JSON.stringify(declared)}`,
    );
    return 1;
  }

  const artifactsDir = env.ARTIFACTS_DIR ?? "";
  if (artifactsDir === "") {
    // Still exit 0, still print: every row reads `not reached`, which is honest
    // about what could be seen, and stderr says why nothing could be.
    console.error("ralph-report: ARTIFACTS_DIR is not set");
  }
  for (const line of RENDER[mode](artifactsDir)) console.log(line);
  return 0;
}

if (import.meta.main) process.exit(main());
