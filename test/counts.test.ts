/**
 * `ralph-counts`'s JSON contract and its missing-artifact exit (spec §9).
 *
 * The two `when:` guards of the cycle body are expressions over this node's
 * stdout, so every test here asserts the parsed object rather than the text:
 * a stray line or a renamed key skips both phases instead of failing the run.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { counts, main } from "../template/scripts/ralph-counts.ts";
import { withTempRepo } from "./helpers.ts";

const REAL_TEMPLATE = join(import.meta.dir, "../template/ralph/templates/IMPLEMENTATION_PLAN.md");

/**
 * A plan with an exemplar under `## Entry Format` and `items` below `## Items`.
 * The exemplar is a real `- [ ]` at column zero that no count may see.
 */
function writePlan(items: string[]): void {
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    [
      "# Implementation Plan",
      "",
      "## Entry Format",
      "",
      "- [ ] **Exemplar title**",
      "  Spec: `specs/file.md` item 1",
      "",
      "## Items",
      "",
      ...items,
      "",
    ].join("\n"),
  );
  writeFileSync("PROGRESS.md", "# Progress Log\n");
}

/** `main()` with stdout and stderr captured: the object printed, or `null`. */
function runMain(): { code: number; json: unknown; stderr: string } {
  const { log, error } = console;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    const code = main();
    // One line and nothing else is the contract, so assert the shape of stdout
    // here rather than in every caller.
    expect(out.length).toBeLessThanOrEqual(1);
    return { code, json: out[0] === undefined ? null : JSON.parse(out[0]), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("ralph-counts", () => {
  test("prints the three counts as one JSON object", async () => {
    await withTempRepo(async () => {
      writePlan([
        "- [ ] **Open one**",
        "- [ ] **Open two**",
        "- [x] **Shipped one**",
        "- [~] **Superseded one**",
        "- [~] **Superseded two**",
        "- [~] **Superseded three**",
      ]);

      expect(runMain()).toMatchObject({ code: 0, json: { open: 2, shipped: 1, superseded: 3 } });
    });
  });

  test("reports zero for every marker on a freshly scaffolded plan", async () => {
    await withTempRepo(async () => {
      writePlan([]);
      // The real checked-in template, not the fixture: its exemplar is the one
      // that ships, and an `open` of 1 here makes the build loop run on an
      // empty plan and the review phase never run at all.
      copyFileSync(REAL_TEMPLATE, "IMPLEMENTATION_PLAN.md");

      expect(runMain()).toMatchObject({ code: 0, json: { open: 0, shipped: 0, superseded: 0 } });
    });
  });

  test("ignores an indented marker and a marker inside prose", async () => {
    await withTempRepo(async () => {
      writePlan(["  - [ ] **Nested**", "See `- [x]` in the entry format.", "- [ ] **Real**"]);

      expect(counts()).toEqual({ open: 1, shipped: 0, superseded: 0 });
    });
  });

  test("exits 1 naming each missing artifact", async () => {
    await withTempRepo(async () => {
      writePlan(["- [ ] **Open one**"]);

      for (const file of ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"]) {
        writePlan(["- [ ] **Open one**"]);
        rmSync(file);

        const { code, json, stderr } = runMain();
        expect(code).toBe(1);
        // Nothing on stdout: a guard reading `{}` would skip its phase, which
        // is the failure this exit code exists to prevent.
        expect(json).toBeNull();
        expect(stderr).toContain(file);
      }
    });
  });

  test("exits 1 naming both artifacts when neither is present", async () => {
    await withTempRepo(async () => {
      const { code, stderr } = runMain();
      expect(code).toBe(1);
      expect(stderr).toContain("IMPLEMENTATION_PLAN.md, PROGRESS.md");
    });
  });
});
