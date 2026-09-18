/**
 * Every workflow definition's structural invariants (spec §9 and §12.7).
 *
 * Archon resolves `depends_on` and `$<node>.output` by name at run time. A
 * misspelt name is not an error there — the dependent is treated as unsatisfied
 * and *skipped* — so the failure this file exists to catch is a lifecycle that
 * reports success having silently never built anything. Nothing here asserts
 * prose; every assertion is a name the runtime resolves or a key it reads.
 *
 * §12.3 made the three phase workflows entry points in their own right, so the
 * audit runs over every file under `template/workflows/`: a stale id in
 * `ralph-build.yaml` breaks a standalone build that no `ralph-wiggum` run
 * exercises. §12.7 states what that widening costs. `ralph-plan.yaml` declares
 * no `when:` and no `loop_group`, so the §9 assertions that something *exists*
 * become totals over the files, and the assertions naming `seed`, `build` and
 * `review` stay scoped to the one file that declares those ids.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.ts";

const TEMPLATE = join(import.meta.dir, "../template");
const WORKFLOWS = join(TEMPLATE, "workflows");

/** The composing lifecycle: the only file with a `loop_group` and a `seed`. */
const LIFECYCLE = "ralph-wiggum.yaml";

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

/** One parsed workflow file: its node tree, flattened and indexed. */
interface Parsed {
  /** The file name, which every failure message below carries. */
  file: string;
  workflow: unknown;
  topLevel: Yaml[];
  placed: Placed[];
  byId: Map<string, Placed>;
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

function parse(file: string): Parsed {
  const workflow = Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8"));
  const declared = isYaml(workflow) ? workflow["nodes"] : undefined;
  const topLevel = Array.isArray(declared) ? declared.filter(isYaml) : [];
  const placed = place(topLevel);
  const byId = new Map(placed.map((entry) => [entry.id, entry]));
  return { file, workflow, topLevel, placed, byId };
}

const parsed = readdirSync(WORKFLOWS)
  .filter((file) => file.endsWith(".yaml"))
  .sort()
  .map(parse);

const lifecycle = parsed.find((entry) => entry.file === LIFECYCLE);
if (lifecycle === undefined) throw new Error(`${LIFECYCLE} is absent from ${WORKFLOWS}`);

/**
 * True when this node can be skipped: it carries a `when:`, something upstream
 * does, or — for a `loop_group` — some node in its body does. The join rule of
 * §4.3 is owed only to a loop that can be skipped; an unconditional one always
 * leaves its dependents satisfied.
 */
function skippable(byId: Map<string, Placed>, entry: Placed, seen = new Set<string>()): boolean {
  if (seen.has(entry.id)) return false;
  seen.add(entry.id);
  if (typeof entry.node["when"] === "string") return true;
  const upstream = [
    ...bodyOf(entry.node).map((child) => String(child["id"])),
    ...strings(entry.node["depends_on"]),
  ];
  return upstream.some((id) => {
    const parent = byId.get(id);
    return parent !== undefined && skippable(byId, parent, seen);
  });
}

/** True when a dependency of this node is a loop that can be skipped. */
function followsSkippableLoop(byId: Map<string, Placed>, entry: Placed): boolean {
  return strings(entry.node["depends_on"]).some((dep) => {
    const parent = byId.get(dep);
    return parent !== undefined && loopOf(parent.node) !== null && skippable(byId, parent);
  });
}

describe("the workflow definitions", () => {
  test("every file under template/workflows/ parses into a node tree", async () => {
    await withTempRepo(() => {
      // §12.5 names four files. A `readdirSync` that matched nothing, or a
      // glob that lost the phase workflows, would leave every assertion below
      // iterating an empty list and auditing nothing.
      expect(parsed.length).toBeGreaterThanOrEqual(4);
      expect(parsed.map((entry) => entry.file)).toContain(LIFECYCLE);

      for (const { file, workflow, topLevel, placed, byId } of parsed) {
        expect({ file, parses: isYaml(workflow) }).toEqual({ file, parses: true });
        expect({ file, nodes: topLevel.length > 0 }).toEqual({ file, nodes: true });

        // Ids are how `depends_on` and `$<node>.output` resolve, so a duplicate
        // or a missing one makes every reference to it ambiguous.
        expect({ file, ids: byId.size }).toEqual({ file, ids: placed.length });
        expect(
          placed
            .filter((entry) => typeof entry.node["id"] !== "string")
            .map((entry) => `${file}: ${entry.id}`),
        ).toEqual([]);
      }
    });
  });

  test("the walk descends into the cycle body", async () => {
    await withTempRepo(() => {
      // More placed nodes than top-level ones proves the walk entered the
      // `loop_group` body. Were `bodyOf` to return nothing, every assertion
      // here would pass over the outer nodes and audit nothing. §12.7: the
      // lifecycle is the only file with a body to descend into, so it is the
      // only file that can prove the descent happened.
      expect(lifecycle.placed.length).toBeGreaterThan(lifecycle.topLevel.length);
      expect(lifecycle.placed.map((entry) => entry.id)).toContain("build");
    });
  });

  test("every depends_on entry names a node in the same scope", async () => {
    await withTempRepo(() => {
      for (const { file, placed } of parsed) {
        const edges = placed.flatMap((entry) =>
          strings(entry.node["depends_on"]).map((dep) => ({ entry, dep })),
        );

        expect({ file, edges: edges.length > 0 }).toEqual({ file, edges: true });
        expect(
          edges
            .filter(({ entry, dep }) => !entry.siblings.includes(dep))
            .map(({ entry, dep }) => `${file}: ${entry.id} → ${dep}`),
        ).toEqual([]);
      }
    });
  });

  test("every $<node>.output reference names a node in scope", async () => {
    await withTempRepo(() => {
      const refs = parsed.flatMap(({ file, placed }) =>
        placed.flatMap((entry) => {
          const loop = loopOf(entry.node);
          const texts = [entry.node["when"], loop === null ? undefined : loop["until_bash"]];
          return texts
            .filter((text): text is string => typeof text === "string")
            .flatMap((text) =>
              [...text.matchAll(OUTPUT_REF)].map((match) => ({ file, entry, ref: String(match[1]) })),
            );
        }),
      );

      // The `when:` guards of the build and review blocks are the whole reason
      // this check exists: a stale id there reads as an unsatisfied guard and
      // skips the phase, which is indistinguishable from a legitimate skip.
      // The count is a total because `ralph-plan.yaml` declares no guard.
      expect(refs.length).toBeGreaterThan(0);
      expect(
        refs
          .filter(({ entry, ref }) => !entry.visible.includes(ref))
          .map(({ file, entry, ref }) => `${file}: ${entry.id} → ${ref}`),
      ).toEqual([]);
    });
  });

  test("every loop declares until_bash and max_iterations and no until", async () => {
    await withTempRepo(() => {
      const loops = parsed.flatMap(({ file, placed }) =>
        placed.flatMap((entry) => {
          const loop = loopOf(entry.node);
          return loop === null ? [] : [{ at: `${file}: ${entry.id}`, loop }];
        }),
      );

      expect(loops.length).toBeGreaterThan(0);
      for (const { at, loop } of loops) {
        expect({ at, until_bash: typeof loop["until_bash"] }).toEqual({ at, until_bash: "string" });
        // Without a ceiling a non-converging cap script loops forever; §3.4
        // retired the `until:` sentinels, and a leftover one would stop a loop
        // on a phrase in the agent's prose instead of on the cap's verdict.
        const max_iterations = typeof loop["max_iterations"];
        expect({ at, max_iterations }).toEqual({ at, max_iterations: "number" });
        expect({ at, until: loop["until"] }).toEqual({ at, until: undefined });
      }
    });
  });

  test("every node after a skippable loop joins with all_done", async () => {
    await withTempRepo(() => {
      const following = parsed.flatMap(({ file, placed, byId }) =>
        placed
          .filter((entry) => followsSkippableLoop(byId, entry))
          .map((entry) => ({ at: `${file}: ${entry.id}`, node: entry.node })),
      );

      // The rule is owed only to a loop that can be skipped, so the check
      // below is vacuous unless some loop is. A total stands in for the literal
      // node list §9 used to name: the phase files each guard their own loop,
      // so the same shape now appears four times over with different ids.
      expect(following.length).toBeGreaterThan(0);
      expect(
        following.filter(({ node }) => node["trigger_rule"] !== "all_done").map(({ at }) => at),
      ).toEqual([]);
    });
  });

  test("build and review declare no trigger_rule", async () => {
    await withTempRepo(() => {
      for (const id of ["build", "review"]) {
        const entry = lifecycle.byId.get(id);
        expect(entry).toBeDefined();
        // §3.1: a false guard must skip the phase itself. A join rule here
        // would run the phase the guard just excluded.
        const trigger_rule = entry?.node["trigger_rule"];
        expect({ id, trigger_rule }).toEqual({ id, trigger_rule: undefined });
      }
    });
  });

  test("seed declares no always_run", async () => {
    await withTempRepo(() => {
      const seed = lifecycle.byId.get("seed");
      expect(seed).toBeDefined();
      // §12.2: `always_run` is a resume-cache opt-out, and a resume re-executes
      // the node and invalidates every dependent's cached output. On `seed`
      // that archives the plan the resume was resuming and replans from an
      // empty one, so the archive-and-scaffold side effect opts back in.
      expect({ id: "seed", always_run: seed?.node["always_run"] }).toEqual({
        id: "seed",
        always_run: undefined,
      });

      // The exception is `seed` alone: every other side-effecting exec node
      // still declares it, in every file, so this is a considered omission and
      // not a lost key. §12.7 keeps `precondition` off the list everywhere —
      // it writes nothing, so its verdict may come from the resume cache.
      for (const { file, placed } of parsed) {
        const optedOut = placed
          .filter((entry) => typeof entry.node["script"] === "string")
          .filter((entry) => entry.node["always_run"] !== true)
          .map((entry) => entry.id)
          .sort();
        const expected = file === LIFECYCLE ? ["precondition", "seed"] : ["precondition"];
        expect({ file, optedOut }).toEqual({ file, optedOut: expected });
      }
    });
  });

  test("every script names a file under template/scripts/", async () => {
    await withTempRepo(() => {
      for (const { file, placed } of parsed) {
        const scripts = placed.flatMap((entry) => {
          const script = entry.node["script"];
          return typeof script === "string" ? [{ id: entry.id, script }] : [];
        });

        expect({ file, scripts: scripts.length > 0 }).toEqual({ file, scripts: true });
        expect(
          scripts
            .filter(({ script }) => !existsSync(resolve("scripts", script, ".ts")))
            .map(({ id, script }) => `${file}: ${id} → ${script}`),
        ).toEqual([]);
      }
    });
  });

  test("every loop command names a file under template/commands/", async () => {
    await withTempRepo(() => {
      const commands = parsed.flatMap(({ file, placed }) =>
        placed.flatMap((entry) => {
          const command = loopOf(entry.node)?.["command"];
          return typeof command === "string" ? [{ file, id: entry.id, command }] : [];
        }),
      );

      // A total: the lifecycle's `cycle` node is a `loop_group` with no command
      // of its own, so a per-file count would assert the wrong thing there.
      expect(commands.length).toBeGreaterThan(0);
      expect(
        commands
          .filter(({ command }) => !existsSync(resolve("commands", command, ".md")))
          .map(({ file, id, command }) => `${file}: ${id} → ${command}`),
      ).toEqual([]);
    });
  });
});
