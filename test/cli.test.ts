/**
 * `bin/cli.ts init`'s copy, skip and overwrite behaviour (spec §9).
 *
 * The installer is the only code in this package that users run directly, and
 * it is the one thing no other test covers: every other suite imports from
 * `template/scripts/` and never asks how that tree reached a project. The
 * cases here are the upgrade path — a first install, a re-run that must not
 * clobber local edits, and `--force` when the operator wants ralph's text back.
 *
 * `bin/cli.ts` runs its work at module scope, so it cannot be imported the way
 * the control scripts can. These tests spawn it, which also pins the exit code
 * and the stdout an operator actually reads.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.ts";

const CLI = join(import.meta.dir, "../bin/cli.ts");
const TEMPLATE_DIR = join(import.meta.dir, "../template");

/** Every file under `template/`, relative to it — the set `init` must install. */
const TEMPLATE_FILES = readdirSync(TEMPLATE_DIR, { recursive: true })
  .map(String)
  .filter((rel) => statSync(join(TEMPLATE_DIR, rel)).isFile())
  .sort();

function init(dir: string, ...args: string[]): { code: number; stdout: string } {
  const { status, stdout, stderr } = spawnSync("bun", [CLI, "init", "--dir", dir, ...args], {
    encoding: "utf8",
  });
  // A non-zero exit leaves a half-installed `.archon/`, so surface the CLI's own
  // words rather than failing later on a missing file.
  expect(stderr).toBe("");
  return { code: status ?? 1, stdout };
}

/** The installed copy of `rel`, or the reason it is unreadable. */
function installed(root: string, rel: string): string {
  return readFileSync(join(root, ".archon", rel), "utf8");
}

describe("archon-ralph init", () => {
  test("installs every template file into .archon/", async () => {
    await withTempRepo(async ({ root }) => {
      const { code, stdout } = init(root);

      expect(code).toBe(0);
      // Compare contents, not just existence: `cpSync` of a directory would
      // also satisfy `existsSync` while installing the wrong bytes.
      const wrong = TEMPLATE_FILES.filter(
        (rel) => installed(root, rel) !== readFileSync(join(TEMPLATE_DIR, rel), "utf8"),
      );
      expect(wrong).toEqual([]);
      expect(TEMPLATE_FILES.length).toBeGreaterThan(0);
      expect(stdout).toContain(`${TEMPLATE_FILES.length} file(s) written, 0 skipped`);
      // §7: the positional goal form. Archon dropped `-g`, and an operator who
      // pastes this line is the one who finds out.
      expect(stdout).toContain('archon workflow run ralph-wiggum "<goal>"');
    });
  });

  test("skips every existing file on a second run and names --force", async () => {
    await withTempRepo(async ({ root }) => {
      init(root);
      const edited = join(root, ".archon", "ralph", "templates", "IMPLEMENTATION_PLAN.md");
      writeFileSync(edited, "# Local edit\n");

      const { code, stdout } = init(root);

      expect(code).toBe(0);
      expect(stdout).toContain(`0 file(s) written, ${TEMPLATE_FILES.length} skipped`);
      // The local edit survives. Skip-by-default is what makes `init` safe to
      // re-run on a project whose plan template has been tuned.
      expect(readFileSync(edited, "utf8")).toBe("# Local edit\n");
      expect(stdout).toContain(
        "Skipped files are not updated. Re-run with --force to bring .archon/ up to date;" +
          " --force also overwrites ralph/templates/.",
      );
    });
  });

  test("rewrites every file under --force", async () => {
    await withTempRepo(async ({ root }) => {
      init(root);
      for (const rel of TEMPLATE_FILES) writeFileSync(join(root, ".archon", rel), "stale\n");

      const { code, stdout } = init(root, "--force");

      expect(code).toBe(0);
      expect(stdout).toContain(`${TEMPLATE_FILES.length} file(s) written, 0 skipped`);
      const stale = TEMPLATE_FILES.filter((rel) => installed(root, rel) === "stale\n");
      expect(stale).toEqual([]);
      // Named explicitly because §7 promises `--force` reaches the artifact
      // templates too, and that is the one directory users hand-edit.
      expect(installed(root, "ralph/templates/IMPLEMENTATION_PLAN.md")).toContain("## Items");
    });
  });
});
