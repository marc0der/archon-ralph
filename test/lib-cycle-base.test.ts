/**
 * The cycle base (spec §4.2): the `repoState()` listing review diffs the
 * cycle's changes against. A base rewritten by the second build would hide
 * the first build's commits from review, so the write-once rule is the case
 * that matters.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CYCLE_BASE, repoState, writeCycleBase } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

describe("writeCycleBase", () => {
  test("writes repoState() and creates .ralph/ when the base is absent", async () => {
    await withTempRepo(() => {
      expect(existsSync(".ralph")).toBe(false);

      expect(writeCycleBase()).toBe(true);

      expect(CYCLE_BASE).toBe(".ralph/cycle-base");
      expect(readFileSync(CYCLE_BASE, "utf8")).toBe(repoState());
      expect(repoState()).toBe(". -\n");
    });
  });

  test("a second call returns false and leaves the base byte for byte", async () => {
    await withTempRepo(() => {
      const handWritten = "./svc 0123456789abcdef0123456789abcdef01234567\n";
      expect(writeCycleBase()).toBe(true);
      writeFileSync(CYCLE_BASE, handWritten);

      expect(writeCycleBase()).toBe(false);

      expect(readFileSync(CYCLE_BASE, "utf8")).toBe(handWritten);
    });
  });
});
