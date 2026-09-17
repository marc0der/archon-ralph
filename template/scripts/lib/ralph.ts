/**
 * The one library every script under `template/scripts/` shares (spec §4.1).
 *
 * Node built-ins only: an installed `.archon/` has no runtime dependencies and
 * `bun install` inside it stays optional.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";

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
