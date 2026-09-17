/**
 * The workflow definition's structural invariants (spec §9).
 *
 * Archon resolves `depends_on` and `$<node>.output` by name at run time. A
 * misspelt name is not an error there — the dependent is treated as unsatisfied
 * and *skipped* — so the failure this file exists to catch is a lifecycle that
 * reports success having silently never built anything. Nothing here asserts
 * prose; every assertion is a name the runtime resolves or a key it reads.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.ts";

const TEMPLATE = join(import.meta.dir, "../template");
const WORKFLOW = join(TEMPLATE, "workflows/ralph-wiggum.yaml");

/** Where a `script:` or a `loop.command` resolves to. Archon omits the suffix. */
function resolve(dir: string, name: string, suffix: string): string {
  return join(TEMPLATE, dir, name.endsWith(suffix) ? name : `${name}${suffix}`);
}

/** `$<node>.output...` in a `when:` expression or an `until_bash` command. */
const OUTPUT_REF = /\$([A-Za-z0-9_-]+)\.output/g;

type Yaml = Record<string, unknown>;

/** A node paired with the ids it may legally name. */
interface Placed {
  id: string;
  node: Yaml;
  /** The ids declared alongside it: what its `depends_on` may name. */
  siblings: string[];
  /** `siblings`, every enclosing scope's ids, and its own `loop_group` body's. */
  visible: string[];
}

function isYaml(value: unknown): value is Yaml {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** The body of a `loop_group:`, or an empty list for any other node. */
function bodyOf(node: Yaml): Yaml[] {
  const group = node["loop_group"];
  const nodes = isYaml(group) ? group["nodes"] : undefined;
  return Array.isArray(nodes) ? nodes.filter(isYaml) : [];
}

/** The `loop:` or `loop_group:` block of a node, or `null` for a plain node. */
function loopOf(node: Yaml): Yaml | null {
  for (const key of ["loop", "loop_group"]) {
    const block = node[key];
    if (isYaml(block)) return block;
  }
  return null;
}

/**
 * Flatten the node tree, recording each node's scope as it goes.
 *
 * A `loop_group` body is its own scope: `depends_on` inside it names a sibling
 * in the body, never the group. The group's own `until_bash` runs after each
 * body iteration, so the body's ids are visible to it as well.
 */
function place(nodes: Yaml[], enclosing: string[] = []): Placed[] {
  const siblings = nodes.map((node) => String(node["id"]));
  const outer = [...enclosing, ...siblings];
  return nodes.flatMap((node) => {
    const body = bodyOf(node);
    const visible = [...outer, ...body.map((child) => String(child["id"]))];
    return [{ id: String(node["id"]), node, siblings, visible }, ...place(body, outer)];
  });
}

const workflow = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8"));
const declared = isYaml(workflow) ? workflow["nodes"] : undefined;
const topLevel = Array.isArray(declared) ? declared.filter(isYaml) : [];
const placed = place(topLevel);
const byId = new Map(placed.map((entry) => [entry.id, entry]));

/**
 * True when this node can be skipped: it carries a `when:`, something upstream
 * does, or — for a `loop_group` — some node in its body does. The join rule of
 * §4.3 is owed only to a loop that can be skipped; an unconditional one always
 * leaves its dependents satisfied.
 */
function skippable(entry: Placed, seen = new Set<string>()): boolean {
  if (seen.has(entry.id)) return false;
  seen.add(entry.id);
  if (typeof entry.node["when"] === "string") return true;
  const upstream = [
    ...bodyOf(entry.node).map((child) => String(child["id"])),
    ...strings(entry.node["depends_on"]),
  ];
  return upstream.some((id) => {
    const parent = byId.get(id);
    return parent !== undefined && skippable(parent, seen);
  });
}

describe("the workflow definition", () => {
  test("parses into a node tree the walk descends into", async () => {
    await withTempRepo(() => {
      expect(isYaml(workflow)).toBe(true);
      // More placed nodes than top-level ones proves the walk entered the
      // `loop_group` body. Were `bodyOf` to return nothing, every assertion
      // below would pass over the six outer nodes and audit nothing.
      expect(topLevel.length).toBeGreaterThan(0);
      expect(placed.length).toBeGreaterThan(topLevel.length);
      expect(placed.map((entry) => entry.id)).toContain("build");

      // Ids are how `depends_on` and `$<node>.output` resolve, so a duplicate
      // or a missing one makes every reference to it ambiguous.
      expect(byId.size).toBe(placed.length);
      expect(placed.filter((entry) => typeof entry.node["id"] !== "string")).toEqual([]);
    });
  });

  test("every depends_on entry names a node in the same scope", async () => {
    await withTempRepo(() => {
      const edges = placed.flatMap((entry) =>
        strings(entry.node["depends_on"]).map((dep) => ({ entry, dep })),
      );

      expect(edges.length).toBeGreaterThan(0);
      expect(
        edges
          .filter(({ entry, dep }) => !entry.siblings.includes(dep))
          .map(({ entry, dep }) => `${entry.id} → ${dep}`),
      ).toEqual([]);
    });
  });

  test("every $<node>.output reference names a node in scope", async () => {
    await withTempRepo(() => {
      const refs = placed.flatMap((entry) => {
        const loop = loopOf(entry.node);
        const texts = [entry.node["when"], loop === null ? undefined : loop["until_bash"]];
        return texts
          .filter((text): text is string => typeof text === "string")
          .flatMap((text) =>
            [...text.matchAll(OUTPUT_REF)].map((match) => ({ entry, ref: String(match[1]) })),
          );
      });

      // The two `when:` guards of the cycle body are the whole reason this
      // check exists: a stale id there reads as an unsatisfied guard and skips
      // the phase, which is indistinguishable from a legitimate skip.
      expect(refs.length).toBeGreaterThan(0);
      expect(
        refs
          .filter(({ entry, ref }) => !entry.visible.includes(ref))
          .map(({ entry, ref }) => `${entry.id} → ${ref}`),
      ).toEqual([]);
    });
  });

  test("every loop declares until_bash and max_iterations and no until", async () => {
    await withTempRepo(() => {
      const loops = placed.flatMap((entry) => {
        const loop = loopOf(entry.node);
        return loop === null ? [] : [{ id: entry.id, loop }];
      });

      expect(loops.length).toBeGreaterThan(0);
      for (const { id, loop } of loops) {
        expect({ id, until_bash: typeof loop["until_bash"] }).toEqual({ id, until_bash: "string" });
        // Without a ceiling a non-converging cap script loops forever; §3.4
        // retired the `until:` sentinels, and a leftover one would stop a loop
        // on a phrase in the agent's prose instead of on the cap's verdict.
        const max_iterations = typeof loop["max_iterations"];
        expect({ id, max_iterations }).toEqual({ id, max_iterations: "number" });
        expect({ id, until: loop["until"] }).toEqual({ id, until: undefined });
      }
    });
  });

  test("every node after a skippable loop joins with all_done", async () => {
    await withTempRepo(() => {
      const joining = placed
        .filter((entry) => entry.node["trigger_rule"] === "all_done")
        .map((entry) => entry.id)
        .sort();

      // The four nodes spec §9 names. `counts-pre-review` is in the list and
      // `cycle` is not, which is why the structural rule below is stated over
      // loops that can be skipped rather than over every loop.
      expect(joining).toEqual(["build-guard", "counts-pre-review", "report", "review-guard"]);

      const missing = placed.filter((entry) => {
        const followsSkippableLoop = strings(entry.node["depends_on"]).some((dep) => {
          const parent = byId.get(dep);
          return parent !== undefined && loopOf(parent.node) !== null && skippable(parent);
        });
        return followsSkippableLoop && entry.node["trigger_rule"] !== "all_done";
      });

      expect(missing.map((entry) => entry.id)).toEqual([]);
    });
  });

  test("build and review declare no trigger_rule", async () => {
    await withTempRepo(() => {
      for (const id of ["build", "review"]) {
        const entry = byId.get(id);
        expect(entry).toBeDefined();
        // §3.1: a false guard must skip the phase itself. A join rule here
        // would run the phase the guard just excluded.
        const trigger_rule = entry?.node["trigger_rule"];
        expect({ id, trigger_rule }).toEqual({ id, trigger_rule: undefined });
      }
    });
  });

  test("every script names a file under template/scripts/", async () => {
    await withTempRepo(() => {
      const scripts = placed.flatMap((entry) => {
        const script = entry.node["script"];
        return typeof script === "string" ? [{ id: entry.id, script }] : [];
      });

      expect(scripts.length).toBeGreaterThan(0);
      expect(
        scripts
          .filter(({ script }) => !existsSync(resolve("scripts", script, ".ts")))
          .map(({ id, script }) => `${id} → ${script}`),
      ).toEqual([]);
    });
  });

  test("every loop command names a file under template/commands/", async () => {
    await withTempRepo(() => {
      const commands = placed.flatMap((entry) => {
        const command = loopOf(entry.node)?.["command"];
        return typeof command === "string" ? [{ id: entry.id, command }] : [];
      });

      expect(commands.length).toBeGreaterThan(0);
      expect(
        commands
          .filter(({ command }) => !existsSync(resolve("commands", command, ".md")))
          .map(({ id, command }) => `${id} → ${command}`),
      ).toEqual([]);
    });
  });
});
