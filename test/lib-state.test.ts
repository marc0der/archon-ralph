/**
 * The run-state helpers (spec §9). These four are how one iteration tells the
 * next one where it got to: a counter that reads back wrong repeats or skips a
 * phase, and a `cycle_cap` that reads back `NaN` runs the fixpoint to
 * `max_iterations`. So every case below is a file the loop must survive.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendOutcome,
  readCounter,
  readSettings,
  writeCounter,
} from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

const DEFAULTS = { skip_push: false, cycle_cap: 3 };

describe("readSettings", () => {
  test("defaults when settings.json is missing", async () => {
    await withTempRepo(({ artifactsDir }) => {
      expect(readSettings(artifactsDir)).toEqual(DEFAULTS);
    });
  });

  test("defaults when the artifacts directory itself is absent", async () => {
    await withTempRepo(({ root }) => {
      expect(readSettings(join(root, "no-such-dir"))).toEqual(DEFAULTS);
    });
  });

  test("reads both fields back", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writeFileSync(
        join(artifactsDir, "settings.json"),
        JSON.stringify({ skip_push: true, cycle_cap: 2 }),
      );

      expect(readSettings(artifactsDir)).toEqual({ skip_push: true, cycle_cap: 2 });
    });
  });

  test("defaults when the file is not JSON", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writeFileSync(join(artifactsDir, "settings.json"), "skip_push: true\n");

      expect(readSettings(artifactsDir)).toEqual(DEFAULTS);
    });
  });

  // A partial write must not take the whole file down with it: the cap scripts
  // have no other source for the field that did survive.
  test("defaults each field on its own", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writeFileSync(join(artifactsDir, "settings.json"), JSON.stringify({ skip_push: true }));

      expect(readSettings(artifactsDir)).toEqual({ skip_push: true, cycle_cap: 3 });
    });
  });

  test("rejects a cycle_cap that is not a positive integer", async () => {
    await withTempRepo(({ artifactsDir }) => {
      const file = join(artifactsDir, "settings.json");

      for (const cycle_cap of ["2", 0, 1.5, null]) {
        writeFileSync(file, JSON.stringify({ cycle_cap }));
        expect(readSettings(artifactsDir).cycle_cap).toBe(3);
      }
    });
  });
});

describe("readCounter and writeCounter", () => {
  test("round trip a count", async () => {
    await withTempRepo(({ artifactsDir }) => {
      const file = join(artifactsDir, "build-iter.txt");
      writeCounter(file, 4);

      expect(readFileSync(file, "utf8")).toBe("4\n");
      expect(readCounter(file, 0)).toBe(4);
    });
  });

  test("returns the fallback for a missing file", async () => {
    await withTempRepo(({ artifactsDir }) => {
      // The first plan pass reads a file nothing has written yet, and
      // `build-budget.txt` falls back to a budget, not to zero.
      expect(readCounter(join(artifactsDir, "plan-iter.txt"), 0)).toBe(0);
      expect(readCounter(join(artifactsDir, "build-budget.txt"), 1)).toBe(1);
    });
  });

  test("returns the fallback for an unparsable value", async () => {
    await withTempRepo(({ artifactsDir }) => {
      const file = join(artifactsDir, "build-budget.txt");

      for (const text of ["", "   ", "\n", "4 passes", "four", "1.5", "NaN"]) {
        writeFileSync(file, text);
        expect(readCounter(file, 1)).toBe(1);
      }
    });
  });

  test("tolerates surrounding whitespace", async () => {
    await withTempRepo(({ artifactsDir }) => {
      const file = join(artifactsDir, "cycle-iter.txt");
      writeFileSync(file, " 7 \n");

      expect(readCounter(file, 0)).toBe(7);
    });
  });
});

describe("appendOutcome", () => {
  test("appends one newline-terminated line per call", async () => {
    await withTempRepo(({ artifactsDir }) => {
      appendOutcome(artifactsDir, "seed: nothing to archive");
      appendOutcome(artifactsDir, "plan: converged on pass 2");

      expect(readFileSync(join(artifactsDir, "outcome.log"), "utf8")).toBe(
        "seed: nothing to archive\nplan: converged on pass 2\n",
      );
    });
  });

  // The report splits this file into cycles on its `cycle N:` lines, so an
  // append that clobbered the earlier rows would lose every previous cycle.
  test("keeps the rows of an existing log", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writeFileSync(join(artifactsDir, "outcome.log"), "seed: nothing to archive\n");
      appendOutcome(artifactsDir, "cycle 1: clean — no open items remain");

      expect(readFileSync(join(artifactsDir, "outcome.log"), "utf8").split("\n")).toEqual([
        "seed: nothing to archive",
        "cycle 1: clean — no open items remain",
        "",
      ]);
    });
  });

  test("creates the log inside a directory the run already made", async () => {
    await withTempRepo(({ root }) => {
      const nested = join(root, "artifacts", "nested");
      mkdirSync(nested, { recursive: true });
      appendOutcome(nested, "seed: nothing to archive");

      expect(readFileSync(join(nested, "outcome.log"), "utf8")).toBe(
        "seed: nothing to archive\n",
      );
    });
  });
});
