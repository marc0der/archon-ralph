/**
 * `ralph-snapshot`'s three modes (spec §9).
 *
 * This node writes the only state a cap script has to compare against, so a
 * file it fails to write does not fail the run — it makes the loop that follows
 * compare against a stale file, or against the previous cycle's counters, and
 * exit on its first iteration. Every test here asserts both what was written
 * and what was left alone.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMode, main, snapshot } from "../template/scripts/ralph-snapshot.ts";
import { planStateHash, readCounter, repoState, writeCounter } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

const REAL_TEMPLATE = join(import.meta.dir, "../template/ralph/templates/IMPLEMENTATION_PLAN.md");

/**
 * A plan with an exemplar under `## Entry Format` and the given items below
 * `## Items`. The exemplar is what makes the two headings matter: it is a real
 * `- [ ]` at column zero that no count may see.
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
}

function open(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `- [ ] **Open ${i + 1}**`);
}

function shipped(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `- [x] **Shipped ${i + 1}**`);
}

/** `main()` with its verdict lines captured: one per file written. */
function runMain(env: NodeJS.ProcessEnv): number {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return main(env);
  } finally {
    console.log = log;
    console.error = error;
  }
}

function modeEnv(mode: string): NodeJS.ProcessEnv {
  return { ...process.env, INPUTS_MODE: mode };
}

function counter(artifactsDir: string, name: string): number {
  // -1 as the fallback: an absent or unparsable counter must not read back as a
  // plausible 0 in a test that is asserting a reset.
  return readCounter(join(artifactsDir, name), -1);
}

describe("isMode", () => {
  test("accepts the three phases and nothing else", () => {
    for (const mode of ["plan", "build", "review"]) expect(isMode(mode)).toBe(true);
    for (const value of ["", "Plan", "PLAN", "seed", "report", "plan ", undefined]) {
      expect(isMode(value)).toBe(false);
    }
  });
});

describe("ralph-snapshot plan mode", () => {
  test("writes plan-hash.txt and zeroes plan-iter.txt, and nothing else", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(open(3));

      expect(snapshot(artifactsDir, "plan")).toEqual(["plan-hash.txt", "plan-iter.txt"]);
      expect(readFileSync(join(artifactsDir, "plan-hash.txt"), "utf8")).toBe(`${planStateHash()}\n`);
      expect(counter(artifactsDir, "plan-iter.txt")).toBe(0);
      for (const name of ["shipped-before.txt", "repo-state.txt", "build-budget.txt"]) {
        expect(existsSync(join(artifactsDir, name))).toBe(false);
      }
    });
  });

  test("records the hash of the specs as well as the plan", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(open(1));
      mkdirSync("specs", { recursive: true });
      writeFileSync("specs/one.md", "first\n");
      expect(runMain(modeEnv("plan"))).toBe(0);
      const before = readFileSync(join(artifactsDir, "plan-hash.txt"), "utf8");

      // A plan pass that only edits a spec has still made progress, so the
      // snapshot it is compared against has to cover `specs/`.
      writeFileSync("specs/one.md", "second\n");
      expect(runMain(modeEnv("plan"))).toBe(0);

      expect(readFileSync(join(artifactsDir, "plan-hash.txt"), "utf8")).not.toBe(before);
    });
  });

  test("resets a plan-iter.txt left over from an earlier phase", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(open(2));
      writeCounter(join(artifactsDir, "plan-iter.txt"), 5);

      expect(runMain(modeEnv("plan"))).toBe(0);

      // Without the reset the cap script's first pass would read 6 and complete
      // the loop on `n >= 6` before the planner had run once.
      expect(counter(artifactsDir, "plan-iter.txt")).toBe(0);
    });
  });
});

describe("ralph-snapshot review mode", () => {
  test("writes plan-hash.txt, shipped-before.txt and a zeroed review-iter.txt", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan([...shipped(4), ...open(0)]);

      expect(snapshot(artifactsDir, "review")).toEqual([
        "plan-hash.txt",
        "shipped-before.txt",
        "review-iter.txt",
      ]);
      expect(readFileSync(join(artifactsDir, "plan-hash.txt"), "utf8")).toBe(`${planStateHash()}\n`);
      expect(counter(artifactsDir, "shipped-before.txt")).toBe(4);
      expect(counter(artifactsDir, "review-iter.txt")).toBe(0);
      // The review loop compares repository state nowhere: it never commits.
      expect(existsSync(join(artifactsDir, "repo-state.txt"))).toBe(false);
    });
  });

  test("counts the shipped items through planItemsBody", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan([...shipped(2), "  - [x] **Indented, not an item**", ...open(1), "- [~] **Blocked**"]);

      expect(runMain(modeEnv("review"))).toBe(0);

      // 2, not 3: an indented marker is prose about an item, not an item.
      expect(counter(artifactsDir, "shipped-before.txt")).toBe(2);
    });
  });

  test("records 0 shipped for a freshly scaffolded plan", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      copyFileSync(REAL_TEMPLATE, "IMPLEMENTATION_PLAN.md");

      expect(runMain(modeEnv("review"))).toBe(0);

      // The real template's only marker is the exemplar under `## Entry
      // Format`. Counted, it would let a review that un-ticks it look clean.
      expect(counter(artifactsDir, "shipped-before.txt")).toBe(0);
    });
  });
});

describe("ralph-snapshot build mode", () => {
  test("writes repo-state.txt, the budget and both zeroed counters", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(open(5));

      expect(snapshot(artifactsDir, "build")).toEqual([
        "repo-state.txt",
        "build-budget.txt",
        "build-iter.txt",
        "build-noops.txt",
      ]);
      expect(readFileSync(join(artifactsDir, "repo-state.txt"), "utf8")).toBe(repoState());
      expect(counter(artifactsDir, "build-budget.txt")).toBe(6); // ceil(5 × 1.2)
      expect(counter(artifactsDir, "build-iter.txt")).toBe(0);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);
      expect(existsSync(join(artifactsDir, "plan-hash.txt"))).toBe(false);
    });
  });

  test("recomputes the budget from the open count of this cycle", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan([...shipped(9), ...open(10)]);
      expect(runMain(modeEnv("build"))).toBe(0);
      expect(counter(artifactsDir, "build-budget.txt")).toBe(12);

      // Cycle 2 plans against the review's findings, so its budget is its own.
      writePlan([...shipped(19), ...open(1)]);
      expect(runMain(modeEnv("build"))).toBe(0);

      expect(counter(artifactsDir, "build-budget.txt")).toBe(2);
    });
  });

  test("budgets a freshly scaffolded plan at 1 iteration", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      copyFileSync(REAL_TEMPLATE, "IMPLEMENTATION_PLAN.md");

      expect(runMain(modeEnv("build"))).toBe(0);

      // `computeBudget(0)`, not `computeBudget(1)`: the exemplar is not work.
      expect(counter(artifactsDir, "build-budget.txt")).toBe(1);
    });
  });

  test("resets the iteration and noop counters from the previous cycle", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(open(4));
      writeCounter(join(artifactsDir, "build-iter.txt"), 11);
      writeCounter(join(artifactsDir, "build-noops.txt"), 2);

      expect(runMain(modeEnv("build"))).toBe(0);

      // A carried-over noop count of 2 is the worst case: the next cycle's
      // build would complete after one iteration, whatever it shipped.
      expect(counter(artifactsDir, "build-iter.txt")).toBe(0);
      expect(counter(artifactsDir, "build-noops.txt")).toBe(0);
    });
  });
});

describe("ralph-snapshot failures", () => {
  test("exits 1 and writes nothing for a mode outside the three", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(open(1));

      for (const mode of ["", "Plan", "seed", "planning"]) {
        expect(runMain(modeEnv(mode))).toBe(1);
      }
      expect(runMain({ ...process.env, INPUTS_MODE: undefined })).toBe(1);

      for (const name of ["plan-hash.txt", "repo-state.txt", "build-budget.txt"]) {
        expect(existsSync(join(artifactsDir, name))).toBe(false);
      }
    });
  });

  test("exits 1 when ARTIFACTS_DIR is not set", async () => {
    await withTempRepo(async () => {
      writePlan(open(1));
      const { ARTIFACTS_DIR: _unset, ...env } = process.env;

      // Nowhere to write the snapshot is nowhere for the cap script to read it,
      // so this fails the run rather than letting the loop cap itself.
      expect(runMain({ ...env, INPUTS_MODE: "plan" })).toBe(1);
    });
  });
});
