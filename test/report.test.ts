/**
 * `ralph-report`'s three row states and the lines below them (§9).
 *
 * The report is the product of the run: it is the only place an operator sees
 * what each phase did, and it runs after the guard has already failed a broken
 * run, so it must exit 0 in every case — including the cases where there is
 * nothing to report. Every test asserts rendered lines rather than a parse
 * tree, because the alignment and the wording *are* the contract; §4.2 quotes
 * the whole summary verbatim.
 */

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, parseOutcome, report } from "../template/scripts/ralph-report.ts";
import { withTempRepo } from "./helpers.ts";

/** The `outcome.log` a run left behind, newline-terminated as `appendOutcome` writes it. */
function writeLog(artifactsDir: string, lines: string[]): void {
  writeFileSync(join(artifactsDir, "outcome.log"), `${lines.join("\n")}\n`);
}

/**
 * A plan with `shipped`, `open` and `superseded` real items.
 *
 * The `## Entry Format` exemplar is included because it is an open item
 * textually: the `Plan:` row must count through `planItemsBody` like every
 * other count in the lifecycle, and a fixture without the heading would pass
 * either way.
 */
function writePlan(shipped: number, open: number, superseded: number): void {
  const items = [
    ...Array.from({ length: shipped }, (_, i) => `- [x] **Shipped ${i + 1}**`),
    ...Array.from({ length: open }, (_, i) => `- [ ] **Open ${i + 1}**`),
    ...Array.from({ length: superseded }, (_, i) => `- [~] **Superseded ${i + 1}**`),
  ];
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    ["# Implementation Plan", "", "## Entry Format", "", "- [ ] **Exemplar**", "", "## Items", "", ...items, ""].join(
      "\n",
    ),
  );
}

/** `main()` with stdout and stderr captured. */
function runMain(): { code: number; stdout: string[]; stderr: string[] } {
  const { log, error } = console;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    return { code: main(), stdout: out, stderr: err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** The state column of a row, by its label. */
function state(lines: string[], label: string): string | undefined {
  const row = lines.find((line) => line.trimStart().startsWith(`${label} `));
  return row?.trimStart().slice(label.length).trimStart();
}

describe("ralph-report", () => {
  test("renders the summary §4.2 quotes, byte for byte", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // The spec's own example log. The alignment is asserted whole because the
      // three column widths are the only thing making the block readable, and a
      // row built with the wrong padding is invisible to a substring assertion.
      writeLog(artifactsDir, [
        "seed: archived previous cycle to .ralph/20260917-101500/",
        "plan: converged on pass 3",
        "build: 9 iterations, plan exhausted",
        "review: converged on pass 2, audited 9 shipped items",
        "cycle 1: 2 open items remain — starting cycle 2",
        "build: 3 iterations, plan exhausted",
        "review: converged on pass 1, audited 11 shipped items",
        "cycle 2: clean — no open items remain",
      ]);
      writePlan(11, 0, 1);

      expect(report(artifactsDir)).toEqual([
        "Ralph lifecycle summary",
        "  seed     ran — archived previous cycle to .ralph/20260917-101500/",
        "  plan     ran — converged on pass 3",
        "  cycle 1",
        "    build  ran — 9 iterations, plan exhausted",
        "    review ran — converged on pass 2, audited 9 shipped items, filed 2 findings",
        "  cycle 2",
        "    build  ran — 3 iterations, plan exhausted",
        "    review ran — converged on pass 1, audited 11 shipped items, filed 0 findings",
        "  Result: clean after 2 cycles",
        "",
        "Plan: 11 shipped, 0 open, 1 superseded",
        "Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; " +
          "previous cycle under .ralph/<timestamp>/",
      ]);
    });
  });

  test("reports a skipped build and reads the review's skip reason off the cycle line", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // Cycle 1: review filed findings, so build ran and review did too. Cycle
      // 2: the plan still held open items, so `review` was skipped on its
      // `open == 0` guard. Cycle 3: nothing shipped, so review had no audit.
      writeLog(artifactsDir, [
        "build: 4 iterations, budget of 4 spent",
        "cycle 1: 3 open items remain — starting cycle 2",
        "build: 2 iterations, no changes for 2 consecutive iterations",
        "cycle 2: 3 open items remain — starting cycle 3",
        "cycle 3: clean — no open items remain",
      ]);
      writePlan(0, 0, 0);

      const lines = report(artifactsDir);
      expect(lines).toContain("    review skipped — 3 open items remain");
      expect(lines).toContain("    build  skipped — no open items");
      expect(lines).toContain("    review skipped — no shipped items to audit");
      // The skipped rows still belong to their own cycles, three of them.
      expect(lines.filter((line) => line.startsWith("  cycle "))).toEqual([
        "  cycle 1",
        "  cycle 2",
        "  cycle 3",
      ]);
    });
  });

  test("reports a rejected push as a failed build row and a failed result", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // `ralph-build-cap` writes git's output into both files, so the log holds
      // lines that are evidence rather than rows; they must not become rows.
      writeLog(artifactsDir, [
        "plan: converged on pass 2",
        "build: push rejected",
        " ! [rejected]        main -> main (non-fast-forward)",
      ]);
      writeFileSync(
        join(artifactsDir, "abort.txt"),
        "build: push rejected\n ! [rejected]        main -> main (non-fast-forward)\n",
      );
      writePlan(2, 1, 0);

      const lines = report(artifactsDir);
      expect(state(lines, "build")).toBe("failed — build: push rejected");
      expect(lines).toContain("  Result: failed after 1 cycle");
      // The cycle never closed, so its review row has no count to quote.
      expect(state(lines, "review")).toBe("skipped — open items remain");
      expect(lines.some((line) => line.includes("non-fast-forward"))).toBe(false);
    });
  });

  test("reports an un-ticking review as a failed review row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      const abort =
        "review: reduced the shipped item count from 9 to 8; review may " +
        "never un-tick an item. Restore IMPLEMENTATION_PLAN.md before re-running.";
      writeLog(artifactsDir, ["build: 9 iterations, plan exhausted", abort]);
      writeFileSync(join(artifactsDir, "abort.txt"), `${abort}\n`);
      writePlan(8, 0, 0);

      const lines = report(artifactsDir);
      expect(state(lines, "review")).toBe(`failed — ${abort}`);
      // The build of the same cycle still ran, and still says so.
      expect(state(lines, "build")).toBe("ran — 9 iterations, plan exhausted");
      expect(lines).toContain("  Result: failed after 1 cycle");
    });
  });

  test("reports the cycle cap without inventing a finding count", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // The cap line names open items and counts none (§4.2), so neither the
      // `filed F findings` clause nor a counted skip reason can be derived.
      writeLog(artifactsDir, [
        "build: 6 iterations, budget of 6 spent",
        "cycle 1: 4 open items remain — starting cycle 2",
        "build: 5 iterations, budget of 6 spent",
        "cycle 2: reached the cycle cap of 2 with open items remaining",
      ]);
      writePlan(7, 4, 0);

      const lines = report(artifactsDir);
      expect(state(lines, "review")).toBe("skipped — 4 open items remain");
      expect(lines).toContain("    review skipped — open items remain");
      expect(lines).toContain("  Result: stopped at the cycle cap after 2 cycles");
      expect(lines).toContain("Plan: 7 shipped, 4 open, 0 superseded");
    });
  });

  test("reports an unreached run rather than failing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // `precondition` failed, so nothing wrote a log and nothing scaffolded a
      // plan. `report` is `always_run`, so this is the row it has to render.
      expect(report(artifactsDir)).toEqual([
        "Ralph lifecycle summary",
        "  seed     not reached",
        "  plan     not reached",
        "  Result: not reached",
        "",
        "Plan: no IMPLEMENTATION_PLAN.md in the tree",
        "Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; " +
          "previous cycle under .ralph/<timestamp>/",
      ]);
    });
  });

  test("exits 0 and prints every line through main(), with or without ARTIFACTS_DIR", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, ["seed: nothing to archive", "plan: reached the cap of 6 passes"]);
      writePlan(0, 5, 0);

      const ran = runMain();
      expect(ran.code).toBe(0);
      expect(ran.stderr).toEqual([]);
      expect(ran.stdout).toEqual(report(artifactsDir));
      expect(ran.stdout).toContain("  seed     ran — nothing to archive");
      expect(ran.stdout).toContain("  plan     ran — reached the cap of 6 passes");
      // No cycle line and no phase line after `plan`, so no cycle block at all.
      expect(ran.stdout.some((line) => line.startsWith("  cycle "))).toBe(false);

      delete process.env.ARTIFACTS_DIR;
      const blind = runMain();
      expect(blind.code).toBe(0);
      expect(blind.stderr).toEqual(["ralph-report: ARTIFACTS_DIR is not set"]);
      expect(blind.stdout).toContain("  seed     not reached");
      // The plan is still on disk and still counted: only the log was unreachable.
      expect(blind.stdout).toContain("Plan: 0 shipped, 5 open, 0 superseded");
    });
  });

  test("opens no empty cycle block after the last cycle line", async () => {
    // The healthy log ends on a `cycle N:` line, and the block it opens holds
    // nothing. Emitting it would add a phantom cycle to every clean run.
    const closed = parseOutcome("build: 1 iterations, plan exhausted\ncycle 1: clean — no open items remain\n");
    expect(closed.cycles).toHaveLength(1);
    expect(closed.cycles[0]?.end).toBe("cycle 1: clean — no open items remain");

    // A cycle cut off mid-way has no closing line, and its block is still real.
    const open = parseOutcome("build: 2 iterations, plan exhausted\n");
    expect(open.cycles).toHaveLength(1);
    expect(open.cycles[0]).toEqual({
      build: "build: 2 iterations, plan exhausted",
      review: null,
      end: null,
    });
  });
});
