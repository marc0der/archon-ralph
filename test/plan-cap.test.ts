/**
 * `ralph-plan-cap`'s convergence test and its cap (spec §9).
 *
 * The exit codes are inverted here (§2): 0 completes the plan loop, 1 runs
 * another pass. Every test asserts the code, the counter and `outcome.log`
 * together, because a wrong code alone is invisible — it either burns the
 * node's `max_iterations` or ends the plan phase after one pass, and both look
 * like a working run until the report is read.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../template/scripts/ralph-plan-cap.ts";
import { planStateHash, readCounter, writeCounter } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

/**
 * The citation every seeded item carries (spec-anchored-review §7).
 *
 * A fixture standing in for a plan satisfies the contract the plan now
 * carries, so a later test that starts reading citations finds them here
 * already. Indented by two spaces, so no marker count moves.
 */
const CITATION = "  Spec: `specs/mock.md` §1";

/**
 * A plan whose `## Items` body holds `items`, as `ralph-snapshot` finds it,
 * each item under a `CITATION` line of its own.
 */
function writePlan(items: string[]): void {
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    [
      "# Implementation Plan",
      "",
      "## Items",
      "",
      ...items.flatMap((item) => [item, CITATION]),
      "",
    ].join("\n"),
  );
}

/** What `ralph-snapshot` leaves behind for the `plan` mode. */
function snapshot(artifactsDir: string): void {
  writeFileSync(join(artifactsDir, "plan-hash.txt"), `${planStateHash()}\n`);
  writeCounter(join(artifactsDir, "plan-iter.txt"), 0);
}

/** `main()` with the artifacts directory in `argv[2]` and stderr captured. */
function runMain(artifactsDir: string | undefined): { code: number; stderr: string } {
  const { error } = console;
  const err: string[] = [];
  console.error = (line: string) => err.push(line);
  try {
    return {
      code: main(["bun", "ralph-plan-cap.ts", ...(artifactsDir === undefined ? [] : [artifactsDir])]),
      stderr: err.join("\n"),
    };
  } finally {
    console.error = error;
  }
}

function iter(artifactsDir: string): number {
  // -1 as the fallback: an absent counter must not read back as a plausible 0.
  return readCounter(join(artifactsDir, "plan-iter.txt"), -1);
}

function outcome(artifactsDir: string): string[] {
  const file = join(artifactsDir, "outcome.log");
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
}

function hash(artifactsDir: string): string {
  return readFileSync(join(artifactsDir, "plan-hash.txt"), "utf8").trim();
}

describe("ralph-plan-cap", () => {
  test("continues while the plan changes, counting each pass", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      snapshot(artifactsDir);

      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(1);

      writePlan(["- [ ] **One**", "- [ ] **Two**", "- [ ] **Three**"]);
      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(2);

      // Nothing is appended until the loop completes: the report reads one row
      // per phase, not one per pass.
      expect(outcome(artifactsDir)).toEqual([]);
    });
  });

  test("continues when only a spec changed", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      mkdirSync("specs");
      writeFileSync("specs/goal.md", "# Goal\n");
      snapshot(artifactsDir);

      // The plan is untouched. A pass that only wrote a spec still made
      // progress, so the fingerprint covers `specs/` and not the plan alone.
      writeFileSync("specs/goal.md", "# Goal\n\nA second paragraph.\n");
      expect(runMain(artifactsDir).code).toBe(1);
    });
  });

  test("completes on an unchanged plan and names the pass", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      snapshot(artifactsDir);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(1);
      expect(outcome(artifactsDir)).toEqual(["plan: converged on pass 1"]);
    });
  });

  test("converges on the pass after the last one that changed the plan", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      snapshot(artifactsDir);

      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      expect(runMain(artifactsDir).code).toBe(1);

      // The hash is written back every pass, so pass 2 compares against pass 1
      // and not against the snapshot. Without that write-back the loop would
      // never converge after any change at all.
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["plan: converged on pass 2"]);
    });
  });

  test("completes on pass 6 however much the plan changed", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      snapshot(artifactsDir);
      writeCounter(join(artifactsDir, "plan-iter.txt"), 5);

      writePlan(["- [ ] **One**", "- [ ] **Two**"]);
      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(6);
      expect(outcome(artifactsDir)).toEqual(["plan: reached the cap of 6 passes"]);
    });
  });

  test("records the new fingerprint on every path", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      snapshot(artifactsDir);
      writePlan(["- [ ] **Two**"]);

      runMain(artifactsDir);
      expect(hash(artifactsDir)).toBe(planStateHash());
    });
  });

  test("does not read a missing snapshot as convergence", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      // No `plan-hash.txt`: `readHash` returns `""`, and an md5 is never empty.
      // Converging here would end the plan phase after its first pass.
      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(1);
    });
  });

  test("counts the first pass when the counter file is absent", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);
      writeFileSync(join(artifactsDir, "plan-hash.txt"), `${planStateHash()}\n`);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["plan: converged on pass 1"]);
    });
  });

  test("exits 1 naming the missing argument and writes nothing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **One**"]);

      for (const argv of [undefined, ""]) {
        const { code, stderr } = runMain(argv);
        // 1 means "keep looping", so the phase runs to `max_iterations` and
        // fails the node. Exiting 0 would hide the misconfiguration.
        expect(code).toBe(1);
        expect(stderr).toContain("ARTIFACTS_DIR");
        expect(existsSync(join(artifactsDir, "plan-iter.txt"))).toBe(false);
        expect(existsSync(join(artifactsDir, "outcome.log"))).toBe(false);
      }
    });
  });
});
