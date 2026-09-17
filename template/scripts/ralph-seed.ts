#!/usr/bin/env bun
/**
 * Ralph SEED node — archive the previous cycle, then scaffold this one (§4.2).
 *
 * This is ralph's `archive` and `init` phases in one node, in that order. The
 * order is the whole point: a run that lives in the checkout ends with its own
 * `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` in the tree, so the next run has
 * to move them aside before it can scaffold a clean pair. Archiving last would
 * file away the plan the run just finished building against.
 *
 * Archon invokes this by name (`script: ralph-seed`) with the checkout root as
 * the working directory, so every path here is relative to it and `root` in the
 * printed object is `process.cwd()`.
 *
 * Stdout carries **one JSON object and nothing else** — `archived: null` is how
 * ralph's `Nothing to archive.` reaches the operator. Failures go to stderr.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const TEMPLATE_DIR = ".archon/ralph/templates";
const ARCHIVE_DIR = ".ralph";
const GITIGNORE = ".gitignore";

/** The two loop artifacts, archived and scaffolded as a pair. */
const ARTIFACTS = ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"] as const;

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
 * that directory, or `null` when there was nothing to archive.
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
 * The copy is unconditional because `archive` has just moved both artifacts
 * away. A missing template is misconfiguration — the tree is checked in — and
 * ralph's warn-and-continue would leave the build agent planning against a
 * file the plan prompt never wrote.
 */
export function scaffold(): string | undefined {
  for (const name of ARTIFACTS) {
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

export function main(): number {
  const archived = archive();
  const missing = scaffold();
  if (missing !== undefined) {
    console.error(`ralph-seed: template missing at ${missing}; refusing to scaffold a fallback`);
    return 1;
  }
  mkdirSync("specs", { recursive: true });
  ignoreArtifacts();
  console.log(JSON.stringify({ root: process.cwd(), archived, branch: currentBranch() }));
  return 0;
}

if (import.meta.main) process.exit(main());
