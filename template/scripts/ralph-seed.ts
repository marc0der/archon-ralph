#!/usr/bin/env bun
/**
 * Ralph SEED node — open the run's plan artifacts and its run state (§4.2).
 *
 * One script, two modes, read from `INPUTS_MODE` (`with: {mode: …}` in the
 * workflow).
 *
 * `archive` is `ralph-wiggum`'s `seed`, and ralph's `archive` and `init` phases
 * in one node, in that order. The order is the whole point: a run that lives in
 * the checkout ends with its own `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` in
 * the tree, so the next run has to move them aside before it can scaffold a
 * clean pair. Archiving last would file away the plan the run just finished
 * building against.
 *
 * `init` is `ralph init` and nothing more, and it is what every phase workflow
 * runs: scaffold each artifact **only when absent**, never archive, write
 * `run-start.txt` only when absent, merge the inputs into `settings.json`
 * rather than overwrite it, and append no `outcome.log` row. Composed into
 * `ralph-wiggum` it finds everything `seed` left in place and does nothing;
 * standalone it is what lets `ralph-plan` run on a fresh checkout and
 * `ralph-build` run on the plan already in the tree (§12.4).
 *
 * Archon invokes this by name (`script: ralph-seed`) with the checkout root as
 * the working directory, so every path here is relative to it and `root` in the
 * printed object is `process.cwd()`.
 *
 * Stdout carries **one JSON object and nothing else** — `archived: null` is how
 * ralph's `Nothing to archive.` reaches the operator. Failures go to stderr.
 *
 * The node also opens the run's state in `ARTIFACTS_DIR`: `settings.json` (the
 * only route the workflow inputs have to the `until_bash` cap scripts, which
 * see no `INPUTS_*`), `run-start.txt` (the sha listing the report diffs against
 * at the end) and the first row of `outcome.log`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { appendOutcome, repoState, type Settings } from "./lib/ralph.ts";

const TEMPLATE_DIR = ".archon/ralph/templates";
const ARCHIVE_DIR = ".ralph";
const GITIGNORE = ".gitignore";

/** The two loop artifacts, archived and scaffolded as a pair. */
const ARTIFACTS = ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"] as const;

/** The two ways to open a run: `ralph-wiggum`'s cycle, and `ralph init`. */
const MODES = ["archive", "init"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

/**
 * The lines `ralph init` adds. Ralph also ignores its three `PROMPT_*.md`
 * files; this workflow reads its prompts from `.archon/commands/` and writes
 * none, so they would be dead entries here.
 */
const IGNORE_ENTRIES = ["IMPLEMENTATION_PLAN.md", "PROGRESS.md", `${ARCHIVE_DIR}/`] as const;

/** `date +%Y%m%d-%H%M%S`, in local time as ralph's `date` is. */
function timestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Move every artifact present at the root into `.ralph/<timestamp>/`. Returns
 * that directory, or `null` when neither artifact was present.
 *
 * The directory is created lazily: an empty `.ralph/<timestamp>/` would read as
 * a cycle that shipped nothing, and `ralph-report` lists the archive.
 */
export function archive(): string | null {
  const present = ARTIFACTS.filter((name) => existsSync(name));
  if (present.length === 0) return null;
  const dest = `${ARCHIVE_DIR}/${timestamp()}`;
  mkdirSync(dest, { recursive: true });
  for (const name of present) renameSync(name, join(dest, name));
  return dest;
}

/**
 * Copy both artifacts out of the template directory. Returns the path of the
 * first missing template, so `main` can name it and fail the run.
 *
 * `whenAbsent` is the difference between the two modes. In `archive` mode the
 * copy is unconditional, because `archive` has just moved both artifacts away.
 * In `init` mode an artifact already in the tree is the plan the phase is about
 * to work on, and overwriting it with the template is the one thing `init` must
 * never do; a template missing for an artifact that is present is then not
 * consulted at all.
 *
 * An unread template is still misconfiguration — the tree is checked in — and
 * ralph's warn-and-continue would leave the build agent planning against a file
 * the plan prompt never wrote.
 */
export function scaffold(whenAbsent = false): string | undefined {
  for (const name of ARTIFACTS) {
    if (whenAbsent && existsSync(name)) continue;
    const template = join(TEMPLATE_DIR, name);
    if (!existsSync(template)) return template;
    copyFileSync(template, name);
  }
  return undefined;
}

/**
 * Append each of `IGNORE_ENTRIES` to `.gitignore` as a whole line, once.
 *
 * `lines.includes(entry)` is ralph's `grep -qxF`: a whole-line exact match, so
 * `.ralph/` already ignored under a different spelling is added again rather
 * than guessed at. The trailing newline is normalised first, unconditionally,
 * or an appended entry would graft itself onto the last line of a hand-edited
 * file.
 */
export function ignoreArtifacts(): void {
  let text = existsSync(GITIGNORE) ? readFileSync(GITIGNORE, "utf8") : "";
  if (text !== "" && !text.endsWith("\n")) text += "\n";
  const lines = text.split("\n");
  for (const entry of IGNORE_ENTRIES) if (!lines.includes(entry)) text += `${entry}\n`;
  writeFileSync(GITIGNORE, text);
}

/**
 * The workflow inputs, as Archon hands them to an exec node: every `INPUTS_*`
 * value is a string, so `false` arrives as `"false"` and a cap of 3 as `"3"`.
 *
 * Validation mirrors `readSettings`, which reads this file back: `cycle_cap`
 * must be an integer of at least 1, because a `NaN` or `0` cap makes
 * `cycles >= cycle_cap` decide the fixpoint by accident rather than by input.
 */
export function settingsFromInputs(env = process.env): Settings {
  const cap = Number(env.INPUTS_CYCLE_CAP);
  return {
    skip_push: env.INPUTS_SKIP_PUSH === "true",
    cycle_cap: Number.isInteger(cap) && cap >= 1 ? cap : 3,
  };
}

/**
 * Overlay the inputs this node was actually given onto `settings.json`, leaving
 * every other key as it was found.
 *
 * `init` merges where `archive` overwrites (§12.4): inside `ralph-wiggum` the
 * file already holds the `cycle_cap` `seed` wrote, and the build block's `init`
 * adds `skip_push` to it. `settingsFromInputs` would instead substitute its own
 * default for whichever input that node does not declare, and a `cycle_cap`
 * silently reset to 3 changes when the fixpoint stops.
 *
 * An input that is absent, blank or unusable is treated as not given rather
 * than as a default, so it cannot displace a good value already in the file.
 * Writing a file that holds one key alone is safe: `readSettings` falls back
 * per field.
 */
export function mergeSettings(artifactsDir: string, env = process.env): void {
  const file = join(artifactsDir, "settings.json");
  let merged: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      merged = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing, unreadable, or not JSON at all: start from the named inputs.
  }

  if (env.INPUTS_SKIP_PUSH !== undefined && env.INPUTS_SKIP_PUSH !== "") {
    merged.skip_push = env.INPUTS_SKIP_PUSH === "true";
  }
  const cap = Number(env.INPUTS_CYCLE_CAP);
  if (Number.isInteger(cap) && cap >= 1) merged.cycle_cap = cap;

  writeFileSync(file, `${JSON.stringify(merged)}\n`);
}

/**
 * Open the run's state: the inputs the cap scripts read back, and the sha
 * listing `ralph-report` diffs against to name the repositories that moved.
 *
 * `run-start.txt` is written after `scaffold`, so a repository the templates
 * happen to carry is in the baseline rather than reported as having appeared.
 *
 * In `init` mode both writes defer to what is already there. The baseline is
 * recorded only when absent, because a block's `init` can run cycles after
 * `seed` recorded the real start of the run, and re-recording it would hide
 * every repository that moved in between. The `outcome.log` row is `seed`'s
 * alone: an `init` row per block would put several of them in a log the report
 * reads as one row per phase.
 */
export function recordRunState(
  artifactsDir: string,
  archived: string | null,
  mode: Mode = "archive",
  env = process.env,
): void {
  const settings = join(artifactsDir, "settings.json");
  if (mode === "init") mergeSettings(artifactsDir, env);
  else writeFileSync(settings, `${JSON.stringify(settingsFromInputs(env))}\n`);

  const runStart = join(artifactsDir, "run-start.txt");
  if (mode === "archive" || !existsSync(runStart)) writeFileSync(runStart, repoState());

  if (mode === "init") return;
  // The trailing `/` matches the report's row: every archive is a directory.
  appendOutcome(
    artifactsDir,
    archived === null ? "seed: nothing to archive" : `seed: archived previous cycle to ${archived}/`,
  );
}

/** The branch the build loop will push. `ralph-precondition` has ruled out a detached HEAD. */
function currentBranch(): string {
  try {
    const out = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? out : "(no branch)";
  } catch {
    return "(no branch)";
  }
}

export function main(env = process.env): number {
  const artifactsDir = env.ARTIFACTS_DIR;
  // Checked before `archive` moves anything: a run that cannot record its own
  // state should fail with the previous cycle still in the tree.
  if (artifactsDir === undefined || artifactsDir === "") {
    console.error("ralph-seed: ARTIFACTS_DIR is not set");
    return 1;
  }

  // An absent mode is `archive`, today's behaviour, so this script lands before
  // the composition commit that declares `with: {mode: …}` everywhere and
  // `ralph-wiggum.yaml` keeps working in between (§12.7). An *unrecognised*
  // mode fails, as `ralph-snapshot` fails it: a typo on the build block's node
  // must not default to `archive` and file away the plan it was about to build.
  const declared = env.INPUTS_MODE;
  const mode = declared === undefined || declared === "" ? "archive" : declared;
  if (!isMode(mode)) {
    console.error(
      `ralph-seed: INPUTS_MODE must be ${MODES.join(", ")}; got ${JSON.stringify(declared)}`,
    );
    return 1;
  }

  const archived = mode === "archive" ? archive() : null;
  const missing = scaffold(mode === "init");
  if (missing !== undefined) {
    console.error(`ralph-seed: template missing at ${missing}; refusing to scaffold a fallback`);
    return 1;
  }
  mkdirSync("specs", { recursive: true });
  ignoreArtifacts();
  recordRunState(artifactsDir, archived, mode, env);
  console.log(JSON.stringify({ root: process.cwd(), archived, branch: currentBranch() }));
  return 0;
}

if (import.meta.main) process.exit(main());
