/**
 * `ralph-review-cap`'s un-tick abort, its convergence test and its cap (§9).
 *
 * The exit codes are inverted here (§2): 0 completes the review loop, 1 runs
 * another pass. Every test asserts the code together with `outcome.log`,
 * because the code alone is invisible — it either burns the node's
 * `max_iterations` or ends the review after one pass, and both look like a
 * working run until the report is read.
 *
 * The un-tick tests also assert `abort.txt`, which is the only thing that fails
 * the run: `until_bash` cannot fail a node, so a missing marker means the review
 * destroyed shipped work and the lifecycle reported success (§4.3).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../template/scripts/ralph-review-cap.ts";
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
 * A plan whose `## Items` body holds `items`, each under a `CITATION` line.
 *
 * The `## Entry Format` exemplar is included because the script and
 * `ralph-snapshot` must both count through `planItemsBody`: a test that omits
 * it would pass even if one of them counted the file whole.
 */
function writePlan(items: string[]): void {
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    [
      "# Implementation Plan",
      "",
      "## Entry Format",
      "",
      "- [ ] **Short imperative title**",
      "",
      "## Items",
      "",
      ...items.flatMap((item) => [item, CITATION]),
      "",
    ].join("\n"),
  );
}

/** What `ralph-snapshot --mode review` leaves behind. */
function snapshot(artifactsDir: string, shippedBefore: number): void {
  writeFileSync(join(artifactsDir, "plan-hash.txt"), `${planStateHash()}\n`);
  writeCounter(join(artifactsDir, "shipped-before.txt"), shippedBefore);
  writeCounter(join(artifactsDir, "review-iter.txt"), 0);
}

/** `main()` with the artifacts directory in `argv[2]` and stderr captured. */
function runMain(artifactsDir: string | undefined): { code: number; stderr: string } {
  const { error } = console;
  const err: string[] = [];
  console.error = (line: string) => err.push(line);
  try {
    return {
      code: main([
        "bun",
        "ralph-review-cap.ts",
        ...(artifactsDir === undefined ? [] : [artifactsDir]),
      ]),
      stderr: err.join("\n"),
    };
  } finally {
    console.error = error;
  }
}

function iter(artifactsDir: string): number {
  // -1 as the fallback: an absent counter must not read back as a plausible 0.
  return readCounter(join(artifactsDir, "review-iter.txt"), -1);
}

function outcome(artifactsDir: string): string[] {
  const file = join(artifactsDir, "outcome.log");
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
}

function abort(artifactsDir: string): string {
  return readFileSync(join(artifactsDir, "abort.txt"), "utf8");
}

const UN_TICK =
  "review: reduced the shipped item count from 2 to 1; review may never un-tick an item. " +
  "Restore IMPLEMENTATION_PLAN.md before re-running.";

describe("ralph-review-cap", () => {
  test("continues while the review files findings", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**"]);
      snapshot(artifactsDir, 1);

      writePlan(["- [x] **Shipped**", "- [ ] **Finding one**"]);
      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(1);

      writePlan(["- [x] **Shipped**", "- [ ] **Finding one**", "- [ ] **Finding two**"]);
      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(2);

      // Nothing is appended until the loop completes: the report reads one row
      // per phase, not one per pass.
      expect(outcome(artifactsDir)).toEqual([]);
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("completes on an unchanged plan, naming the pass and the audited count", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**", "- [x] **Two**", "- [~] **Superseded**"]);
      snapshot(artifactsDir, 2);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(1);
      // `audited 2`, not 3: `[~]` is not shipped, and the exemplar under
      // `## Entry Format` is outside the body either way.
      expect(outcome(artifactsDir)).toEqual(["review: converged on pass 1, audited 2 shipped items"]);
    });
  });

  test("converges on the pass after the last one that filed a finding", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**"]);
      snapshot(artifactsDir, 1);

      writePlan(["- [x] **Shipped**", "- [ ] **Finding one**"]);
      expect(runMain(artifactsDir).code).toBe(1);

      // The hash is written back every pass, so pass 2 compares against pass 1
      // and not against the snapshot. Without that write-back the review would
      // never converge after filing a single finding.
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["review: converged on pass 2, audited 1 shipped items"]);
    });
  });

  test("completes on pass 6 however much the plan changed", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**"]);
      snapshot(artifactsDir, 1);
      writeCounter(join(artifactsDir, "review-iter.txt"), 5);

      writePlan(["- [x] **Shipped**", "- [ ] **Finding one**"]);
      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(6);
      expect(outcome(artifactsDir)).toEqual(["review: reached the cap of 6 passes"]);
    });
  });

  test("aborts when the shipped count drops", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**", "- [x] **Two**"]);
      snapshot(artifactsDir, 2);

      writePlan(["- [x] **One**", "- [ ] **Two**"]);
      // 0 completes the loop; `guard` is what fails the run (§4.3).
      expect(runMain(artifactsDir).code).toBe(0);
      expect(abort(artifactsDir)).toBe(`${UN_TICK}\n`);
      expect(outcome(artifactsDir)).toEqual([UN_TICK]);
    });
  });

  test("names the drop on one line, for the report's first-line read", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**", "- [x] **Two**"]);
      snapshot(artifactsDir, 2);

      writePlan(["- [x] **One**"]);
      runMain(artifactsDir);
      // `ralph-report` renders `failed — <abort.txt first line>`, so the whole
      // reason has to be on that line.
      expect(abort(artifactsDir).trimEnd().split("\n")).toHaveLength(1);
      expect(abort(artifactsDir)).toContain("from 2 to 1");
    });
  });

  test("aborts on a deleted item, not only an un-ticked one", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**", "- [x] **Two**"]);
      snapshot(artifactsDir, 2);

      // The count is the whole test. Whether the item was un-ticked, deleted or
      // superseded, shipped work left the plan and the next cycle rebuilds it.
      writePlan(["- [x] **One**", "- [~] **Two**"]);
      expect(runMain(artifactsDir).code).toBe(0);
      expect(abort(artifactsDir)).toContain("never un-tick an item");
    });
  });

  test("does not abort when the review only files findings", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**", "- [x] **Two**"]);
      snapshot(artifactsDir, 2);

      writePlan(["- [x] **One**", "- [x] **Two**", "- [ ] **Finding one**"]);
      expect(runMain(artifactsDir).code).toBe(1);
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("does not read a missing baseline as a drop", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);
      // No `shipped-before.txt`: the fallback is 0, so a review whose snapshot
      // did not run audits instead of failing the run on its first pass.
      expect(runMain(artifactsDir).code).toBe(1);
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("does not read a missing snapshot as convergence", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);
      // No `plan-hash.txt`: `readHash` returns `""`, and an md5 is never empty.
      // Converging here would end the review after its first pass.
      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(1);
    });
  });

  test("exits 1 naming the missing argument and writes nothing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);

      for (const argv of [undefined, ""]) {
        const { code, stderr } = runMain(argv);
        // 1 means "keep looping", so the phase runs to `max_iterations` and
        // fails the node. Exiting 0 would hide the misconfiguration.
        expect(code).toBe(1);
        expect(stderr).toContain("ARTIFACTS_DIR");
        expect(existsSync(join(artifactsDir, "review-iter.txt"))).toBe(false);
        expect(existsSync(join(artifactsDir, "outcome.log"))).toBe(false);
      }
    });
  });
});
