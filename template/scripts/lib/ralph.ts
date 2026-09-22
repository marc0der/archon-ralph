/**
 * The one library every script under `template/scripts/` shares (spec §4.1).
 *
 * Node built-ins only: an installed `.archon/` has no runtime dependencies and
 * `bun install` inside it stays optional.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Ralph's three plan-item markers, as they appear at column zero. */
export type ItemMarker = "[ ]" | "[x]" | "[~]";

// `[ \t\r]*` for ralph's `[[:space:]]*`: a CRLF plan must still match, and in
// JS multiline mode `$` sits after the `\r`, not before it.
const ITEMS_HEADING = /^## Items[ \t\r]*$/m;

/**
 * The part of the plan that holds real items: the `## Items` heading to the end
 * of the file, or the whole file when that heading is absent.
 *
 * **Every count in every script goes through here.** `## Entry Format` carries
 * an exemplar entry at column zero, so counting markers over the whole file
 * reports a freshly scaffolded plan as having one open item — the bug that
 * stops the build loop ever exiting on an exhausted plan. Reading a headingless
 * plan whole keeps older plans counting. Mirrors ralph's `plan_items_body`.
 */
export function planItemsBody(file = "IMPLEMENTATION_PLAN.md"): string {
  const text = readFileSync(file, "utf8");
  const heading = ITEMS_HEADING.exec(text);
  return heading ? text.slice(heading.index) : text;
}

/** Count the items in `body` carrying `marker` at column zero. */
export function countItems(body: string, marker: ItemMarker): number {
  const prefix = `- ${marker}`;
  return body.split("\n").filter((line) => line.startsWith(prefix)).length;
}

/**
 * Review's anchor set: the distinct `specs/` paths the items in `body` cite,
 * in byte order. Mirrors ralph's `cited_specs`.
 *
 * `specs/` is a chronological record rather than a statement of current
 * requirements, so the set is derived from the plan: a pass that read the whole
 * corpus would file drift against correct code. `body` comes from
 * `planItemsBody` for the reason recorded there — the exemplar under
 * `## Entry Format` cites `specs/file.md`, so the whole-file form reports a
 * freshly scaffolded plan as citing one spec.
 *
 * The line is trimmed first: items are indented, and a CRLF plan carries a
 * trailing `\r` that would otherwise stick to the last token. `Spec:` must then
 * be a whole field and not a substring, so a `Steps` line naming a spec path,
 * or mentioning the `Spec:` field, contributes nothing. A path is a whole
 * non-space, non-backtick token, which keeps a nested repository's
 * `source/svc/specs/x.md` distinct from the root's `specs/x.md`.
 *
 * The three citation forms that name no specification — `AGENTS.md
 * verification gate`, a `Major` finding's `IMPLEMENTATION_PLAN.md` and a
 * `Minor` finding's rule file — are excluded by that token rule alone, with no
 * special case. No marker is filtered, a `[~]` item's citation included, as
 * ralph filters none.
 */
export function citedSpecs(body: string): string[] {
  const cited = new Set<string>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    // Whitespace alone separates the field, as awk's `$1` does; backticks cut
    // the tokens but never the field name.
    if (trimmed.split(/[ \t]+/)[0] !== "Spec:") continue;
    for (const token of trimmed.split(/[ \t`]+/)) {
      if (token.includes("specs/")) cited.add(token);
    }
  }
  return [...cited].sort(byteOrder);
}

/**
 * Ralph's build budget, `ceil(open × 1.2)`, in integer arithmetic.
 *
 * Bit-identical to ralph's `(count * 6 + 4) / 5`; the float form is avoided
 * because 1.2 is not representable in IEEE-754. An empty plan still gets one
 * iteration, so the loop no-ops once rather than dividing into a budget of 0.
 */
export function computeBudget(open: number): number {
  return open < 1 ? 1 : Math.floor((open * 6 + 4) / 5);
}

/**
 * `LC_ALL=C sort`: byte order, not locale order and not UTF-16 code-unit order.
 * Both fingerprints below are only ever compared to another string produced the
 * same way, so the order has to be stable across platforms rather than pretty.
 */
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** `stat` follows symlinks, as `find -L` does; a broken link stats to nothing. */
function follow(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/** `find -L specs -type f`, in byte order of the relative path. */
function specFiles(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // no specs/ at all, or an unreadable one: ralph's 2>/dev/null
  }
  for (const name of names) {
    // String concatenation, not `join`: these paths must read exactly as `find`
    // emits them, on every platform.
    const path = `${dir}/${name}`;
    const stats = follow(path);
    if (stats?.isDirectory()) specFiles(path, out);
    else if (stats?.isFile()) out.push(path);
  }
}

/**
 * Fingerprint the artifacts a plan or review iteration is allowed to change:
 * md5 over `IMPLEMENTATION_PLAN.md`, then every regular file under `specs/`,
 * path before contents. Mirrors ralph's `plan_state_hash`.
 *
 * Those phases never commit — the plan is gitignored — so `HEAD` cannot detect
 * their progress. A pass that leaves this hash unchanged has converged. Names
 * are hashed as well as contents so that adding or removing a spec counts as a
 * change; an unreadable spec contributes its path alone rather than aborting.
 */
export function planStateHash(): string {
  const md5 = createHash("md5");
  try {
    md5.update(readFileSync("IMPLEMENTATION_PLAN.md"));
  } catch {
    // An absent plan contributes nothing, exactly as ralph's `[[ -f ]]` guard.
  }
  const specs: string[] = [];
  specFiles("specs", specs);
  for (const spec of specs.sort(byteOrder)) {
    md5.update(`${spec}\n`); // ralph's `echo "$spec"`
    try {
      md5.update(readFileSync(spec));
    } catch {
      // `cat -- "$spec" || true`: the path is still in the fingerprint.
    }
  }
  return md5.digest("hex");
}

/** How far below the checkout root `repoState` looks for a `.git`. */
const REPO_SCAN_DEPTH = 6;

/** `find -L . -maxdepth 6 -name .git -prune -print`, minus the `/.git` suffix. */
function gitRepos(dir: string, depth: number, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === ".git") {
      // `-prune` stops at the `.git` entry and not at its parent, so a
      // repository nested inside a watched one is watched too.
      out.push(dir);
      continue;
    }
    if (depth >= REPO_SCAN_DEPTH) continue;
    const path = `${dir}/${name}`;
    if (follow(path)?.isDirectory()) gitRepos(path, depth + 1, out);
  }
}

function headSha(repo: string): string {
  try {
    const sha = execFileSync("git", ["-C", repo, "rev-parse", "-q", "--verify", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || "-";
  } catch {
    return "-";
  }
}

/**
 * One `<path> <sha>` line per repository at most six levels below the checkout
 * root, sorted in byte order, `-` where `HEAD` does not resolve. Mirrors
 * ralph's `repo_state`.
 *
 * A build iteration can commit into a nested repository without moving the
 * workspace `HEAD`, so the build loop compares these listings instead of one
 * `HEAD`. Any difference is progress — including a repository that appeared or
 * vanished, and excluding a dirty worktree. That over-detection bias is
 * deliberate: it delays the noop exit by an iteration, where under-detection
 * truncates a run that was still shipping (`specs/nested-git-repos.md` §3).
 *
 * `rev-parse -q --verify` is the required form. Plain `rev-parse HEAD` prints
 * the literal `HEAD` on stdout in a commitless repository, so a fallback would
 * append to that output instead of replacing it.
 */
export function repoState(): string {
  const repos: string[] = [];
  gitRepos(".", 1, repos);
  return repos
    .map((repo) => `${repo} ${headSha(repo)}`)
    .sort(byteOrder)
    .map((line) => `${line}\n`)
    .join("");
}

/* ── Run state: the files the cap scripts carry between iterations ────────── */

/** `settings.json`: the workflow inputs, as `ralph-seed` records them (§4.2). */
export interface Settings {
  skip_push: boolean;
  cycle_cap: number;
}

const SETTINGS_DEFAULTS: Settings = { skip_push: false, cycle_cap: 3 };

/**
 * The workflow inputs, read back from `<artifactsDir>/settings.json`.
 *
 * `until_bash` scripts run in Archon's loop executor and never see `INPUTS_*`
 * (§4.2 step 5), so this file is the only way `skip_push` and `cycle_cap` reach
 * `ralph-build-cap` and `ralph-cycle-cap`. Each field falls back on its own: a
 * settings file that survived a partial write must still yield a usable cap
 * rather than `NaN`, which would make `cycles >= cycle_cap` false forever and
 * run the fixpoint to `max_iterations`.
 */
export function readSettings(artifactsDir: string): Settings {
  try {
    const parsed = JSON.parse(readFileSync(join(artifactsDir, "settings.json"), "utf8"));
    return {
      skip_push:
        typeof parsed.skip_push === "boolean" ? parsed.skip_push : SETTINGS_DEFAULTS.skip_push,
      cycle_cap:
        Number.isInteger(parsed.cycle_cap) && parsed.cycle_cap >= 1
          ? parsed.cycle_cap
          : SETTINGS_DEFAULTS.cycle_cap,
    };
  } catch {
    // Missing file, unreadable file, or not JSON at all: ralph's `|| echo`.
    return { ...SETTINGS_DEFAULTS };
  }
}

/**
 * An iteration counter, or `fallback` when the file is missing, empty or holds
 * anything but an integer. Mirrors ralph's `cat … 2>/dev/null || echo 0`.
 *
 * `Number`, not `parseInt`: `parseInt('3 passes')` is 3, so a half-written file
 * would read as a plausible count instead of falling back. The empty-string
 * guard is load-bearing for the same reason in the other direction — `Number('')`
 * is 0, which would silently override a non-zero fallback such as the budget's.
 */
export function readCounter(file: string, fallback: number): number {
  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch {
    return fallback;
  }
  const parsed = Number(text);
  return text !== "" && Number.isInteger(parsed) ? parsed : fallback;
}

/** Write a counter back, newline-terminated so `cat` and `readCounter` agree. */
export function writeCounter(file: string, n: number): void {
  writeFileSync(file, `${n}\n`);
}

/**
 * Append one line to `<artifactsDir>/outcome.log`.
 *
 * Every phase writes its row here and `ralph-report` reads its rows from this
 * file alone (§4.2): `ralph-snapshot` zeroes the counters at the start of each
 * cycle, so a figure that is not in this log is gone by report time.
 */
export function appendOutcome(artifactsDir: string, line: string): void {
  appendFileSync(join(artifactsDir, "outcome.log"), `${line}\n`);
}
