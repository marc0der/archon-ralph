/**
 * The anchor set (spec-anchored-review §7). `citedSpecs` decides the fourth
 * review guard term, so a rule that over-matches starts an audit with no
 * specification to measure against, and one that under-matches skips review on
 * a well-anchored plan. These cases pin the token rules of §4 — the `Spec:`
 * field match, and the whole non-space, non-backtick token — their byte order,
 * and the body the rules run over.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { citedSpecs, planItemsBody } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

const PLAN_TEMPLATE = join(import.meta.dir, "../template/ralph/templates/IMPLEMENTATION_PLAN.md");

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

  test("keeps a nested repository's specs path distinct", async () => {
    await withTempRepo(() => {
      // A path is a whole token, never a substring, so the workspace root's
      // spec and a nested repository's same-named spec are two anchors.
      const body = [
        "## Items",
        "",
        "- [ ] **Root item**",
        "  Spec: `specs/x.md` §4",
        "",
        "- [ ] **Nested item**",
        "  Spec: `source/svc/specs/x.md` §4",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual(["source/svc/specs/x.md", "specs/x.md"]);
    });
  });

  test("keeps the comma of a bare two-path Spec field", async () => {
    await withTempRepo(() => {
      // Ralph's behaviour at f6d2405, mirrored deliberately (§4): a comma is
      // no separator, so the same spec counts twice when only one citation
      // carries one.
      const body = [
        "## Items",
        "",
        "- [ ] **Two specs**",
        "  Spec: specs/a.md, specs/b.md",
        "",
        "- [x] **One spec**",
        "  Spec: specs/a.md",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual(["specs/a.md", "specs/a.md,", "specs/b.md"]);
      // Backticks separate tokens, so the quoted form strands the comma on its
      // own and the quirk never fires for a plan following the entry format.
      expect(citedSpecs("  Spec: `specs/a.md`, `specs/b.md`\n")).toEqual([
        "specs/a.md",
        "specs/b.md",
      ]);
    });
  });

  test("returns the paths in byte order", async () => {
    await withTempRepo(() => {
      const body = [
        "## Items",
        "",
        "- [ ] **One**",
        "  Spec: `specs/zeta.md`",
        "",
        "- [ ] **Two**",
        "  Spec: `specs/alpha.md`",
        "",
        "- [ ] **Three**",
        "  Spec: `specs/Alpha.md`",
        "",
      ].join("\n");

      // LC_ALL=C sort, not locale sort: every uppercase byte precedes every
      // lowercase one, which a locale sort interleaves instead.
      expect(citedSpecs(body)).toEqual(["specs/Alpha.md", "specs/alpha.md", "specs/zeta.md"]);
    });
  });

  test("counts a citation under a [~] item", async () => {
    await withTempRepo(() => {
      // Ralph's cited_specs filters no marker, and §4 makes the anchor set
      // mirror it: a superseded item still names a spec worth auditing.
      const body = [
        "## Items",
        "",
        "- [~] **Superseded one**",
        "  Spec: `specs/alpha.md` §4",
        "",
      ].join("\n");

      expect(citedSpecs(body)).toEqual(["specs/alpha.md"]);
    });
  });

  test("ignores the exemplar of a freshly scaffolded plan", async () => {
    await withTempRepo(() => {
      copyFileSync(PLAN_TEMPLATE, "IMPLEMENTATION_PLAN.md");

      expect(citedSpecs(planItemsBody())).toEqual([]);
      // The trap the body argument exists to avoid: read whole, the plan
      // reports one anchor and the review guard opens on an empty plan.
      expect(citedSpecs(readFileSync("IMPLEMENTATION_PLAN.md", "utf8"))).toEqual(["specs/file.md"]);
    });
  });

  test("yields the citations of a plan with no ## Items heading", async () => {
    await withTempRepo(() => {
      writeFileSync(
        "IMPLEMENTATION_PLAN.md",
        "# Implementation Plan\n\n- [x] **Shipped**\n  Spec: `specs/alpha.md` §4\n",
      );

      // planItemsBody falls back to the whole file, which carries no exemplar
      // to exclude when the plan has no ## Entry Format section either.
      expect(citedSpecs(planItemsBody())).toEqual(["specs/alpha.md"]);
    });
  });
});
