/**
 * `ralph-counts`'s JSON contract, its skip rows and its failure exits
 * (one-shot review §4.1, §9).
 *
 * Each block's `when:` reads `run` from this node's stdout, so every test here
 * asserts the parsed object rather than the text: a stray line or a renamed key
 * skips the phase instead of failing the run.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CYCLE_BASE } from "../template/scripts/lib/ralph.ts";
import { counts, main } from "../template/scripts/ralph-counts.ts";
import { withTempRepo } from "./helpers.ts";

const REAL_TEMPLATE = join(import.meta.dir, "../template/ralph/templates/IMPLEMENTATION_PLAN.md");

/**
 * The citation every seeded item carries (spec-anchored-review §7).
 *
 * A fixture standing in for a plan satisfies the contract the plan now
 * carries, so a later test that starts reading citations finds them here
 * already. Indented by two spaces, so no marker count moves.
 */
const CITATION = "  Spec: `specs/mock.md` §1";

/**
 * A plan with an exemplar under `## Entry Format` and `items` below `## Items`.
 * The exemplar is a real `- [ ]` at column zero that no count may see. Each
 * item below `## Items` gets a `CITATION` line of its own.
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
      ...items.flatMap((item) => [item, CITATION]),
      "",
    ].join("\n"),
  );
  writeFileSync("PROGRESS.md", "# Progress Log\n");
}

/** `main()` with stdout and stderr captured: the object printed, or `null`. */
function runMain(env: Record<string, string | undefined>): {
  code: number;
  json: unknown;
  stderr: string;
} {
  const { log, error } = console;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    const code = main(env);
    // One line and nothing else is the contract, so assert the shape of stdout
    // here rather than in every caller.
    expect(out.length).toBeLessThanOrEqual(1);
    return { code, json: out[0] === undefined ? null : JSON.parse(out[0]), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function writeBase(): void {
  mkdirSync(".ralph", { recursive: true });
  writeFileSync(CYCLE_BASE, ". -\n");
}

/** The rows this node appended, or `[]` when it wrote no `outcome.log`. */
function outcomeRows(artifactsDir: string): string[] {
  const log = join(artifactsDir, "outcome.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
}

describe("ralph-counts", () => {
  test("prints the counts, base and run as one JSON object", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan([
        "- [ ] **Open one**",
        "- [ ] **Open two**",
        "- [x] **Shipped one**",
        "- [~] **Superseded one**",
        "- [~] **Superseded two**",
        "- [~] **Superseded three**",
      ]);

      expect(runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "build" })).toEqual({
        code: 0,
        json: { open: 2, shipped: 1, superseded: 3, base: false, run: true },
        stderr: "",
      });
    });
  });

  test("reports zero for every marker on a freshly scaffolded plan", async () => {
    await withTempRepo(() => {
      writePlan([]);
      // The real checked-in template, not the fixture: its exemplar is the one
      // that ships, and an `open` of 1 here makes the build loop run on an
      // empty plan and the review phase never run at all.
      copyFileSync(REAL_TEMPLATE, "IMPLEMENTATION_PLAN.md");

      expect(counts()).toEqual({ open: 0, shipped: 0, superseded: 0, base: false });
    });
  });

  test("ignores an indented marker and a marker inside prose", async () => {
    await withTempRepo(() => {
      writePlan(["  - [ ] **Nested**", "See `- [x]` in the entry format.", "- [ ] **Real**"]);

      expect(counts()).toEqual({ open: 1, shipped: 0, superseded: 0, base: false });
    });
  });

  test("base is whether .ralph/cycle-base exists", async () => {
    await withTempRepo(() => {
      writePlan(["- [x] **Shipped one**"]);
      expect(counts().base).toBe(false);

      writeBase();
      expect(counts().base).toBe(true);
    });
  });

  test("build runs on open items and writes no row", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [ ] **Open one**", "- [x] **Shipped one**"]);

      expect(runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "build" })).toMatchObject({
        code: 0,
        json: { run: true },
      });
      expect(outcomeRows(artifactsDir)).toEqual([]);
    });
  });

  test("build skips with no open items and writes its skip row", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [x] **Shipped one**"]);
      writeBase();

      expect(runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "build" })).toMatchObject({
        code: 0,
        json: { open: 0, run: false },
      });
      expect(outcomeRows(artifactsDir)).toEqual(["build: skipped — no open items"]);
    });
  });

  test("review runs on a finished plan with a cycle base and writes no row", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [x] **Shipped one**", "- [~] **Superseded one**"]);
      writeBase();

      expect(runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "review" })).toEqual({
        code: 0,
        json: { open: 0, shipped: 1, superseded: 1, base: true, run: true },
        stderr: "",
      });
      expect(outcomeRows(artifactsDir)).toEqual([]);
    });
  });

  test("review writes the first failing row of the table", async () => {
    // No case writes a base, so the base check fails in all three and the
    // earlier checks must win where they fail too.
    const cases: { items: string[]; row: string }[] = [
      { items: ["- [ ] **Open one**"], row: "review: skipped — no shipped items" },
      {
        items: ["- [ ] **Open one**", "- [ ] **Open two**", "- [x] **Shipped one**"],
        row: "review: skipped — 2 open items remain",
      },
      { items: ["- [x] **Shipped one**"], row: "review: skipped — no cycle base" },
    ];

    for (const { items, row } of cases) {
      await withTempRepo(({ artifactsDir }) => {
        writePlan(items);

        expect(runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "review" })).toMatchObject({
          code: 0,
          json: { run: false },
        });
        expect(outcomeRows(artifactsDir)).toEqual([row]);
      });
    }
  });

  test("an open item skips review even with a cycle base", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [ ] **Open one**", "- [x] **Shipped one**"]);
      writeBase();

      expect(runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "review" })).toMatchObject({
        json: { base: true, run: false },
      });
      expect(outcomeRows(artifactsDir)).toEqual(["review: skipped — 1 open items remain"]);
    });
  });

  test("exits 1 on an absent or unrecognised mode", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [ ] **Open one**"]);

      for (const mode of [undefined, "", "plan", "Build"]) {
        const { code, json, stderr } = runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: mode });
        expect(code).toBe(1);
        expect(json).toBeNull();
        expect(stderr).toContain("INPUTS_MODE must be build, review");
      }
      expect(outcomeRows(artifactsDir)).toEqual([]);
    });
  });

  test("exits 1 when ARTIFACTS_DIR is unset or empty", async () => {
    await withTempRepo(() => {
      writePlan([]);

      for (const dir of [undefined, ""]) {
        const { code, json, stderr } = runMain({ ARTIFACTS_DIR: dir, INPUTS_MODE: "build" });
        expect(code).toBe(1);
        expect(json).toBeNull();
        expect(stderr).toContain("ARTIFACTS_DIR is not set");
      }
    });
  });

  test("reads ARTIFACTS_DIR and INPUTS_MODE from process.env by default", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [x] **Shipped one**"]);
      const previous = process.env.INPUTS_MODE;
      process.env.INPUTS_MODE = "build";
      try {
        const { log } = console;
        console.log = () => {};
        try {
          expect(main()).toBe(0);
        } finally {
          console.log = log;
        }
      } finally {
        if (previous === undefined) delete process.env.INPUTS_MODE;
        else process.env.INPUTS_MODE = previous;
      }
      expect(outcomeRows(artifactsDir)).toEqual(["build: skipped — no open items"]);
    });
  });

  test("exits 1 naming each missing artifact", async () => {
    await withTempRepo(({ artifactsDir }) => {
      for (const file of ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"]) {
        writePlan(["- [ ] **Open one**"]);
        rmSync(file);

        const { code, json, stderr } = runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "build" });
        expect(code).toBe(1);
        // Nothing on stdout: a guard reading `{}` would skip its phase, which
        // is the failure this exit code exists to prevent.
        expect(json).toBeNull();
        expect(stderr).toContain(file);
      }
      expect(outcomeRows(artifactsDir)).toEqual([]);
    });
  });

  test("exits 1 naming both artifacts when neither is present", async () => {
    await withTempRepo(({ artifactsDir }) => {
      const { code, stderr } = runMain({ ARTIFACTS_DIR: artifactsDir, INPUTS_MODE: "review" });
      expect(code).toBe(1);
      expect(stderr).toContain("IMPLEMENTATION_PLAN.md, PROGRESS.md");
    });
  });
});
