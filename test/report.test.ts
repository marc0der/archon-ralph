/**
 * `ralph-report`'s row states and the lines below them (one-shot review §9).
 *
 * The report is the product of the run: it is the only place an operator sees
 * what each phase did, and it runs after the guard has already failed a broken
 * run, so it must exit 0 in every case — including the cases where there is
 * nothing to report. Every test asserts rendered lines rather than a parse
 * tree, because the alignment and the wording *are* the contract; §4.2 quotes
 * the whole summary verbatim, and §5.1 quotes it again.
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
 * The citation every seeded item carries (spec-anchored-review §7).
 *
 * A fixture standing in for a plan satisfies the contract the plan now
 * carries, so a later test that starts reading citations finds them here
 * already. Indented by two spaces, so no marker count moves.
 */
const CITATION = "  Spec: `specs/mock.md` §1";

/**
 * A plan with `shipped`, `open` and `superseded` real items, each under a
 * `CITATION` line.
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
  ].flatMap((item) => [item, CITATION]);
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    ["# Implementation Plan", "", "## Entry Format", "", "- [ ] **Exemplar**", "", "## Items", "", ...items, ""].join(
      "\n",
    ),
  );
}

/**
 * `main()` with stdout and stderr captured.
 *
 * `env` *defaults* to `process.env` rather than capturing it, because
 * `withTempRepo` sets `ARTIFACTS_DIR` per test and one test below deletes it
 * mid-body; a snapshot taken at definition time would point every call at the
 * wrong artifacts directory.
 */
function runMain(env: NodeJS.ProcessEnv = process.env): {
  code: number;
  stdout: string[];
  stderr: string[];
} {
  const { log, error } = console;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    return { code: main(env), stdout: out, stderr: err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

const ARTIFACTS =
  "Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; " +
  "previous cycle under .ralph/<timestamp>/";

describe("ralph-report", () => {
  test("renders the summary §5.1 quotes, byte for byte", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // The spec's own example log. The alignment is asserted whole because the
      // column widths are the only thing making the rows readable, and a row
      // built with the wrong padding is invisible to a substring assertion.
      writeLog(artifactsDir, [
        "seed: archived previous cycle to .ralph/20260930-101500/",
        "plan: converged on pass 3",
        "build: 9 iterations, plan exhausted",
        "review: Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "build: 3 iterations, plan exhausted",
      ]);
      writePlan(11, 0, 1);

      expect(report(artifactsDir)).toEqual([
        "Ralph lifecycle summary",
        "  1 seed      ran — archived previous cycle to .ralph/20260930-101500/",
        "  2 plan      ran — converged on pass 3",
        "  3 build     ran — 9 iterations, plan exhausted",
        "  4 review    ran — Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "  5 build     ran — 3 iterations, plan exhausted",
        "",
        "Plan: 11 shipped, 0 open, 1 superseded",
        ARTIFACTS,
      ]);
    });
  });

  test("assigns the two build rows to phases 3 and 5 by position", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // Nothing in a row's text says which build wrote it, so the slots are
      // positional, and a third build row has no slot at all.
      writeLog(artifactsDir, [
        "build: first",
        "build: second",
        "build: third",
      ]);

      const lines = report(artifactsDir);
      expect(lines).toContain("  3 build     ran — first");
      expect(lines).toContain("  5 build     ran — second");
      expect(lines).toContain("  4 review    not reached");
      expect(lines.some((line) => line.includes("third"))).toBe(false);
    });
  });

  test("prints a gate's skip row as skipped, not as a run", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, [
        "seed: nothing to archive",
        "plan: converged on pass 1",
        "build: 4 iterations, budget of 4 spent",
        "review: skipped — 3 open items remain",
        "build: 4 iterations, budget of 4 spent",
      ]);
      writePlan(2, 3, 0);

      const lines = report(artifactsDir);
      expect(lines).toContain("  4 review    skipped — 3 open items remain");
      expect(lines).toContain("  5 build     ran — 4 iterations, budget of 4 spent");
    });
  });

  test("reports a rejected push as failed, with not reached after it", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // `ralph-build-cap` writes git's output into both files, so the log holds
      // lines that are evidence rather than rows; they must not become rows.
      writeLog(artifactsDir, [
        "seed: nothing to archive",
        "plan: converged on pass 2",
        "build: push rejected",
        " ! [rejected]        main -> main (non-fast-forward)",
      ]);
      writeFileSync(
        join(artifactsDir, "abort.txt"),
        "build: push rejected\n ! [rejected]        main -> main (non-fast-forward)\n",
      );
      writePlan(2, 1, 0);

      expect(report(artifactsDir)).toEqual([
        "Ralph lifecycle summary",
        "  1 seed      ran — nothing to archive",
        "  2 plan      ran — converged on pass 2",
        "  3 build     failed — build: push rejected",
        "  4 review    not reached",
        "  5 build     not reached",
        "",
        "Plan: 2 shipped, 1 open, 0 superseded",
        ARTIFACTS,
      ]);
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
      expect(lines).toContain(`  4 review    failed — ${abort}`);
      // The build before it still ran, and still says so.
      expect(lines).toContain("  3 build     ran — 9 iterations, plan exhausted");
      expect(lines).toContain("  5 build     not reached");
    });
  });

  // Only the row equal to the abort marker fails; the earlier build row keeps `ran`.
  test("fails only the second build row when it carries the abort marker", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, [
        "build: 9 iterations, plan exhausted",
        "review: Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "build: push rejected",
      ]);
      writeFileSync(join(artifactsDir, "abort.txt"), "build: push rejected\n");
      writePlan(9, 2, 0);

      const lines = report(artifactsDir);
      expect(lines).toContain("  3 build     ran — 9 iterations, plan exhausted");
      expect(lines).toContain("  5 build     failed — build: push rejected");
    });
  });

  test("reports an unreached run rather than failing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // `precondition` failed, so nothing wrote a log and nothing scaffolded a
      // plan. `report` is `always_run`, so this is the row it has to render.
      expect(report(artifactsDir)).toEqual([
        "Ralph lifecycle summary",
        "  1 seed      not reached",
        "  2 plan      not reached",
        "  3 build     not reached",
        "  4 review    not reached",
        "  5 build     not reached",
        "",
        "Plan: no IMPLEMENTATION_PLAN.md in the tree",
        ARTIFACTS,
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
      expect(ran.stdout).toContain("  1 seed      ran — nothing to archive");
      expect(ran.stdout).toContain("  2 plan      ran — reached the cap of 6 passes");
      expect(ran.stdout).toContain("  3 build     not reached");

      delete process.env.ARTIFACTS_DIR;
      const blind = runMain();
      expect(blind.code).toBe(0);
      expect(blind.stderr).toEqual(["ralph-report: ARTIFACTS_DIR is not set"]);
      expect(blind.stdout).toContain("  1 seed      not reached");
      // The plan is still on disk and still counted: only the log was unreachable.
      expect(blind.stdout).toContain("Plan: 0 shipped, 5 open, 0 superseded");
    });
  });

  test("parses one row per phase slot and drops lines with no phase prefix", () => {
    expect(
      parseOutcome(
        "seed: nothing to archive\nplan: converged on pass 1\nbuild: push rejected\ngit said no\n",
      ),
    ).toEqual(["seed: nothing to archive", "plan: converged on pass 1", "build: push rejected", null, null]);
  });
});

/**
 * The four modes of §12.4, one renderer each.
 *
 * A block report is the interim line a phase workflow prints, so it is asserted
 * whole rather than by substring: the thing that distinguishes it from the
 * summary is everything it leaves out — no `Ralph lifecycle summary` header,
 * no phase number, no other phase's row — and a `toContain` assertion cannot
 * see an absence. Every mode is passed as a literal at its call site rather than
 * through a helper, because the mode is the one thing each test is about.
 */
describe("ralph-report modes", () => {
  /** The log a block report reads: one row per phase that ran. */
  const MID_CYCLE = [
    "seed: archived previous cycle to .ralph/20260917-101500/",
    "plan: converged on pass 3",
    "build: 9 iterations, plan exhausted",
    "review: Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
  ];

  /** The `Plan:` row every block report ends on, from `writePlan(7, 2, 1)`. */
  const PLAN_ROW = "Plan: 7 shipped, 2 open, 1 superseded";

  test("prints the plan row and the plan counts in plan mode", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "plan" });

      expect(ran.code).toBe(0);
      expect(ran.stderr).toEqual([]);
      expect(ran.stdout).toEqual(["  plan     ran — converged on pass 3", "", PLAN_ROW]);
    });
  });

  test("prints the build row and the plan counts in build mode", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "build" });

      expect(ran.code).toBe(0);
      // No `Repositories that moved:` row: nothing recorded a `run-start.txt`,
      // so no repository can be shown to have moved against it.
      expect(ran.stdout).toEqual(["  build    ran — 9 iterations, plan exhausted", "", PLAN_ROW]);
    });
  });

  test("prints the review row and the plan counts in review mode", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(ran.code).toBe(0);
      expect(ran.stdout).toEqual([
        "  review   ran — Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "",
        PLAN_ROW,
      ]);
    });
  });

  // The same log, the same plan, the whole summary: `auto` is `ralph-wiggum`'s
  // mode and adding the three block modes must not have moved one line of it.
  test("still prints the summary §5.1 quotes in auto mode", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "auto" });

      expect(ran.code).toBe(0);
      expect(ran.stdout).toEqual([
        "Ralph lifecycle summary",
        "  1 seed      ran — archived previous cycle to .ralph/20260917-101500/",
        "  2 plan      ran — converged on pass 3",
        "  3 build     ran — 9 iterations, plan exhausted",
        "  4 review    ran — Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "  5 build     not reached",
        "",
        PLAN_ROW,
        ARTIFACTS,
      ]);
    });
  });

  // A gate that skipped its block appended the skip row, so the block report
  // prints that row as it stands rather than as a run (one-shot review §5.2).
  test("prints each block's own skip row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, [
        "seed: nothing to archive",
        "plan: skipped — no specs",
        "build: skipped — no open items",
        "review: skipped — no cycle base",
      ]);
      writePlan(2, 0, 0);

      const planned = runMain({ ...process.env, INPUTS_MODE: "plan" });
      const built = runMain({ ...process.env, INPUTS_MODE: "build" });
      const reviewed = runMain({ ...process.env, INPUTS_MODE: "review" });

      const PLAN = "Plan: 2 shipped, 0 open, 0 superseded";
      expect(planned.stdout).toEqual(["  plan     skipped — no specs", "", PLAN]);
      expect(built.stdout).toEqual(["  build    skipped — no open items", "", PLAN]);
      expect(reviewed.stdout).toEqual(["  review   skipped — no cycle base", "", PLAN]);
    });
  });

  // The second build of a composed run reads its own row, the last one.
  test("prints the last row of its phase", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, [
        ...MID_CYCLE,
        "review: Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "build: 3 iterations, plan exhausted",
      ]);
      writePlan(7, 2, 1);

      const built = runMain({ ...process.env, INPUTS_MODE: "build" });
      const reviewed = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(built.stdout).toEqual(["  build    ran — 3 iterations, plan exhausted", "", PLAN_ROW]);
      expect(reviewed.stdout).toEqual([
        "  review   ran — Review filed 2 findings. Reviewed 1 specs and 14 changed files.",
        "",
        PLAN_ROW,
      ]);
    });
  });

  // A block that wrote no row failed before its gate: its report says so, and
  // no plan state can talk it into a skip reason.
  test("prints not reached for a block that wrote no row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, ["seed: nothing to archive"]);
      writePlan(2, 0, 0);

      for (const [mode, row] of <const>[
        ["plan", "  plan     not reached"],
        ["build", "  build    not reached"],
        ["review", "  review   not reached"],
      ]) {
        const ran = runMain({ ...process.env, INPUTS_MODE: mode });

        expect(ran.code).toBe(0);
        expect(ran.stdout).toEqual([
          row,
          "",
          "Plan: 2 shipped, 0 open, 0 superseded",
        ]);
      }
    });
  });

  test("prints not reached when no plan file exists", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, ["seed: nothing to archive"]);

      const ran = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(ran.code).toBe(0);
      expect(ran.stdout).toEqual([
        "  review   not reached",
        "",
        "Plan: no IMPLEMENTATION_PLAN.md in the tree",
      ]);
    });
  });

  // The abort row keeps its `failed` state in a block report.
  test("prints failed for the row that carries the abort marker", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, [...MID_CYCLE.slice(0, 2), "build: push rejected"]);
      writeFileSync(join(artifactsDir, "abort.txt"), "build: push rejected\ngit said no\n");
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "build" });

      expect(ran.stdout).toEqual(["  build    failed — build: push rejected", "", PLAN_ROW]);
    });
  });

  // An absent mode is `auto`, today's behaviour, so this script landed before
  // the composition commit that declares `with: {mode: …}` on every node.
  test("defaults an absent INPUTS_MODE to auto", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);
      const { INPUTS_MODE: _unset, ...env } = process.env;

      const ran = runMain(env);

      expect(ran.code).toBe(0);
      expect(ran.stdout).toEqual(report(artifactsDir));
      expect(ran.stdout[0]).toBe("Ralph lifecycle summary");
    });
  });

  // A typo in `with: {mode: …}` must print nothing at all: a mode that fell
  // back to `auto` would print the whole lifecycle summary mid-run and let the
  // operator read it as this block's report.
  test("fails an unrecognised INPUTS_MODE and prints no report", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "repot" });

      expect(ran.code).toBe(1);
      expect(ran.stdout).toEqual([]);
      expect(ran.stderr).toEqual([
        'ralph-report: INPUTS_MODE must be auto, plan, build, review; got "repot"',
      ]);
    });
  });
});
