#!/usr/bin/env bun
/**
 * Ralph REPORT node — the lifecycle summary (one-shot review §5).
 *
 * One script, four modes, read from `INPUTS_MODE` (`with: {mode: …}` in the
 * workflow). `auto` prints the summary §5.1 quotes and belongs to
 * `ralph-wiggum`; `plan`, `build` and `review` print one phase block's interim
 * report and belong to the phase workflows of §12.3. Composed, the block
 * reports run too: their lines say what each phase did while the run is still
 * going, and the summary at the end is the record (§12.4).
 *
 * Every phase row comes out of `outcome.log` and out of nothing else. Every
 * phase block that starts writes exactly one row — its gate's skip row, its cap
 * script's row or the review exit's row (one-shot review §4.1) — so the summary
 * assigns the rows positionally: the `seed:` row, the `plan:` row, the first
 * `build:` row, the `review:` row and the second `build:` row, numbered 1 to 5
 * in ralph's `auto_report` format (one-shot review §5.1). A phase with no row
 * did not start.
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
 * all_done` and `always_run: true`, so it runs whatever the phases before it did.
 * `ARTIFACTS_DIR` says where the log and the marker are.
 *
 * The repositories row is the one figure that comes from outside the log:
 * `run-start.txt` holds the sha listing from the start of the run, and the diff
 * against `repoState()` at report time is what the run committed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRepoState, repoState } from "./lib/ralph.ts";
import { counts } from "./ralph-counts.ts";

/** The lifecycle summary, then one mode per phase workflow (§12.4). */
const MODES = ["auto", "plan", "build", "review"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

/**
 * The state of a phase that wrote no row. Every phase that starts writes one,
 * so an absent row means the run never reached it — ralph's own word for that
 * state.
 */
const NOT_REACHED = "not reached";

/** The state prefix of the skip row a phase gate appends. */
const SKIPPED = "skipped — ";

/** Where the run left its artifacts. The timestamp stays a placeholder, as in ralph. */
const ARTIFACTS_ROW =
  "Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; " +
  "previous cycle under .ralph/<timestamp>/";

/** The summary's phases in run order: `ralph-wiggum` builds before and after the review. */
const PHASES = ["seed", "plan", "build", "review", "build"] as const;

/**
 * Each phase's `outcome.log` row, aligned with `PHASES`, or `null` for a phase
 * that wrote none.
 *
 * A line fills the first empty slot whose label it carries, so the first
 * `build:` row is phase 3 and the second is phase 5. Lines that match no phase
 * prefix are dropped, which is what keeps a build abort readable:
 * `ralph-build-cap` appends `build: push rejected` followed by git's own
 * output, and those extra lines are evidence for `abort.txt`, not rows.
 */
export function parseOutcome(log: string): (string | null)[] {
  const rows: (string | null)[] = PHASES.map(() => null);
  for (const line of log.split("\n")) {
    const slot = PHASES.findIndex((label, i) => rows[i] === null && line.startsWith(`${label}: `));
    if (slot !== -1) rows[slot] = line;
  }
  return rows;
}

/** A block report's row. The state column sits at column 11, as ralph's `%-9s` puts it. */
function topRow(label: string, state: string): string {
  return `  ${label.padEnd(9)}${state}`;
}

/** A summary row in ralph's `  %d %-9s %s` format. */
function numberedRow(position: number, label: string, state: string): string {
  return `  ${position} ${label.padEnd(9)} ${state}`;
}

/**
 * The state column of one phase row. The `<phase>: ` prefix is sliced off the
 * line because the label already carries it.
 */
function phaseState(label: string, line: string | null, abort: string | null): string {
  if (line === null) return NOT_REACHED;
  // Both abort paths append their marker text to `outcome.log` as well as
  // writing `abort.txt`, so the phase that aborted is the one whose line is
  // that text. The first line is printed whole, prefix included: it is the
  // marker verbatim, and a row that disagrees with the marker is worth seeing.
  if (line === abort) return `failed — ${abort}`;
  const text = line.slice(label.length + 2);
  // The phase gate writes its own skip row (one-shot review §4.1), so it is not a run.
  if (text.startsWith(SKIPPED)) return text;
  return `ran — ${text}`;
}

/** The plan's three counts, through the same path the phase gates count with. */
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
  const started = new Map(parseRepoState(readArtifact(artifactsDir, "run-start.txt")));
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

/** The summary, one string per line. */
export function report(artifactsDir: string): string[] {
  const rows = parseOutcome(readArtifact(artifactsDir, "outcome.log"));
  const abort = firstLine(readArtifact(artifactsDir, "abort.txt"));

  const lines = ["Ralph lifecycle summary"];
  PHASES.forEach((label, i) => {
    lines.push(numberedRow(i + 1, label, phaseState(label, rows[i] ?? null, abort)));
  });
  lines.push("", planRow());
  // No line at all when nothing moved: a run that shipped nothing says so in
  // its phase rows already, and an empty list reads as a missing number.
  const moved = movedRepos(artifactsDir);
  if (moved.length > 0) lines.push(`Repositories that moved: ${moved.join(", ")}`);
  lines.push(ARTIFACTS_ROW);
  return lines;
}

/* ── The block reports (§12.4) ───────────────────────────────────── */

/**
 * The last `outcome.log` line of one phase, or `null` when the phase wrote none.
 *
 * Every block that starts writes exactly one row (one-shot review §4.1), so the
 * last row with the label is this block's own. Composed, a `fix` block stopped
 * by the abort check writes none and reads the first build's row; the summary
 * is the record there (one-shot review §5.2).
 */
export function lastRow(log: string, label: string): string | null {
  return log.split("\n").findLast((line) => line.startsWith(`${label}: `)) ?? null;
}

/**
 * One phase block's report: its last row, then the plan counts.
 *
 * The row goes through the same `topRow` and `phaseState` as the summary, so
 * the interim lines a composed run prints line up with the summary that
 * follows them. A block that wrote no row failed before its gate, so it is
 * `not reached`.
 */
function phaseReport(artifactsDir: string, label: string): string[] {
  const line = lastRow(readArtifact(artifactsDir, "outcome.log"), label);
  const abort = firstLine(readArtifact(artifactsDir, "abort.txt"));
  return [topRow(label, phaseState(label, line, abort)), "", planRow()];
}

/** The `plan` block's report. */
export function planReport(artifactsDir: string): string[] {
  return phaseReport(artifactsDir, "plan");
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
  const lines = phaseReport(artifactsDir, "build");
  const moved = movedRepos(artifactsDir);
  if (moved.length > 0) lines.push(`Repositories that moved: ${moved.join(", ")}`);
  return lines;
}

/** The `review` block's report. */
export function reviewReport(artifactsDir: string): string[] {
  return phaseReport(artifactsDir, "review");
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
