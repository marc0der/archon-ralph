/**
 * The loop prompts' token invariants (spec §9).
 *
 * `template/commands/` is a downstream copy of ralph's `prompts/`, and §6 lists
 * the only substitutions this fork may carry. Nothing here asserts prose — by
 * ralph's convention no test does — but every token below marks a divergence
 * that would go unnoticed otherwise: a leftover `{{GOAL}}` reaches the agent
 * verbatim, a leftover `PLAN_STABLE` is a sentinel no loop reads any more, and
 * a missing `source:` line loses the baseline the next port diffs against.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.ts";

const COMMANDS = join(import.meta.dir, "../template/commands");
const NAMES = ["ralph-plan.md", "ralph-build.md", "ralph-review.md"];

const prompts = NAMES.map((name) => ({ name, text: readFileSync(join(COMMANDS, name), "utf8") }));

/** The prompts holding `token`, named so a failure says which file carries it. */
function holding(token: string): string[] {
  return prompts.filter(({ text }) => text.includes(token)).map(({ name }) => name);
}

describe("the loop prompts", () => {
  test("are exactly the three files, with no ralph-report.md", async () => {
    await withTempRepo(() => {
      // §3 retired the report *prompt*; `ralph-report` is an exec node now. A
      // stale copy here would still be a legal `loop.command` target.
      expect(existsSync(join(COMMANDS, "ralph-report.md"))).toBe(false);
      expect(readdirSync(COMMANDS).sort()).toEqual([...NAMES].sort());
    });
  });

  test("carry no fork-local substitution tokens", async () => {
    await withTempRepo(() => {
      // Archon substitutes neither, and §3.4 retired both sentinels: each of
      // these reaches the agent as literal text telling it to do nothing.
      for (const token of ["{{GOAL}}", "{{WORKSPACE}}", "<promise>", "PLAN_STABLE", "PLAN_COMPLETE"]) {
        expect({ token, in: holding(token) }).toEqual({ token, in: [] });
      }
    });
  });

  test("carry no subagent-fanout instructions", async () => {
    await withTempRepo(() => {
      // Fork-local additions upstream never had. `50 parallel` subagents in a
      // loop Archon already iterates is a cost multiplier, not throughput.
      for (const token of ["dev-browser", "50 parallel"]) {
        expect({ token, in: holding(token) }).toEqual({ token, in: [] });
      }
    });
  });

  test("take the goal in ralph-plan.md alone", async () => {
    await withTempRepo(() => {
      // Only the plan phase reads the run's goal. `$ARGUMENTS` in a goal-less
      // prompt expands to nothing and reads as an empty instruction.
      expect(holding("$ARGUMENTS")).toEqual(["ralph-plan.md"]);
    });
  });

  test("anchor the workspace root on pwd", async () => {
    await withTempRepo(() => {
      // §6: the prompts resolve the root themselves, because whether Archon
      // substitutes into a `loop.command` is unverified. Without the anchor a
      // prompt names a root it has no way to know.
      expect(holding("Run `pwd` once")).toEqual(NAMES);
    });
  });

  test("record the ralph baseline they were ported from", async () => {
    await withTempRepo(() => {
      // The `source:` line is what `git -C ../ralph show <sha>:prompts/<x>.md`
      // diffs against. Drop it and the next port has no baseline.
      expect(holding("source: marc0der/ralph@36e8c8b")).toEqual(NAMES);
    });
  });
});
