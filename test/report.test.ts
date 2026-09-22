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
 * The citation every seeded item carries (spec-anchored-review §7).
 *
 * A fixture standing in for a plan satisfies the contract the plan now
 * carries, so a later test that starts reading citations finds them here
 * already. Indented by two spaces, so no marker count moves.
 */
const CITATION = "  Spec: `specs/mock.md` §1";

/**
 * A plan with `shipped`, `open` and `superseded` real items, each under a
 * `CITATION` line unless `cited` says otherwise.
 *
 * The `## Entry Format` exemplar is included because it is an open item
 * textually: the `Plan:` row must count through `planItemsBody` like every
 * other count in the lifecycle, and a fixture without the heading would pass
 * either way.
 *
 * `cited: false` is the one plan the third review guard term rejects, and §7
 * names it as the deliberate exception to the seeded citations. It omits the
 * line rather than emptying `CITATION`, so no marker count and no column of any
 * other fixture moves.
 */
function writePlan(shipped: number, open: number, superseded: number, cited = true): void {
  const items = [
    ...Array.from({ length: shipped }, (_, i) => `- [x] **Shipped ${i + 1}**`),
    ...Array.from({ length: open }, (_, i) => `- [ ] **Open ${i + 1}**`),
    ...Array.from({ length: superseded }, (_, i) => `- [~] **Superseded ${i + 1}**`),
  ].flatMap((item) => (cited ? [item, CITATION] : [item]));
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
      // The plan holds one superseded item so that it still cites a spec: the
      // shipped cause only renders once the third guard term is satisfied.
      writeLog(artifactsDir, [
        "build: 4 iterations, budget of 4 spent",
        "cycle 1: 3 open items remain — starting cycle 2",
        "build: 2 iterations, no changes for 2 consecutive iterations",
        "cycle 2: 3 open items remain — starting cycle 3",
        "cycle 3: clean — no open items remain",
      ]);
      writePlan(0, 0, 1);

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

  test("tells the two zero-open skip causes apart by the plan's citations", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // One log, two plans. `cycle 1: clean` says nothing about which of the
      // review guard's other two terms was false, so the cause is derived from
      // the plan as it stands (§4) — and the operator's next command differs:
      // `ralph-plan` to anchor the items, `ralph-build` to ship one.
      writeLog(artifactsDir, [
        "build: 2 iterations, plan exhausted",
        "cycle 1: clean — no open items remain",
      ]);

      writePlan(2, 0, 0, false);
      expect(report(artifactsDir)).toContain(
        "    review skipped — no cited specs — run ralph-plan to anchor the items on them",
      );

      // The same two shipped items, now citing a spec: the third term holds,
      // so the shipped cause is the only one left to name.
      writePlan(2, 0, 0);
      expect(report(artifactsDir)).toContain("    review skipped — no shipped items to audit");
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

/**
 * The four modes of §12.4, one renderer each.
 *
 * A block report is the interim line a phase workflow prints, so it is asserted
 * whole rather than by substring: the thing that distinguishes it from the
 * summary is everything it leaves out — no `Ralph lifecycle summary` header, no
 * cycle block, no `Result:` row — and a `toContain` assertion cannot see an
 * absence. Every mode is passed as a literal at its call site rather than
 * through a helper, because the mode is the one thing each test is about.
 */
describe("ralph-report modes", () => {
  /**
   * The log a block report reads: the rows of the cycle `ralph-cycle-cap` has
   * not closed yet.
   *
   * No `cycle N:` line, because a block reports from inside its own cycle. A
   * closed trailing block reads as no block at all, which is the case the
   * skipped-row tests below cover.
   */
  const MID_CYCLE = [
    "seed: archived previous cycle to .ralph/20260917-101500/",
    "plan: converged on pass 3",
    "build: 9 iterations, plan exhausted",
    "review: converged on pass 2, audited 9 shipped items",
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
      // No `, filed F findings` clause: the count is read off the `cycle N:`
      // line, which is appended after the review block has already reported.
      expect(ran.stdout).toEqual([
        "  review   ran — converged on pass 2, audited 9 shipped items",
        "",
        PLAN_ROW,
      ]);
    });
  });

  // The same log, the same plan, the whole summary: `auto` is `ralph-wiggum`'s
  // mode and adding the three block modes must not have moved one line of it.
  test("still prints the summary §4.2 quotes in auto mode", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, MID_CYCLE);
      writePlan(7, 2, 1);

      const ran = runMain({ ...process.env, INPUTS_MODE: "auto" });

      expect(ran.code).toBe(0);
      expect(ran.stdout).toEqual([
        "Ralph lifecycle summary",
        "  seed     ran — archived previous cycle to .ralph/20260917-101500/",
        "  plan     ran — converged on pass 3",
        "  cycle 1",
        "    build  ran — 9 iterations, plan exhausted",
        "    review ran — converged on pass 2, audited 9 shipped items",
        "  Result: stopped with open items after 1 cycle",
        "",
        PLAN_ROW,
        "Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; " +
          "previous cycle under .ralph/<timestamp>/",
      ]);
    });
  });

  // A standalone block whose `when:` guard was false: the loop was skipped, and
  // `report` runs anyway under `trigger_rule: all_done` (§12.3). The log holds
  // the rows of the phases that did run and no row for this one.
  test("reports a skipped block from a log with no phase row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, ["seed: nothing to archive", "plan: converged on pass 1"]);
      writePlan(0, 3, 0);

      const built = runMain({ ...process.env, INPUTS_MODE: "build" });
      const reviewed = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(built.code).toBe(0);
      expect(built.stdout).toEqual([
        "  build    skipped — no open items",
        "",
        "Plan: 0 shipped, 3 open, 0 superseded",
      ]);
      expect(reviewed.code).toBe(0);
      expect(reviewed.stdout).toEqual([
        "  review   skipped — no shipped items to audit",
        "",
        "Plan: 0 shipped, 3 open, 0 superseded",
      ]);
    });
  });

  // `reviewReport` takes the same cause off the same plan read as the summary
  // (§4). Its other two guard terms stay indistinguishable here, so the third
  // is the only one the block report can name.
  test("names the uncited cause for an absent review row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, ["seed: nothing to archive", "plan: converged on pass 1"]);

      writePlan(2, 0, 0, false);
      const uncited = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(uncited.code).toBe(0);
      expect(uncited.stdout).toEqual([
        "  review   skipped — no cited specs — run ralph-plan to anchor the items on them",
        "",
        "Plan: 2 shipped, 0 open, 0 superseded",
      ]);

      writePlan(2, 0, 0);
      const cited = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(cited.code).toBe(0);
      expect(cited.stdout).toEqual([
        "  review   skipped — no shipped items to audit",
        "",
        "Plan: 2 shipped, 0 open, 0 superseded",
      ]);
    });
  });

  // No plan at all: `counts` throws, the predicate is false, and the row names
  // the shipped cause. Claiming the gate fired would name a cause the run never
  // reached — the `Plan:` row below already says the artifact is missing.
  test("falls back to the shipped cause when no plan file exists", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeLog(artifactsDir, ["seed: nothing to archive"]);

      const ran = runMain({ ...process.env, INPUTS_MODE: "review" });

      expect(ran.code).toBe(0);
      expect(ran.stdout).toEqual([
        "  review   skipped — no shipped items to audit",
        "",
        "Plan: no IMPLEMENTATION_PLAN.md in the tree",
      ]);
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
