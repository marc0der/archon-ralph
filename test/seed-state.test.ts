/**
 * `ralph-seed`'s run state: `settings.json`, `run-start.txt` and the first row
 * of `outcome.log` (spec §9).
 *
 * These three files are the run's only memory. `settings.json` is the sole
 * route the workflow inputs have to the `until_bash` cap scripts, which see no
 * `INPUTS_*` (§4.2 step 5), so a wrong default here silently changes when the
 * fixpoint stops. `outcome.log` is the sole source of the report's rows (§4.2),
 * so a seed that writes no row makes the whole summary start at `plan`.
 */

import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, recordRunState, settingsFromInputs } from "../template/scripts/ralph-seed.ts";
import { readSettings, repoState } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

const SOURCE_TEMPLATES = join(import.meta.dir, "../template/ralph/templates");
const TEMPLATE_DIR = ".archon/ralph/templates";

/** `bin/cli.ts init`'s outcome, as far as this node cares. */
function installTemplates(): void {
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  cpSync(SOURCE_TEMPLATES, TEMPLATE_DIR, { recursive: true });
}

/** `main()` with stdout captured: its contract is that stdout is one JSON object. */
function runMain(): number {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return main();
  } finally {
    console.log = log;
    console.error = error;
  }
}

function outcomeLines(artifactsDir: string): string[] {
  return readFileSync(join(artifactsDir, "outcome.log"), "utf8").trimEnd().split("\n");
}

describe("settingsFromInputs", () => {
  test("defaults to no skipped push and a cap of 3", () => {
    expect(settingsFromInputs({})).toEqual({ skip_push: false, cycle_cap: 3 });
  });

  test("reads both inputs from the INPUTS_* strings Archon exports", () => {
    // Every INPUTS_* value arrives as a string; `false` is `"false"`, not a boolean.
    expect(settingsFromInputs({ INPUTS_SKIP_PUSH: "true", INPUTS_CYCLE_CAP: "2" })).toEqual({
      skip_push: true,
      cycle_cap: 2,
    });
    expect(settingsFromInputs({ INPUTS_SKIP_PUSH: "false", INPUTS_CYCLE_CAP: "10" })).toEqual({
      skip_push: false,
      cycle_cap: 10,
    });
  });

  test("treats any non-`true` skip_push as false", () => {
    for (const value of ["", "False", "1", "yes", "TRUE"]) {
      expect(settingsFromInputs({ INPUTS_SKIP_PUSH: value }).skip_push).toBe(false);
    }
  });

  test("falls back to 3 for a cycle_cap that is not a usable integer", () => {
    // A `NaN` or `0` cap would make `cycles >= cycle_cap` decide the fixpoint by
    // accident — either never, or before the first cycle finishes.
    for (const value of ["", "0", "-1", "1.5", "two", "3 cycles"]) {
      expect(settingsFromInputs({ INPUTS_CYCLE_CAP: value }).cycle_cap).toBe(3);
    }
    expect(settingsFromInputs({ INPUTS_CYCLE_CAP: "1" }).cycle_cap).toBe(1);
  });
});

describe("ralph-seed run state", () => {
  test("writes a settings.json that readSettings reads back unchanged", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      installTemplates();
      process.env.INPUTS_SKIP_PUSH = "true";
      process.env.INPUTS_CYCLE_CAP = "2";
      try {
        expect(runMain()).toBe(0);
      } finally {
        delete process.env.INPUTS_SKIP_PUSH;
        delete process.env.INPUTS_CYCLE_CAP;
      }

      // The round trip is the contract: the writer and `readSettings` are the
      // two halves of the only channel the cap scripts have.
      expect(readSettings(artifactsDir)).toEqual({ skip_push: true, cycle_cap: 2 });
    });
  });

  test("writes the defaults when no input is set", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      installTemplates();
      expect(runMain()).toBe(0);

      expect(readSettings(artifactsDir)).toEqual({ skip_push: false, cycle_cap: 3 });
      expect(readFileSync(join(artifactsDir, "settings.json"), "utf8")).toEndWith("\n");
    });
  });

  test("records run-start.txt as the repoState listing at the start of the run", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      installTemplates();
      expect(runMain()).toBe(0);

      expect(readFileSync(join(artifactsDir, "run-start.txt"), "utf8")).toBe(repoState());
      // `-` because `withTempRepo` mints a commitless repository: the report
      // reads that as "moved" rather than counting commits from a sha.
      expect(readFileSync(join(artifactsDir, "run-start.txt"), "utf8")).toBe(". -\n");
    });
  });

  test("appends `seed: nothing to archive` on a clean tree", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      installTemplates();
      expect(runMain()).toBe(0);

      expect(outcomeLines(artifactsDir)).toEqual(["seed: nothing to archive"]);
    });
  });

  test("appends the archive directory, trailing slash included, after an archive", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", "old plan\n");
      expect(runMain()).toBe(0);

      // The trailing `/` is what the report's `archived previous cycle to
      // .ralph/<timestamp>/` row prints, so it belongs in the log line.
      expect(outcomeLines(artifactsDir)).toEqual([
        expect.stringMatching(/^seed: archived previous cycle to \.ralph\/\d{8}-\d{6}\/$/),
      ]);
    });
  });

  test("appends, never rewrites, so a second phase keeps the seed row", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      recordRunState(artifactsDir, null);
      recordRunState(artifactsDir, ".ralph/20260917-101500");

      expect(outcomeLines(artifactsDir)).toEqual([
        "seed: nothing to archive",
        "seed: archived previous cycle to .ralph/20260917-101500/",
      ]);
    });
  });

  test("fails before archiving anything when ARTIFACTS_DIR is not set", async () => {
    await withTempRepo(async () => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", "old plan\n");
      delete process.env.ARTIFACTS_DIR;

      expect(runMain()).toBe(1);
      // The previous cycle is still in the tree: a run that cannot record its
      // state must not consume the artifacts it was going to file away.
      expect(readFileSync("IMPLEMENTATION_PLAN.md", "utf8")).toBe("old plan\n");
      expect(existsSync(".ralph")).toBe(false);
    });
  });
});
