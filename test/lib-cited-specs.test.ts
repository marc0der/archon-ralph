/**
 * The anchor set (spec-anchored-review §7). `citedSpecs` decides the fourth
 * review guard term, so a rule that over-matches starts an audit with no
 * specification to measure against, and one that under-matches skips review on
 * a well-anchored plan. These cases pin the token rules of §4: the `Spec:`
 * field match, and the whole non-space, non-backtick token.
 */

import { describe, expect, test } from "bun:test";
import { citedSpecs } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

describe("citedSpecs", () => {
  test("returns the distinct paths the items cite", async () => {
    await withTempRepo(() => {
      const body = [
        "## Items",
        "",
        "- [ ] **Open one**",
        "  Spec: `specs/alpha.md` §4",
        "",
        "- [x] **Shipped one**",
        "  Spec: `specs/beta.md` item 3",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual(["specs/alpha.md", "specs/beta.md"]);
    });
  });

  test("ignores a specs/ path in a Files: line", async () => {
    await withTempRepo(() => {
      const body = [
        "## Items",
        "",
        "- [ ] **Amend the spec**",
        "  Spec: `AGENTS.md verification gate`",
        "  Files: `specs/alpha.md`, `test/alpha.test.ts`",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual([]);
    });
  });

  test("ignores a specs/ path in a Steps line", async () => {
    await withTempRepo(() => {
      const body = [
        "## Items",
        "",
        "- [ ] **Port the prompt**",
        "  Steps:",
        "  1. Read `specs/alpha.md` before editing.",
        "  2. Leave the Spec: field of every item alone.",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual([]);
      // `Spec:` is the whole first field and not a prefix of it: a backtick
      // binds no tighter than any other character before the split.
      expect(citedSpecs("  Spec:`specs/alpha.md`\n")).toEqual([]);
    });
  });

  test("excludes an AGENTS.md and a CLAUDE.md verification gate", async () => {
    await withTempRepo(() => {
      const body = [
        "## Items",
        "",
        "- [ ] **Run the verification gate**",
        "  Spec: `AGENTS.md verification gate`",
        "",
        "- [ ] **Run the verification gate downstream**",
        "  Spec: `CLAUDE.md verification gate`",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual([]);
    });
  });

  test("excludes a rule-file citation", async () => {
    await withTempRepo(() => {
      // A `Minor` finding cites the rule file plus the rule name. No such
      // token holds `specs/`, so the token rule excludes it with no case of
      // its own — unless the project puts its rules under `specs/`, the
      // widening §3 accepts.
      const body = '- [ ] **Rename the fixture**\n  Spec: `.rules/naming.md` rule "kebab-case"\n';

      expect(citedSpecs(body)).toEqual([]);
    });
  });

  test("deduplicates two items citing one spec", async () => {
    await withTempRepo(() => {
      const body = [
        "## Items",
        "",
        "- [ ] **Open one**",
        "  Spec: `specs/alpha.md` §4",
        "",
        "- [x] **Shipped one**",
        "  Spec: `specs/alpha.md` §7",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual(["specs/alpha.md"]);
    });
  });
});
