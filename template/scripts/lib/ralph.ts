/**
 * The one library every script under `template/scripts/` shares (spec §4.1).
 *
 * Node built-ins only: an installed `.archon/` has no runtime dependencies and
 * `bun install` inside it stays optional.
 */

import { readFileSync } from "node:fs";

/** Ralph's three plan-item markers, as they appear at column zero. */
export type ItemMarker = "[ ]" | "[x]" | "[~]";

// `[ \t\r]*` for ralph's `[[:space:]]*`: a CRLF plan must still match, and in
// JS multiline mode `$` sits after the `\r`, not before it.
const ITEMS_HEADING = /^## Items[ \t\r]*$/m;

/**
 * The part of the plan that holds real items: the `## Items` heading to the end
 * of the file, or the whole file when that heading is absent.
 *
 * **Every count in every script goes through here.** `## Entry Format` carries
 * an exemplar entry at column zero, so counting markers over the whole file
 * reports a freshly scaffolded plan as having one open item — the bug that
 * stops the build loop ever exiting on an exhausted plan. Reading a headingless
 * plan whole keeps older plans counting. Mirrors ralph's `plan_items_body`.
 */
export function planItemsBody(file = "IMPLEMENTATION_PLAN.md"): string {
  const text = readFileSync(file, "utf8");
  const heading = ITEMS_HEADING.exec(text);
  return heading ? text.slice(heading.index) : text;
}

/** Count the items in `body` carrying `marker` at column zero. */
export function countItems(body: string, marker: ItemMarker): number {
  const prefix = `- ${marker}`;
  return body.split("\n").filter((line) => line.startsWith(prefix)).length;
}

/**
 * Ralph's build budget, `ceil(open × 1.2)`, in integer arithmetic.
 *
 * Bit-identical to ralph's `(count * 6 + 4) / 5`; the float form is avoided
 * because 1.2 is not representable in IEEE-754. An empty plan still gets one
 * iteration, so the loop no-ops once rather than dividing into a budget of 0.
 */
export function computeBudget(open: number): number {
  return open < 1 ? 1 : Math.floor((open * 6 + 4) / 5);
}
