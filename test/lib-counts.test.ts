/**
 * The counting path (spec §9). These three functions decide when the build loop
 * stops, so the case that matters most is the exemplar under `## Entry Format`:
 * counted as work, a freshly scaffolded plan never reaches `open == 0` and the
 * loop burns its whole budget on an empty plan.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countItems, computeBudget, planItemsBody } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

const PLAN_TEMPLATE = join(import.meta.dir, "../template/ralph/templates/IMPLEMENTATION_PLAN.md");

describe("planItemsBody", () => {
  test("returns the heading and the text below it", async () => {
    await withTempRepo(() => {
      writeFileSync(
        "IMPLEMENTATION_PLAN.md",
        "# Implementation Plan\n\n## Entry Format\n\n- [ ] **Exemplar**\n\n## Items\n\n- [ ] **Real**\n  Spec: `specs/mock.md` §1\n",
      );

      const body = planItemsBody();

      expect(body).toStartWith("## Items\n");
      expect(body).toContain("- [ ] **Real**");
      expect(body).not.toContain("**Exemplar**");
    });
  });

  test("returns the whole file when the ## Items heading is absent", async () => {
    await withTempRepo(() => {
      const text =
        "# Implementation Plan\n\n- [ ] **Real**\n  Spec: `specs/mock.md` §1\n- [x] **Shipped**\n  Spec: `specs/mock.md` §2\n";
      writeFileSync("IMPLEMENTATION_PLAN.md", text);

      expect(planItemsBody()).toBe(text);
    });
  });

  test("tolerates trailing whitespace on the heading", async () => {
    await withTempRepo(() => {
      writeFileSync(
        "IMPLEMENTATION_PLAN.md",
        "- [ ] **Exemplar**\n## Items  \n- [ ] **Real**\n  Spec: `specs/mock.md` §1\n",
      );

      expect(countItems(planItemsBody(), "[ ]")).toBe(1);
    });
  });

  test("reads the path it is given", async () => {
    await withTempRepo(({ root }) => {
      const path = join(root, "OTHER_PLAN.md");
      writeFileSync(path, "## Items\n- [x] **Shipped**\n  Spec: `specs/mock.md` §1\n");

      expect(countItems(planItemsBody(path), "[x]")).toBe(1);
    });
  });

  test("counts nothing in a freshly scaffolded plan", async () => {
    await withTempRepo(() => {
      copyFileSync(PLAN_TEMPLATE, "IMPLEMENTATION_PLAN.md");

      const body = planItemsBody();

      expect(countItems(body, "[ ]")).toBe(0);
      expect(countItems(body, "[x]")).toBe(0);
      expect(countItems(body, "[~]")).toBe(0);
    });
  });
});

describe("countItems", () => {
  const body = [
    "## Items",
    "",
    "- [ ] **Open one**",
    "  Spec: `specs/mock.md` §1",
    "- [ ] **Open two**",
    "  Spec: `specs/mock.md` §2",
    "- [x] **Shipped**",
    "  Spec: `specs/mock.md` §3",
    "- [~] **Superseded**",
    "  Spec: `specs/mock.md` §4",
    "  - [ ] **Indented open**",
    "\t- [x] **Tabbed shipped**",
    "Prose mentioning - [ ] mid-line",
    "",
  ].join("\n");

  test("counts each marker at column zero", async () => {
    await withTempRepo(() => {
      expect(countItems(body, "[ ]")).toBe(2);
      expect(countItems(body, "[x]")).toBe(1);
      expect(countItems(body, "[~]")).toBe(1);
    });
  });

  test("ignores an indented or mid-line marker", async () => {
    await withTempRepo(() => {
      // Nesting one item under another is how a plan hides work from the cap
      // scripts, so an indented marker must never count.
      expect(countItems("  - [ ] **Indented**\n\t- [ ] **Tabbed**\n", "[ ]")).toBe(0);
      expect(countItems("see - [x] **Shipped** above\n", "[x]")).toBe(0);
    });
  });

  test("returns 0 for an empty body", async () => {
    await withTempRepo(() => {
      expect(countItems("", "[ ]")).toBe(0);
    });
  });
});

describe("computeBudget", () => {
  test("gives ralph's ceil(open x 1.2), and 1 for an empty plan", async () => {
    await withTempRepo(() => {
      expect(computeBudget(0)).toBe(1);
      expect(computeBudget(1)).toBe(2);
      expect(computeBudget(5)).toBe(6);
      expect(computeBudget(10)).toBe(12);
    });
  });

  test("never returns 0, so the loop always runs once", async () => {
    await withTempRepo(() => {
      expect(computeBudget(-1)).toBe(1);
    });
  });
});
