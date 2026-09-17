/**
 * `ralph-cycle-cap`'s three exits and the `outcome.log` line each writes (§9).
 *
 * The exit codes are inverted here (§2): 0 completes the fixpoint, 1 runs
 * another build-review cycle. Every test asserts the code together with
 * `outcome.log`, because the code alone is invisible — an exit 0 too early ends
 * the lifecycle with work outstanding and reads as a clean run, and an exit 1
 * too often spends the whole `cycle_cap` on a finished plan.
 *
 * `outcome.log` is the other half of the contract: `ralph-report` splits the
 * file into cycles on exactly these `cycle N:` lines and reads each cycle's
 * `filed F findings` out of the open count they name (§4.2), so the text is
 * asserted literally rather than by substring.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../template/scripts/ralph-cycle-cap.ts";
import { readCounter, writeCounter } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

/**
 * A plan whose `## Items` body holds `items`.
 *
 * The `## Entry Format` exemplar is included because it is an open item
 * textually: a fixture without it would pass even if the script counted the
 * whole file, and the real template always carries one.
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
      ...items,
      "",
    ].join("\n"),
  );
}

/** What `ralph-seed` leaves in `settings.json`, which is the only route the inputs have here. */
function writeSettings(artifactsDir: string, cycleCap: number): void {
  writeFileSync(
    join(artifactsDir, "settings.json"),
    `${JSON.stringify({ skip_push: false, cycle_cap: cycleCap })}\n`,
  );
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
        "ralph-cycle-cap.ts",
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
  return readCounter(join(artifactsDir, "cycle-iter.txt"), -1);
}

function outcome(artifactsDir: string): string[] {
  const file = join(artifactsDir, "outcome.log");
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
}

describe("ralph-cycle-cap", () => {
  test("completes on zero open items", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**", "- [~] **Superseded**"]);
      writeSettings(artifactsDir, 3);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(1);
      expect(outcome(artifactsDir)).toEqual(["cycle 1: clean — no open items remain"]);
    });
  });

  test("completes on a freshly scaffolded plan, whose only item is the exemplar", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      // The case `planItemsBody` exists for: an empty `## Items` body with the
      // exemplar above it. Counting the file whole makes `open` 1 here, and
      // every run then spends its full `cycle_cap` on a plan with no work in it.
      writePlan([]);
      writeSettings(artifactsDir, 3);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["cycle 1: clean — no open items remain"]);
    });
  });

  test("continues while open items remain, naming the count and the next cycle", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**", "- [ ] **Finding one**", "- [ ] **Finding two**"]);
      writeSettings(artifactsDir, 3);

      expect(runMain(artifactsDir).code).toBe(1);
      expect(iter(artifactsDir)).toBe(1);
      expect(outcome(artifactsDir)).toEqual(["cycle 1: 2 open items remain — starting cycle 2"]);
    });
  });

  test("completes at the cap with the open items named", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **Still open**"]);
      writeSettings(artifactsDir, 3);
      writeCounter(join(artifactsDir, "cycle-iter.txt"), 2);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(3);
      // Not `clean`: the report must distinguish a lifecycle that finished from
      // one that ran out of cycles with work outstanding.
      expect(outcome(artifactsDir)).toEqual([
        "cycle 3: reached the cycle cap of 3 with open items remaining",
      ]);
    });
  });

  test("prefers the clean row at the cap", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**"]);
      writeSettings(artifactsDir, 2);
      writeCounter(join(artifactsDir, "cycle-iter.txt"), 1);

      // Both conditions hold on the last cycle of a finished plan. The report
      // has to read that as a finished lifecycle, not as an exhausted budget.
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual(["cycle 2: clean — no open items remain"]);
    });
  });

  test("counts the cycles across a whole fixpoint", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeSettings(artifactsDir, 3);

      // `cycle-iter.txt` is the one counter `ralph-snapshot` never resets, so
      // the cap only bounds anything if it survives the cycles it counts.
      writePlan(["- [ ] **One**"]);
      expect(runMain(artifactsDir).code).toBe(1);
      expect(runMain(artifactsDir).code).toBe(1);

      writePlan(["- [x] **One**"]);
      expect(runMain(artifactsDir).code).toBe(0);
      expect(iter(artifactsDir)).toBe(3);
      expect(outcome(artifactsDir)).toEqual([
        "cycle 1: 1 open items remain — starting cycle 2",
        "cycle 2: 1 open items remain — starting cycle 3",
        "cycle 3: clean — no open items remain",
      ]);
    });
  });

  test("falls back to a cap of 3 with no settings file", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **Still open**"]);
      // No `settings.json`: `readSettings` defaults `cycle_cap` to 3, so a run
      // whose seed did not record the inputs is still bounded.
      writeCounter(join(artifactsDir, "cycle-iter.txt"), 2);

      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual([
        "cycle 3: reached the cycle cap of 3 with open items remaining",
      ]);
    });
  });

  test("honours a cap of 1", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **Still open**"]);
      writeSettings(artifactsDir, 1);

      // The smallest cap `readSettings` accepts: one cycle, then stop. A
      // `cycles > cap` comparison would run two.
      expect(runMain(artifactsDir).code).toBe(0);
      expect(outcome(artifactsDir)).toEqual([
        "cycle 1: reached the cycle cap of 1 with open items remaining",
      ]);
    });
  });

  test("exits 1 naming the missing argument and writes nothing", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writePlan(["- [ ] **Still open**"]);

      for (const argv of [undefined, ""]) {
        const { code, stderr } = runMain(argv);
        // 1 means "run another cycle", so the group runs to `max_iterations`
        // and fails the node. Exiting 0 would end the lifecycle after one cycle.
        expect(code).toBe(1);
        expect(stderr).toContain("ARTIFACTS_DIR");
        expect(existsSync(join(artifactsDir, "cycle-iter.txt"))).toBe(false);
        expect(existsSync(join(artifactsDir, "outcome.log"))).toBe(false);
      }
    });
  });
});
