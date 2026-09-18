/**
 * `ralph-guard`'s two verdicts (spec §9).
 *
 * The node carries the whole weight of §4.3: `until_bash` cannot fail its own
 * node, so a build that pushed into a rejection and a review that un-ticked a
 * shipped item both end with `abort.txt` written and the loop *completed*. If
 * this script exits 0 on a present marker, the lifecycle reports success over a
 * run that destroyed work — which is why the exit code is asserted alongside
 * the text, and why the text has to reach stderr where a workflow log shows it.
 */

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../template/scripts/ralph-guard.ts";
import { withTempRepo } from "./helpers.ts";

/** The two marker texts of §4.3, as their cap scripts write them. */
const PUSH_ABORT =
  "build: push rejected\nTo /tmp/origin.git\n ! [rejected] main -> main (fetch first)\n";
const REVIEW_ABORT =
  "review: reduced the shipped item count from 9 to 7; review may never un-tick an item. " +
  "Restore IMPLEMENTATION_PLAN.md before re-running.\n";

/** `main()` with both streams captured. */
function runMain(env?: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string } {
  const { log, error } = console;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    const code = env === undefined ? main() : main(env);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("ralph-guard", () => {
  test("exits 0 when no marker exists", async () => {
    await withTempRepo(async () => {
      const { code, stderr } = runMain();
      expect(code).toBe(0);
      // Nothing on stderr on the clean path: this node runs twice per cycle and
      // an operator scanning the log for its output should find only aborts.
      expect(stderr).toBe("");
    });
  });

  test("exits 1 and prints a rejected push to stderr", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeFileSync(join(artifactsDir, "abort.txt"), PUSH_ABORT);

      const { code, stderr } = runMain();
      expect(code).toBe(1);
      // The whole marker, not just its first line: the report prints the first
      // line, so git's own rejection reason only ever surfaces here.
      expect(stderr).toBe(PUSH_ABORT.trimEnd());
    });
  });

  test("exits 1 and prints a review un-tick to stderr", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      writeFileSync(join(artifactsDir, "abort.txt"), REVIEW_ABORT);

      const { code, stderr } = runMain();
      expect(code).toBe(1);
      expect(stderr).toContain("never un-tick an item");
    });
  });

  test("leaves the marker in place for the report", async () => {
    await withTempRepo(async ({ artifactsDir }) => {
      const marker = join(artifactsDir, "abort.txt");
      writeFileSync(marker, PUSH_ABORT);

      expect(runMain().code).toBe(1);
      // The build block and the review block each declare a `guard`, so one
      // cycle runs this script twice — composed, `review__guard` after
      // `build__guard` (§12.3) — and `ralph-report` reads the file last. A
      // guard that cleared it would make the run fail once and then report
      // clean.
      expect(runMain().code).toBe(1);
      expect(Bun.file(marker).size).toBeGreaterThan(0);
    });
  });

  test("exits 1 when ARTIFACTS_DIR is not set", async () => {
    await withTempRepo(async () => {
      // Fail closed: an unset directory means the marker cannot be looked for,
      // and "no marker found" is not the same claim as "no abort happened".
      const { code, stderr } = runMain({});
      expect(code).toBe(1);
      expect(stderr).toContain("ARTIFACTS_DIR");
    });
  });
});
