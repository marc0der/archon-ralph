# Feature-Chain Outer Loop

`ralph-wiggum` drives one goal to convergence. This spec adds an outer loop that drives it once
per **feature**, where a feature is a markdown file that is a specification in its own right. A
separate process — not ours — writes those files and their metadata. The outer loop reads them,
works out the build order, and runs the inner lifecycle on each in turn, stopping the chain when
one does not converge.

The motivating instance is a service repository of generated `FT-NNN-*.md` files carrying a
`## Metadata` table. That is **one instance**, not the contract. Nothing here names a prefix, a
filename convention or a directory layout.

The decisions below were settled on 2026-09-23. They are recorded with their reasons so the
planning agent does not re-open them. Where this spec and `specs/archon-native-lifecycle.md`
disagree on the inner lifecycle, that spec wins: this one adds a caller, it does not re-design
ralph.

## 1. Model

Three rules, one per layer:

1. **The dependency points one way.** The outer workflow and the adapter know about ralph. Ralph
   knows nothing about features. `ralph-wiggum` must still run standalone on a single goal exactly
   as it does today, and the adapter belongs to the outer concern, not to ralph.
2. **Advance only on `converged`.** Whether the chain proceeds is read from a structured result
   contract, never from an exit code and never from parsing prose. Ralph already refuses to let an
   agent judge its own work (`archon-native-lifecycle.md` §1.2); this extends the same rule one
   layer out, to a *child run* judging its own work. §3.2 is what keeps `converged` from becoming
   a word the review phase never contributed to.
3. **Skipping is data, not failure.** A feature the chain does not build is skipped: the gate
   exits 0 with `ready: false`, `when:` skips the lifecycle, the status record still records the
   outcome, and the child run *succeeds*. This mirrors the idiom ralph already uses internally —
   `when:` on counts, `trigger_rule: all_done` on report.

**The chain halts on the first feature that does not converge.** This supersedes the brief's
decision 7, which said a failed feature skips its transitive dependents *and nothing else*. It
does not change the shape: `fan_out:` spawns every child regardless of any sibling's outcome and
has no early exit (§2), so "halt" cannot mean "stop spawning". It means **stop working**: after a
non-converged feature, every remaining child is a gate script and a seal script — no model calls,
no inner lifecycle — and records why it was not attempted. §4.1 is the mechanism.

The DAG therefore buys *order*, not skip precision: it is what guarantees a feature is attempted
only after everything it builds on, and what makes "the first feature that does not converge" a
meaningful position rather than an accident of walk order.

### Decisions recorded

| Question | Decision |
|----------|----------|
| Shape | `precondition` → `ready` → `features` (`workflow:` fan-out over the adapter) → `tally` |
| Adapter | `gate` → `wiggum` (`include: ralph-wiggum`, `when:`) → `seal`, `returns: seal` |
| Change to ralph | One node: `verdict`, a result contract, selected by `returns:`. Nothing else |
| Where features live | Under a path containing `specs/`. `ready` fails otherwise (§3.2) |
| Halt | Anything but `converged` halts the chain. Remaining features are `skipped`, not attempted |
| Halt marker | `.ralph/halt.txt`, written by `seal`, read by `gate`, cleared by `ready` per run |
| Halt is sticky? | No. The next invocation retries the failed feature; nothing to clear by hand |
| Concurrency | `max_parallel: 1` and `join: all_done`, always. The DAG is for order, not speed |
| Discovery | One required input: a directory, walked recursively for `*.md` |
| Membership | Positive: a `## Metadata` table carrying `Feature ID` **and** `Upstream Features` |
| Edges | Union of `Upstream Features`, `Extends` and reversed `Extended By`, resolved by ID |
| Dangling ID | `ready` fails. Nothing spawns, nothing is spent |
| Cycle | `ready` fails, naming the members, **before** the already-converged exclusion |
| Tiebreak | Kahn's algorithm with the ready set sorted by path in byte order |
| Status record | One map, `.ralph/features.json`, rewritten by `seal` through a temp file and rename |
| Staleness | The record carries the feature file's hash; an edited file is outstanding again |
| Cascade | None. Only the edited feature reverts; its converged dependents stay converged |
| Inner statuses | `converged`, `capped`, `aborted`, `failed`, each with a `detail` line |
| Recorded statuses | The four above plus `skipped`. No separate `halted` status |
| Outer outcome | Red on `aborted`, `failed`, `archon_failed`, or a halt that repeated (§7) |
| Inputs | Only the discovery directory. `skip_push` and `cycle_cap` are not exposed or forwarded |
| Codegen | Rejected. The outer loop has its intelligence at run time |

## 2. Archon facts this spec relies on

Verified on 2026-09-23 against the checkout at `~/git/personal/archon`, commit `b237e9b` on branch
`dev` — an unreleased tree, with `bun.lock` and `package.json` modified. References are into
`packages/workflows/src/` unless stated. An installed `.archon/` runs against whatever `archon`
the operator has, so this list is a snapshot to diff against, in the manner
`archon-native-lifecycle.md` §12.7 set.

- **`workflow:` is rejected inside a `loop_group` body**, fan-out form included
  (`loader.ts:1137`). Self-reference and ancestor cycles are rejected at run time. This is why the
  shape is a fan-out with a gate rather than a loop over a cursor.
- **`fan_out:` spawns every child regardless of outcome.** There is no early exit and no racing
  join. Worst-case spend is `items.length` children, not "until the first failure".
- **`join` defaults to `all_done`** (`schemas/dag-node.ts:900`). Under `all_done` the node
  completes and failed children become marker objects; under `all_success` the first non-completed
  child fails the node and **no aggregate is written at all**. §5.1 declares the default
  explicitly because one word would otherwise delete the summary.
- **`max_parallel` is a sliding window** (`utils/map-with-limit.ts`), not a limit on how many
  children exist. `1` means one in flight at a time, in item order.
- **The shared-checkout refusal is narrower than it reads.** `dag-executor.ts:8492` fires only
  when `node.isolation !== 'worktree' && min(max_parallel, pendingCount) > 1 && the target
  workflow does not declare mutates_checkout: false`. A one-item expansion slips through it at any
  `max_parallel`. **The engine is not the guardrail here** — §4 and §4.1 are why `max_parallel: 1`
  is fixed.
- **`items` must resolve to a JSON array** from an upstream node; an empty array is legal and
  completes the node immediately with `[]` (`dag-executor.ts:8248`).
- **`fan_out.items` accepts a declared field path.** `$ready.output.order` resolves through the
  same substitution as every text surface (`dag-executor.ts:8231`, `output-ref.ts:358`). An
  *undeclared* field throws `not-in-schema` and fails the node closed. No engine test covers the
  fielded form; the mechanism is shared with forms that are tested.
- **`$<fanout>.output` is a JSON array in item order.** Each slot is the child's result value; a
  failed or cancelled child is `{archon_failed: true, error, status}` (`dag-executor.ts:8698`).
  The marker carries **no id, no path and no index** — §5.1 turns on this. Field access on the
  aggregate is an error (`output-ref.ts:234`): consume the whole array in a script node.
- **A child's slot is its `structuredOutput` when it has one, and raw text otherwise**
  (`dag-executor.ts:8608`). §5.2 turns on this.
- **Each item reaches its child as `$ARGUMENTS`.** `fan_out.as` *adds* an `$INPUTS` channel; it
  does not replace that binding. §3.1 turns on this.
- **`workflow:` children get their own run record, artifacts and cost line** (`executor.ts:516`,
  `:1427`). This is what keeps ralph's counters — `cycle-iter.txt`, deliberately never reset —
  from colliding across features. `include:` + `fan_out:` would share one `ARTIFACTS_DIR`.
- **A sub-run's checkout comes from the calling node's `isolation:`**, or a resumed child's
  recorded `working_path` (`executor.ts:1306`). Nothing reads the child workflow's own `worktree:`
  for a sub-run; that field only matters to dispatch surfaces such as a direct CLI invocation.
  §5.2 turns on this.
- **`when:` on an `include:` node is first-class** (`schemas/dag-node.ts:834`,
  `include-expander.ts:806`): it attaches to the block's entry nodes and AND-composes. This makes
  `archon-native-lifecycle.md` §12.7's "an include node declares the structural fields only" stale;
  §11 carries the amendment.
- **`when: "$x.output.ready == true"` is valid for a boolean.** The grammar accepts an unquoted
  `true` and both sides canonicalise to text before `===` (`when-atom.ts:75`,
  `condition-evaluator.ts:130`).
- **`depends_on:` on an `include:` block waits on the block's sinks** (`include-expander.ts:839`),
  and `$blk.output` is rewritten at load to the block's `returns:` node (`:846`, `:1218`).
- **Skipped and failed producers are not the same.** A skipped producer's whole-`$node.output`
  substitution and `when:` both yield `''`; strictness applies to exactly two forms — any
  `.field` access (`output-ref.ts:341`) and a `with: {from: …}` directive with no `if_skipped`
  (`dag-executor.ts:485`). **A *failed* producer fails every one of them, `if_skipped` included**
  (`dag-executor.ts:492`, `output-ref.ts:421`), and a `when:` reading a failed producer throws
  (`condition-evaluator.ts:98`). §6.2 and §6.5 both turn on this.
- **`trigger_rule` alone decides scheduling** (`dag-executor.ts:2011`). `always_run: true` is a
  resume-cache opt-out, not a "run after skip" flag — `archon-native-lifecycle.md` §2 already says
  so, and §5 here says it correctly.
- **Include nesting is capped at 3 levels**, enforced with `>` so exactly three load
  (`include-expander.ts:189`, `:1239`). `ralph-one-feature → ralph-wiggum →
  ralph-{plan,build,review}` is 2 of 3, leaving one level of headroom. The `workflow:` sub-run tree
  is a **separate** cap of 5, applied at run time against run ancestry (`executor.ts:1134`);
  `ralph-features → ralph-one-feature` is 2 of 5.
- **`returns:` is validated only as a non-empty string naming a top-level node** (`loader.ts:1847`,
  `:1870`). It works for any node type, sink or not. The restrictions against selecting a
  `loop_group` or a fan-out node, and the requirement that the selected node declare an
  `output_format`, belong to **`outcome_field:`** and are skipped entirely when it is undefined
  (`loader.ts:171`). §5.2 gives `seal` a schema for a different reason.
- **`returns:` drives the result value only for a child run.** `dag-executor.ts:12081` gates it on
  `parent_run_id`; a top-level run falls back to the positional sink scan. §5.3 turns on this.
- **A `workflow:` node cannot declare `output_format`** — a hard load error naming the child's
  `returns:` node (`loader.ts:1269`).
- **`output_format` on a `script:` node certifies that node's own stdout.** One strict JSON
  document, no fence stripping, no repair, no retry.
- **`worktree:` is dropped from an included file; `provider`, `model` and `sandbox` are stamped
  onto its nodes and survive** (`include-expander.ts:317`, `:327`).
- **Fan-out children are re-keyed by index on resume**, with a
  `workflow.fan_out_item_content_changed` warning when an item differs from what its child was
  spawned with (`dag-executor.ts:8363`). A completed fan-out node is not recomputed (`:11442`).
- **There is no run-tree-wide budget ceiling.** `maxBudgetUsd` is per-node and Claude-only
  (`schemas/dag-node.ts:236`) and is in `WORKFLOW_NODE_IGNORED_FIELDS`, so it does nothing at all
  on a `workflow:` node (`:1109`). The tree-wide ceiling is [#1961]. §8 records what this costs.
- **`outcome_field:` is independent of the CLI exit code**, and a node that exits non-zero authors
  no outcome (`dag-executor.ts:11530`, `cli/src/utils/workflow-exit-code.ts`). §5.1 rejects it on
  that basis.

[#2439]: https://github.com/coleam00/Archon/issues/2439
[#1961]: https://github.com/coleam00/Archon/issues/1961

## 3. The feature graph

### 3.1 The item is a path, and that is forced

`fan_out` binds each item to the child's `$ARGUMENTS`. Ralph's goal *is* `$ARGUMENTS`
(`archon-native-lifecycle.md` §2; `ralph-precondition` requires it in `plan` mode), and `include:`
cannot rebind it — `with:` supplies `$INPUTS`, not the message. So an item cannot be a
`{path, upstreams}` object without the goal becoming a JSON blob.

**Decision.** Items are bare repository-relative paths, one per feature file. This satisfies the
brief's decision 6 for free: the goal handed to the inner loop *is* the feature file path.

The consequence is that `gate` is not handed its own upstreams — it re-parses its own feature file
to find them. That is not a cost worth avoiding: one parser in `lib/`, used by `ready` and `gate`
both, is the arrangement that keeps the two from disagreeing.

### 3.2 Discovery, and why features live under `specs/`

One workflow input, **required, with no default**: the directory to start from. A directoryless
outer run must stop at the first node rather than scan an arbitrary tree, exactly as
`ralph-precondition` refuses a goalless `ralph-wiggum`.

`ready` walks that directory recursively, collecting `*.md`, skipping any entry whose name begins
with `.`, and sorts the result by path in byte order before anything else happens. Sorting first
is what makes every downstream tiebreak deterministic. The walk is the existing `specFiles` helper
in `lib/ralph.ts` generalised over a filter, not a second recursive walk: it already follows
symlinks the way `find -L` does, already orders by byte, and already swallows an unreadable
directory.

**Decision: every emitted path must contain `specs/`, and `ready` fails if any does not.** This is
the load-bearing constraint of the whole spec and it is not cosmetic.

`citedSpecs` (`lib/ralph.ts:66`) keeps a `Spec:` token only `if (token.includes("specs/"))`, and
`ralph-review.yaml`'s guard is `when: "$counts.output.open == 0 && $counts.output.shipped > 0 &&
$counts.output.cited > 0"`. The goal handed to each child is the feature file path (§3.1), so that
path is what the plan agent writes into each item's `Spec:` field. Point the loop at `features/`
and `cited` is 0 on every cycle: the review loop is skipped, `ralph-cycle-cap` sees `open == 0`,
writes `cycle 1: clean — no open items remain`, and `ralph-verdict` reports **`converged`** — for
a feature that was never audited. Twenty features would converge in one cycle each with zero
review passes, and rule 2 of §1 would degenerate into "the build agent ticked every box the plan
agent wrote". The failure is silent, green, and indistinguishable from success.

Requiring the path is the cheap half of the fix and the only half this spec is allowed: the brief
puts the review phase, `citedSpecs` and where specifications live out of scope. It is also
coherent rather than a workaround — the brief's own definition is "a feature is a markdown file
that is a specification in its own right", so `specs/features/` is where one belongs.

*Rejected: widening `citedSpecs` to any cited path.* `spec-anchored-review.md` §3 settled the
anchor as `specs/`, and the review prompt's "read no specification outside the anchor set" rests
on it. *Rejected: leaving the interaction undocumented and letting the operator discover it.* The
symptom is a green run, which is the one symptom nobody investigates.

*Rejected: a glob input.* A glob needs a matcher written against `node:*` — `fs.glob` cannot be
assumed present in the Bun an installed `.archon/` happens to run — and a directory plus positive
membership already excludes everything a glob would.

### 3.3 The metadata contract, and what is not work

The generated instance writes a table:

```markdown
## Metadata

| Field                 | Value                   |
| --------------------- | ----------------------- |
| **Feature ID**        | FT-005                  |
| **Upstream Features** | FT-002, FT-003          |
| **Extends**           | None                    |
| **Extended By**       | FT-008                  |
| **Feature Name**      | Noop sports aggregation |
```

The parse is a line scan, not a markdown parser and not a YAML shim:

- **The scan is scoped to the first markdown table following a `## Metadata` heading** (any
  heading level, matched case-insensitively on the word). A file with no such heading is not work.
- A **field row** is a line whose first non-empty pipe-delimited cell, stripped of whitespace and
  of `*` and `_` emphasis, matches a known field name case-insensitively. *First non-empty*
  matters: `| **Feature ID** | FT-005 |` splits to `["", " **Feature ID** ", " FT-005 ", ""]`, so
  the field name is the second element. A table written without leading pipes parses the same way.
  A header separator row matches no field name and is dropped by the same rule.
- The **value** is the next non-empty cell. It splits on `,`; each part is trimmed and stripped of
  backticks, emphasis, and a surrounding markdown link wrapper — `[FT-002](./FT-002.md)` yields
  the link *text*, `FT-002`, because the text is what the generator writes as the ID. Empty parts
  and the literal `none` (case-insensitive) are dropped.

**Scoping to the heading is a reversal**, recorded as such. An unscoped scan cannot honour the
claim that a table elsewhere in the file contributes nothing: a `features/README.md` documenting
the metadata contract by showing the very table above would parse as a feature with ID `FT-005`,
and would then collide with the real `FT-005` and fail `ready` on a well-formed directory. The
generator already emits the heading, so the cost is nil.

**Membership is positive.** A file is a feature — is *work* — only if its `## Metadata` table
carries both a `Feature ID` row and an `Upstream Features` row. An index, a glossary, a template
or a context document carries neither and is invisible. A root feature is visible because the
generator writes `None` rather than omitting the row, which is what makes positive membership
affordable here.

Four parser cases an implementer hits on day one, decided rather than left open:

| Case | Decision |
|---|---|
| Two `Feature ID` rows in one table | `ready` fails, naming the file. Ambiguous identity is not resolvable by a rule |
| `FT-002` vs `ft-002` | IDs are compared case-insensitively and stored upper-cased. Two spellings of one ID are one node, not two, and not a dangling edge |
| Surrounding whitespace in an ID | Trimmed. Interior whitespace is part of the ID |
| A feature listing itself | A self-edge, reported by §3.5's cycle failure as a cycle of one |

The hash of §4 is md5 over the file's bytes, matching `planStateHash`'s existing algorithm in
`lib/ralph.ts`; `at` is an ISO-8601 UTC timestamp.

*Rejected: a heuristic ("no upstream section and no work-shaped content").* It needs no
cooperation from the generator, and it will misfire on some file eventually, at a cost of one
wasted inner run. *Rejected: an explicit `Kind: index` opt-out.* It requires a generator change for
a case positive membership already handles.

### 3.4 Edges

Edges name **IDs**, not paths. **The ID index is built from work files only** — a file is a
*candidate* when §3.3 says it is work, and nothing else contributes an ID. The index comes from
each candidate's own `Feature ID` row, never from the filename: a prefix convention is precisely
the scenario detail this spec must not bake in, and reading the field costs nothing once the table
is parsed.

For a feature `F`, the upstream set is the union of three sources:

| Source | Direction |
|---|---|
| `Upstream Features` | as written |
| `Extends` | as written |
| `Extended By` | reversed: `F` becomes an upstream of each ID listed |

One rule, no field ranked above another, `None` and absent both reading as no edges. `Extends` is
an ordering edge because an extension built before the thing it extends is the exact failure the
DAG exists to prevent, and a generator that records the relation only there would otherwise be
silently mis-ordered. `Extended By` is read rather than discarded as derivable because the union
is cheap and a graph that states an edge in only one direction is still stating it.

**A dangling ID fails `ready`**, and so does an ID claimed only by a discovered file that is *not*
work — the error names that file, because the two cases have different cures and an operator who
is told "unknown ID" will look in the wrong place. An edge naming an ID no discovered file claims
means the graph is wrong or the directory is wrong; an edge naming a non-work file means the
generator omitted `Upstream Features` from something the graph treats as a dependency. Both are
graphs that do not typecheck, both are cheap to be loud about, and nothing has been spawned at
that point.

*Rejected: dropping a dangling edge with a warning* — a feature outside the directory would then
be silently treated as satisfied, and its dependent would build on nothing. *Rejected: treating a
non-work ID as permanently unsatisfiable data* — `gate` would report `FT-008 did not converge`
forever, at exit 0, with no halt marker, on every invocation: a permanently stalled subtree with a
green run. Failure-as-data is the right posture for a feature that did not converge, not for a
graph that does not typecheck.

**A duplicate `Feature ID` across two files fails `ready`** for the same reason: the index would
be ambiguous and which file won would depend on walk order.

### 3.5 Order and cycles

Kahn's algorithm, with the ready set kept sorted by path in byte order at every step. Sorting the
*ready set* rather than only the input makes the emitted order stable across runs even when the
graph admits many valid orders, which is what resume needs (§6.1).

**Cycle detection runs on the whole graph, before the already-converged exclusion of §6.1.** A
cycle wholly among converged features is still a bug in the metadata, and detecting it only when
one of its members happens to be outstanding would make the error appear and disappear with the
state of the run.

Unioning three edge sources makes contradictory pairs reachable. The contradiction is **one
feature declaring both directions for the same pair** — `A` with `Upstream Features: B` *and*
`Extended By: B`, which states B→A and A→B at once. The *redundant* pair — `A` declaring
`Extended By: B` while `B` declares `Upstream Features: A` — is not a contradiction at all: both
clauses produce the edge A→B, the union deduplicates them, and §3.4 explicitly welcomes it. An
implementer who reads the redundant pair as the failing case will write a test that is wrong, so
§9 names both, one as a failure and one as a non-failure.

**`ready` fails and names the cycle's members.** A cycle is a bug in whatever generated the
metadata; building the acyclic remainder would report success over a graph known to be wrong, and
breaking the "weakest" edge automatically would silently build an order nobody authored.

## 4. The status record

Durable per-feature status lives at **`.ralph/features.json`** in the checkout: one JSON object
keyed by feature ID.

```json
{
  "FT-002": { "path": "specs/features/FT-002-ingest.md", "status": "converged",
              "open": 0, "cycles": 1, "detail": "cycle 1: clean — no open items remain",
              "hash": "9f2c…", "attempts": 1, "at": "2026-09-23T10:14:02Z" },
  "FT-003": { "path": "specs/features/FT-003-ledger.md", "status": "capped",
              "open": 4, "cycles": 3, "detail": "cycle 3: reached the cycle cap of 3 …",
              "hash": "1ab7…", "attempts": 2, "at": "2026-09-23T11:02:55Z" },
  "FT-005": { "path": "specs/features/FT-005-agg.md", "status": "skipped",
              "reason": "FT-003 did not converge",
              "hash": "c40e…", "attempts": 1, "at": "…" }
}
```

The key is the ID, and `path` is carried beside it because `tally` prints rows and the fan-out
aggregate is positional and anonymous (§2): a slot on its own names nothing.

**It lives in the checkout, not in `ARTIFACTS_DIR`, and that is load-bearing twice over.**
`ARTIFACTS_DIR` is per-run and per-child, so it cannot carry state between features or between
invocations. But the sharper reason is §2's rule that a fan-out child cannot see its siblings:
mid-expansion there is no `$features.output`, and each child is a separate run. The record is the
*only* channel by which "my predecessor converged" reaches `gate`. That makes `max_parallel: 1`
plus topological item order a correctness requirement, not a politeness about the shared checkout
— which is why §9 pins it.

`.ralph/` is already in `.gitignore` (`ralph-seed.ts` writes the entry), and `ralph-seed`'s
`archive()` moves only the two root-level artifacts into `.ralph/<timestamp>/`. A file sitting
directly under `.ralph/` is untouched by every archive the run performs.

**Being gitignored means "durable" is durable *on that machine*.** A CI job that clones fresh has
no map, so the already-converged exclusion never fires and every invocation pays §8's full bound.
That is the right default — the record is machine state, not a reviewable artifact — but it makes
this loop a thing to run on a persistent checkout, and the README says so.

**Writes.** `seal` reads the map (an absent or unparseable file reads as `{}`), sets its own key,
writes to a temp file in the same directory and `renameSync`s over the target. Serial execution
means there is no contention; the rename is against a child run dying mid-write and leaving a
truncated map that would read as "nothing has ever converged".

**`attempts`** counts consecutive identical outcomes: `seal` sets it to `prev.attempts + 1` when
the record it is replacing has the same `status`, `hash` and `open`, and to `1` otherwise. It is
the only field written for the benefit of a *later* invocation, and §7 is what reads it.

*Rejected: one file per feature.* It avoids the read-modify-write entirely and needs no rename
discipline — but one map is the file an operator opens, diffs and deletes, and the whole-map view
is what `tally` reports from. *Rejected: an append-only log.* History for free, replay on every
read, and no obvious moment to compact.

**Staleness.** Each entry carries a hash of the feature file's bytes. A feature counts as already
done only when its status is `converged` **and** its hash matches the file on disk. That test is
one shared function, applied by `ready` when it builds the order *and* by `gate` when it checks an
upstream — two definitions of "done" is the drift the shared library exists to prevent, and with
only `ready` applying the hash a dependent could build against a `converged` record whose file has
since changed and whose rebuild crashed.

**No cascade.** Only the edited feature reverts. Its converged dependents stay converged, so the
tree can hold a mix of old and new. This is deliberate: cascading would make one whitespace edit
near the root re-run the entire graph, and the review phase is already the mechanism that notices
a tree drifting from its specifications. *Rejected: cascading to transitive dependents* — correct
in principle, ruinous in practice at a full inner run per feature. *Rejected: computing the
invalidated set and failing so the operator re-runs deliberately* — it makes every edit a two-step
ritual.

**One consequence to accept, not solve.** Every child runs `ralph-seed` in `archive` mode, so
feature N's seed archives feature N−1's plan into `.ralph/<timestamp>/`. That is desirable — a
fresh plan per feature, the previous kept — but `ralph-seed.ts` formats the stamp to one-second
granularity and `renameSync`s over an existing directory, so two features archiving in the same
second lose one archive, and nothing ever prunes them. Neither is worth a change to `ralph-seed`
for this loop; both are recorded so the twentieth `.ralph/<timestamp>/` is not a surprise.
`PROGRESS.md` is archived and re-scaffolded per feature for the same reason, so nothing one
feature learns reaches the next. That is the intended isolation, not an oversight.

### 4.1 The halt marker

A second file, **`.ralph/halt.txt`**, holds one line naming the feature that stopped the chain and
what it did — `chain halted at FT-003 (aborted)`. Its existence is the halt; its content is the
reason every subsequent feature records.

| Script | Does |
|---|---|
| `ready` | Unlinks it, once, at the start of each outer run |
| `seal` | Writes it when its feature's status is anything but `converged`, unless it already exists |
| `gate` | Reads it; if it exists, `ready: false` with its line as the reason |

**Why a separate file and not a key in the map.** The map is durable across invocations and the
halt is not: a chain halted by a `capped` feature must be retried by the next run, not blocked
forever. Scoping the halt to one run needs something cleared per run, and `ready` is the only node
that executes exactly once per outer run. A key inside `features.json` would have to be cleared
there anyway, and would make every reader of the map handle a value that is not a feature.

`ready` is not `always_run` (§6.1), so a **resumed** run does not re-execute it and does not clear
the marker. That is the wanted behaviour: a resume continues the run that halted, and the halt
stands until a fresh invocation.

**The residual hole is a child that dies before `seal`.** `seal` is scheduled past a failed
sibling by `trigger_rule: all_done`, but a child killed outright, or one whose `gate` failed, never
writes either the record or the marker — and the next feature's `gate` then finds no marker and
proceeds. §6.2 closes the half of this that is ours to close by making `gate` exit 0 in every
case; the remainder is why §7 reddens an `archon_failed` slot with no record.

*Rejected: stamping each record with a run id and having `gate` ignore records from earlier runs.*
It needs no marker file, but the parent run's id is not reliably available to a child's scripts,
and passing it through `with:` adds a binding whose only job is to scope a boolean.

*Rejected: making the halt sticky until a human clears it.* It would stop an unattended scheduler
re-spending on a feature that fails identically every time — a real cost, which §7 addresses
instead by making the second identical halt red. A sticky halt would also mean a chain stopped by
an ordinary `capped`, the common case on a large graph, needs manual intervention to make any
further progress, which defeats re-running the loop at all.

## 5. The workflows

Three files: two new, and one addition to `ralph-wiggum.yaml`.

Both new files carry the **same `provider`, `model`, `worktree` and `sandbox` blocks as the
existing four**, plus `name:` and `description:`. This is not decoration:
`test/workflow.test.ts`'s header-parity test reads every `*.yaml` under `template/workflows/` and
requires all four fields to agree, per `archon-native-lifecycle.md` §12.7. Dropping the two files
without them fails `bun run verify` immediately. The substantive reason is the same one that rule
was written for: `ready` walks an operator-supplied directory and `seal` writes into the checkout,
so the outer scripts belong inside the same boundary the phases run under.

### 5.1 `ralph-features` — the outer loop

```yaml
inputs:
  features_dir: { required: true, description: Directory to walk for feature files. }

nodes:
  - id: precondition       # script: ralph-precondition, with: {mode: build}
  - id: ready              # script: ralph-ready — DAG, minus already-converged → ordered paths
    depends_on: [precondition]
  - id: features           # workflow: ralph-one-feature
    depends_on: [ready]
    fan_out:
      items: "$ready.output.order"
      max_parallel: 1
      join: all_done
  - id: tally              # script: ralph-tally — reduce, decide the run outcome
    depends_on: [ready, features]
    trigger_rule: all_done
    always_run: true
    with:
      slots: { from: "$features.output", if_skipped: "[]" }
      order: { from: "$ready.output.order", if_skipped: "[]" }
```

**`precondition` reuses the existing script**, in `build` mode — the mode that checks the work
tree, `HEAD` and the tools but not the goal, since the outer run has no goal of its own. Without
it, a detached `HEAD` or a missing `bun` fails all N children one at a time at their own
preconditions, at the cost of N child runs, instead of failing here at the cost of nothing. No new
code: the script already has the mode.

**`join: all_done` is declared, not defaulted.** It is the default (§2), but changing that one
word makes an aborted feature fail the `features` node, which makes `tally`'s binding read a
failed producer, which deletes the summary in exactly the case it exists for.

**Both of `tally`'s bindings are required, and both need `if_skipped`.** `order` is the only thing
that turns slot *i* into a feature — the `archon_failed` marker carries no id, no path and no
index — and a failed `ready` skips `features`, at which point a directive binding without
`if_skipped` fails `tally` regardless of its `trigger_rule`. *Rejected: deriving the row order from
the map.* The map holds records from earlier invocations that are not in this run's items.

No `returns:` and no `outcome_field:`. A workflow declares `returns:` exactly when another
workflow consumes its result; nothing composes `ralph-features`. `outcome_field:` is rejected
because it is independent of the CLI exit code and a node that exits non-zero authors no outcome
at all, so the two cannot both be used — and the exit code is what CI reads.

`isolation:` is left at `inherit` on the `features` node, and §9 pins it there. Additive building
requires the live checkout; this is the field that actually decides a sub-run's checkout (§2).

### 5.2 `ralph-one-feature` — the adapter

```yaml
# worktree: matters only for a direct CLI invocation of this file; a sub-run's
# checkout is decided by the caller's isolation:, which ralph-features leaves
# at inherit. It is declared here for that case and for header parity (§5).
worktree: { enabled: false }

returns: seal

nodes:
  - id: gate             # script: ralph-gate → {ready, reason}
  - id: wiggum
    depends_on: [gate]
    include: ralph-wiggum
    when: "$gate.output.ready == true"
  - id: seal             # script: ralph-seal → the status record
    depends_on: [gate, wiggum]
    trigger_rule: all_done
    with:
      verdict: { from: "$wiggum.output", if_skipped: "" }
      reason: "$gate.output.reason"
    always_run: true
    output_format:
      type: object
      properties:
        id:     { type: string }
        path:   { type: string }
        status: { type: string, enum: [converged, capped, aborted, failed, skipped] }
        detail: { type: string }
      required: [id, path, status, detail]
```

`$wiggum.output` resolves to `ralph-wiggum`'s `returns:` node through include flattening. The
`if_skipped: ""` binding is how a skipped lifecycle reaches `seal` as data, and `trigger_rule:
all_done` is what schedules `seal` after a skip or a failure — `always_run` is the resume-cache
opt-out §2 describes, required because `seal`'s value is a file it writes, and nothing to do with
running after a skip.

**`seal` declares an `output_format` — not because `returns:` requires one.** It does not (§2).
The reason is that a child's fan-out slot carries its `structuredOutput` when it has one and raw
text otherwise, so without a schema every element of `$features.output` is a string that `tally`
would have to re-parse, sitting beside `archon_failed` objects.

The adapter belongs to the outer concern. It is a *thin* file by design — a gate, an include and a
record — because anything else put here is a thing ralph would have to know about.

### 5.3 The one change to `ralph-wiggum`

A new `verdict` node and a workflow-level `returns: verdict`:

```yaml
returns: verdict

  - id: verdict
    depends_on: [precondition, seed, plan, cycle, report]
    trigger_rule: all_done
    script: ralph-verdict
    runtime: bun
    always_run: true
    output_format:
      type: object
      properties:
        status: { type: string, enum: [converged, capped, aborted, failed] }
        open:   { type: integer }
        cycles: { type: integer }
        detail: { type: string }
      required: [status, open, cycles, detail]
```

It sits **alongside** `report`, never replacing it, and depends on it so the prose prints before
the JSON. `report` stays prose for humans; giving it an `output_format` would swap that prose for
a JSON document, which is worse for the operator and buys nothing the new node does not.

It names every upstream for the same reason `report` does: the join rule relaxes the state a
dependency may be in, not the set, so a failed `precondition` would otherwise leave `verdict`
unreachable. That also makes `verdict` the workflow's **sole sink**, which is load-bearing twice:
it is what `depends_on: [wiggum]` in the adapter resolves to, and it is what produces the delta
below.

`detail` exists because the parent run cannot find out any other way. The cause of an abort lives
in `abort.txt` inside the **child's** `ARTIFACTS_DIR`, which no node in the outer run can read;
without it the summary can name the feature that stopped the chain but not what stopped it, and
the operator has to open that child's run record. `ralph-verdict` runs inside the child, so it
reads the marker and carries the line out. §6.5 says exactly what goes in it.

*Rejected: having `seal` read the child's `abort.txt` directly and leaving the contract at three
fields.* Same output, but two scripts would then know where ralph keeps its abort marker, and the
result contract would stop being the whole answer to "how did this run go".

**The one observable delta to standalone `ralph-wiggum`, and it is not caused by `returns:`.** A
run's *result value* changes from the report's prose to the verdict JSON. But `returns:` is inert
for a top-level run — the engine gates it on `parent_run_id` (§2) and falls back to a positional
sink scan. The delta comes from `verdict` becoming the sole sink, which the scan then picks. It
therefore cannot be avoided by dropping `returns:`; only by giving `verdict` a dependent or
removing it. The report still prints, its own node output unchanged. This is the single place the
brief's decision 5 is not literally true, and it is accepted knowingly.

**The phase workflows do not gain a `returns:`.** Nothing consumes `ralph-plan`, `ralph-build` or
`ralph-review` as a contract — `ralph-wiggum` composes them with `include:` and reads no field from
them. Declaring one would mean giving some node in each an `output_format` it has no other reason
to carry, and would make three more prose reports into JSON.

## 6. Scripts

All five obey the repository's conventions: imports from `node:*` only, a `main()` behind
`if (import.meta.main)`, and every plan count through `planItemsBody` / `countItems` from
`template/scripts/lib/ralph.ts`.

The metadata parser, the ID index, the edge union, the `.ralph/features.json` reader and writer,
the feature file hash and the *is this feature done* test are **shared code in
`template/scripts/lib/`**, not duplicated across `ready`, `gate` and `seal`. Two implementations
of the edge rule, or of doneness, that drift apart is the failure mode this spec most wants to
avoid.

### 6.1 `ralph-ready`

Reads `INPUTS_FEATURES_DIR`. Unlinks `.ralph/halt.txt` (§4.1). Walks, parses, indexes by ID over
work files, builds the union graph, **validates it — dangling, duplicate, non-work reference,
cycle — over the whole graph**, then excludes features already done (converged with a matching
hash), toposorts what remains, and prints:

```json
{ "order": ["specs/features/FT-002-ingest.md", "specs/features/FT-003-ledger.md"],
  "discovered": 9, "not_work": 2, "already_done": 5 }
```

`order` is the fan-out's `items`. The counts are diagnostics for `tally` and for the operator;
stdout is one strict JSON document because the node declares `output_format`.

Exits non-zero, before any child exists, on: a missing or unreadable directory, a path that does
not contain `specs/` (§3.2), two `Feature ID` rows in one file, a duplicate `Feature ID` across
files, a dangling or non-work edge, or a cycle. An **empty** `order` is not a failure — every
feature is done and the fan-out completes immediately with `[]`.

**Determinism is a requirement, not a nicety.** Archon re-keys fan-out children by index on resume
and warns when an item's content differs from what its child was spawned with. So:

- `ready` is **not** `always_run`. The resume cache replaying its first output is the primary
  guarantee.
- On first execution it writes the order to `$ARTIFACTS_DIR/feature-order.json`. If that file
  already exists it prints it back verbatim instead of re-deriving. `ARTIFACTS_DIR` is derived
  from the run id, so this affects **resumes only** — a fresh invocation never sees the file and
  always re-derives, which is what lets a newly added feature be picked up.

Excluding already-done features *before* the toposort, rather than emitting the full order and
letting `gate` skip them, is what keeps the fan-out's cost proportional to outstanding work.

### 6.2 `ralph-gate`

Reads `ARGUMENTS` (its feature file path) and prints `{"ready": bool, "reason": string}` under an
`output_format`. Two tests, in order:

1. **Halt.** If `.ralph/halt.txt` exists, `ready: false` with its line as the reason — `chain
   halted at FT-003 (aborted)`.
2. **Upstreams.** Otherwise re-parse this feature's own file for its upstream IDs and require
   every one to be *done* by the shared test of §4: recorded `converged` **and** hashing to the
   file on disk. An upstream absent from the map is not ready. The reason names the first blocker
   — `FT-003 did not converge`, or `FT-002 has changed since it converged`.

The reason is recorded verbatim by `seal`, which is what makes the summary of §6.4 distinguish
"the chain stopped before we got to you" from "your own dependency is not done" without a fifth
status.

**It exits 0 in every case**, printing `{ready: false, reason: …}` for anything it cannot do —
an empty `ARGUMENTS`, an unreadable feature file, a corrupt map. This is the same requirement
`ralph-verdict` carries and for the same reason: a failed producer fails `seal`'s `$gate.output`
binding regardless of `if_skipped` (§2), and a `when:` reading a failed producer throws. A non-zero
`gate` would therefore lose the record *and* the halt marker, and the next feature would proceed
as if nothing had happened — breaking §1's invariant in precisely the case the arrangement exists
to handle.

**The second test is subsumed by the first in the common case, and is kept deliberately.** Halting
on anything but `converged` means that by the time a feature with a non-done upstream is reached,
the marker usually exists. It stays because it costs three lines over the shared library, because
it is *not* subsumed when a child died before writing the marker (§4.1), and because it turns the
item order into a claim the run verifies rather than assumes.

### 6.3 `ralph-seal`

Reads `INPUTS_VERDICT` and `INPUTS_REASON` from the bindings of §5.2, plus `ARGUMENTS` for its
path. An empty `INPUTS_VERDICT` means the lifecycle was skipped; otherwise it parses the verdict
object. It writes its entry into `.ralph/features.json` by the discipline of §4, and prints the
same record as its own output — the adapter's `returns:` node.

| `INPUTS_VERDICT` | Recorded status |
|---|---|
| `""` (skipped) | `skipped`, with `reason` from the gate |
| `{status: …}` | that status verbatim, with `open`, `cycles` and `detail` |

`attempts` is computed against the record being replaced, per §4.

**It also writes the halt marker.** When the recorded status is anything but `converged`, `seal`
creates `.ralph/halt.txt` with the line `chain halted at <id> (<status>)`, unless the file already
exists — the first failure owns the halt, and a later one must not overwrite the reason every
subsequent feature is quoting. A `skipped` feature never writes it: it did no work, and the marker
it would write is the one it just read.

There is no separate `halted` status. A feature the chain never attempted is `skipped`, and the
reason text carries the difference. Both mean "not built, nothing to trust here", and every
consumer of the map treats them identically; a fifth value would be a distinction only the summary
cares about, paid for in every `switch` that reads a status.

**It exits non-zero if it cannot write either file.** That fails the child run and surfaces the
slot as `archon_failed`, which is correct: a run whose outcome was not durably recorded has not
happened as far as the next invocation is concerned, and a halt that was not recorded is worse
than a loud failure.

### 6.4 `ralph-tally`

**Its source of truth is `.ralph/features.json`, not the fan-out aggregate**, and the reason is
worth stating plainly. When a feature aborts, `ralph-guard` fails the inner run, so the *adapter*
run fails too, so its slot in `$features.output` is `{archon_failed: true, …}` and the child's
`returns:` value is lost. But `seal` is scheduled past that failure by `trigger_rule: all_done`, so
the record was still written. The map is therefore the only place the difference between "aborted
after two cycles with four items open" and "something went wrong" survives.

`tally` prints **one row per path in `order`** — this run's items, not the whole map, which holds
entries from earlier invocations — reading each row's content from the map, and uses `slots`
positionally only to find the case the map cannot describe: an `archon_failed` slot at index *i*
with no record for `order[i]`, meaning the child died before `seal`. It has no `output_format` and
no consumer, so its stdout is prose.

```
FT-002  converged  1 cycle
FT-003  aborted    1 cycle, 4 open — build: push rejected ! [rejected] main -> main (non-fast-forward)
FT-005  skipped    FT-003 did not converge
FT-011  skipped    chain halted at FT-003 (aborted)
FT-012  skipped    chain halted at FT-003 (aborted)
chain halted at FT-003 (aborted)
run: failed — 1 aborted, 3 skipped, 1 converged
```

The `detail` line of §5.3 is what makes the second row say *why* rather than pointing at another
run record, and the gate reasons of §6.2 are what separate the third row from the fourth. Between
them the summary and the map are the whole account: the prose for the operator, the JSON for the
next invocation. *Rejected: a `.ralph/features-summary.md` beside the map* — one more artifact to
keep current, for a view the map already supports. *Rejected: echoing the failing rows to stderr* —
worth revisiting if a CI log ever buries them, but not before.

### 6.5 `ralph-verdict`

Derives its four fields from the artifacts `ralph-report` already reads, and from nothing else:

| Field | Source |
|---|---|
| `open` | `countItems(planItemsBody(), "[ ]")`, `0` when the plan is unreadable |
| `cycles` | `readCounter("$ARTIFACTS_DIR/cycle-iter.txt", 0)` |
| `status` | `abort.txt`, then the last `cycle N:` line in `outcome.log` |
| `detail` | all of `abort.txt`, else the last `cycle N:` line, else `""` |

```
abort.txt exists                          → aborted
last cycle line matches "clean"           → converged
last cycle line matches "reached the cap" → capped
anything else, including no cycle line    → failed
```

**`cycles` is the number of *completed* cycles.** `ralph-cycle-cap` increments the counter as it
closes a cycle, so a push rejected during cycle 2's build reports `1`. For `converged` and
`capped` the count is the cycles run; for `aborted` and `failed` it is the cycles finished.

**`capped` cannot be reached with an exhausted plan**, and this is inherited rather than
re-decided: `ralph-cycle-cap` tests `open === 0` *before* it tests the cap, so a final cycle that
exhausted the plan writes the `clean` line even when the cap fired on the same iteration.
`ralph-verdict` re-deriving that precedence from the counts would be a second implementation of
the rule, free to disagree with the first.

**`failed` means "did not finish".** A run that died in `precondition`, `seed` or `plan` never
reaches the cycle group, so it has no `cycle N:` line and no `abort.txt`; so does a group whose
last line is `N open items remain — starting cycle N+1`, which means the loop stopped without the
cap firing. `aborted` keeps its precise meaning — `abort.txt`. Both are errors and both redden the
outer run (§7), but the report distinguishes them because the operator's next action differs.

**`detail` is the whole of `abort.txt`, trimmed and newline-collapsed to one line — not its first
line.** `ralph-build-cap` writes the marker as `build: push rejected\n` followed by git's verbatim
output, deliberately, because the operator needs to know whether it was a non-fast-forward, a
protected branch or a dead host. The first line alone says nothing the word `aborted` did not, and
taking the second line instead is wrong for the review abort, which is one informative line with
no second. Collapsing the whole marker is the only rule that serves both.

*Rejected: letting the node fail in the `failed` case.* It needs no fourth status, but it throws
away `open`, `cycles` and `detail` exactly when they are most wanted, and it would break `seal`'s
binding.

**It exits 0 in every case, an abort included.** Required, not polite: a failed producer fails a
`with:` binding regardless of `if_skipped` (§2), so a `verdict` that exited non-zero on an aborted
run would take `seal` down with it and lose the record. `ralph-report` already exits 0 after an
abort for the same family of reasons, and `ralph-guard` is still what fails the run.

**It imports the log parse from `ralph-report.ts`** — `parseOutcome`, which is already exported,
plus predicates for the clean and capped cycle lines that the report currently keeps module-private
and must now export. There is precedent (`ralph-report` imports from `ralph-counts`), and the point
is that the report and the contract cannot disagree about what a log line means.

## 7. Run outcome policy

`tally` exits non-zero when any feature is `aborted` or `failed`; when any slot is
`archon_failed`, with or without a record; or when **the chain halted in the same place it halted
last time**. It exits 0 otherwise.

`capped` and `skipped` are the ordinary states of a large graph on a first pass. The status record
makes the next invocation pick up exactly what is outstanding, so a run that converged three
features and capped the fourth has done real work, recorded it, and stopped in the right place.
Reddening that would make the normal case red almost always, which trains people to ignore the
signal. Halting on anything but `converged` (§1) and reddening only on error are two different
judgements about the same event: the halt says *do not build on an unfinished foundation*, the
exit code says *this run made progress and should be run again*.

**The repeat clause is what stops that rationale from being a lie.** Without it, a single feature
that caps identically forever starves the whole chain, green: invocation *n* halts at FT-003 and
skips seventeen features; invocation *n+1* is byte-identical; an unattended scheduler burns a full
inner run per invocation and CI passes every time. The condition is `attempts > 1` on the halting
feature's record (§4) — the same status, the same file hash and the same open count as the
previous attempt — which is precisely "this run made no progress and the next one will not
either". *Rejected: a sticky halt* (§4.1's reasons stand). *Rejected: reddening all `capped`* (the
paragraph above). The distinction is *repeat* capping, not capping.

`aborted` and `failed` are different in kind: a rejected push, a review that destroyed the plan, a
precondition that never passed. Those do not get better by running again, and nothing downstream of
them is trustworthy. An `archon_failed` slot with no record is the chain break of §4.1 — the case
where the halt was never written — and is red for that reason and not merely because a child
failed.

## 8. Inputs and budget

`ralph-features` declares **one** input, the discovery directory. It forwards **no** inputs to its
children, so every child takes `ralph-wiggum`'s own defaults (`skip_push: false`, `cycle_cap: 3`).
Exposing them was considered: the argument for is that both are per-run policy that should apply
uniformly across a chain, and the argument against — which wins — is that every input is a knob to
document, validate and test, and neither has yet been wanted at this layer. An operator who needs a
different cap edits the installed `ralph-one-feature.yaml`.

**There is no run-wide money bound, and this spec cannot give one.** `maxBudgetUsd` is per-node and
Claude-only, and is ignored outright on a `workflow:` node (§2); the run-tree-wide ceiling is
[#1961], still open. Declaring it on the `features` node would put a number in the YAML that bounds
nothing, which is worse than no number at all.

**The per-feature bound is also smaller than it looks.** `maxBudgetUsd: 50` appears exactly once in
the template, on `ralph-wiggum.yaml`'s `cycle` loop_group. `ralph-plan.yaml`'s loop — up to seven
fresh-context opus passes — carries no budget at all, and it runs for **every** feature, including
the one that goes on to halt the chain. So the honest figure is `items.length × ($50 + an unbounded
plan phase)`, and the README says it in those words rather than in a single number that would
understate a twenty-feature directory by twenty plan phases.

Adding a budget to `ralph-plan.yaml` would make the figure true, and is deliberately **not** done
here: the brief puts the plan phase out of scope, and a bound chosen for this loop would apply to
every standalone `ralph-plan` run too. §11 carries it as a follow-up. The lever that exists today
is the directory the loop is pointed at; `ready`'s `order` length is reported before the first
child spawns, which is the moment to abandon a run larger than intended.

## 9. Testing

`bun test`, every body wrapped in `withTempRepo`, per `CLAUDE.md`. Five unit suites and an
extension of the structure tests.

`test/features-graph.test.ts` — the shared library of §6:
- a metadata table parses; emphasis, backticks and link wrappers are stripped; a header separator
  row is not a field; the field name is the first *non-empty* cell, with and without leading pipes.
- **a matching table outside the `## Metadata` section contributes nothing**, so a README
  documenting the contract is not a feature.
- `None`, `none` and an empty value all read as no edges.
- a file with `Feature ID` but no `Upstream Features` is not work; nor is one with no `## Metadata`.
- edges union across all three fields; `Extended By` reverses.
- **the redundant pair** (A's `Extended By: B` alongside B's `Upstream Features: A`) is one edge
  and is **not** an error; **the contradictory pair** (one feature declaring `Upstream Features: B`
  and `Extended By: B`) is a cycle.
- `FT-002` and `ft-002` are one node; two `Feature ID` rows in one file fail.
- the ID index comes from the field, not the filename: a file named nothing like its ID resolves.
- the doneness test is `converged` **and** hash-matching, and the same function answers for `ready`
  and `gate`.

`test/ready.test.ts`:
- recursive discovery; dotted directories skipped; output sorted by path.
- **a directory whose paths do not contain `specs/` fails** (§3.2).
- a duplicate `Feature ID`, a dangling edge, an edge naming a discovered-but-not-work file, and a
  cycle each fail; the cycle names its members; **a cycle wholly among converged features still
  fails**, so validation precedes exclusion.
- an already-converged feature with a matching hash is excluded; the same feature with an edited
  file is included again; a converged dependent of an edited feature is **not** re-included.
- the order is a valid topological order, and is byte-order stable when the graph admits several.
- a **resume** reads `feature-order.json` back verbatim rather than re-deriving, even when the
  checkout changed underneath; a fresh `ARTIFACTS_DIR` re-derives, so a newly added feature is
  picked up.
- `ready` unlinks an existing halt marker, so a chain halted by a previous invocation is retried.
- an all-done graph emits `order: []` and exits 0.

`test/gate.test.ts` — ready with all upstreams done; a root feature with no upstreams is ready; not
ready on a `capped`, an `aborted`, an absent and a **converged-but-hash-mismatched** upstream, each
with the blocker named; a halt marker makes a feature with fully converged upstreams not ready,
with the marker's line as the reason, and is tested before the upstreams so its reason wins; **an
empty `ARGUMENTS` and an unreadable feature file both exit 0 with `ready: false`**.

`test/seal.test.ts` — writes a record from a verdict, `detail` and `id` included; writes `skipped`
with the gate's reason from an empty verdict; merges into an existing map without disturbing other
keys; an absent and a corrupt map both read as `{}`; the temp file is written in the target's
directory and the target is either absent or complete after a write (a crash mid-write is not
observable from a unit test, and the assertion says only that). `attempts` increments on an
identical replacement and resets on any change of status, hash or open. Writes the halt marker for
every non-`converged` status; none for `converged`; none for `skipped`; leaves an existing marker
untouched.

`test/tally.test.ts` — reduces a synthetic map plus a synthetic aggregate and order; prints one row
per item in `order` and no row for a map entry outside it; exits non-zero on `aborted`, on
`failed`, on an `archon_failed` slot, and on a halt whose feature has `attempts > 1`; exits 0 for a
first-time chain halted by `capped`; an `archon_failed` slot **with** a record reports that
record's status, and **without** one is named as a chain break; the summary distinguishes a
dependency skip from a halt skip by their reasons; empty `slots` and empty `order` (a skipped
`features`) still print and exit 0.

`test/verdict.test.ts` — each of the four statuses from a synthetic `outcome.log`, `abort.txt` and
plan; `abort.txt` wins over a clean cycle line; a log whose last line is `N open items remain`
reads as `failed`; **`detail` is the whole multi-line `abort.txt` collapsed to one line**, the
terminal cycle line when capped or converged, and `""` when there is neither; a missing plan yields
`open: 0` rather than throwing; it exits 0 in every case.

**Structural pins** extend `test/workflow.test.ts`, covering the YAML invariants that break
correctness silently when edited:

- `features` declares `max_parallel: 1` **and** `join: all_done`, and no `isolation:` other than
  `inherit`. §4 and §4.1 depend on the first, §5.1 on the second and third.
- `ralph-wiggum` declares `returns: verdict`; `ralph-one-feature` declares `returns: seal`.
- `verdict` and `seal` each declare `trigger_rule: all_done`, `always_run: true` and an
  `output_format`.
- `tally` declares both `with:` bindings, each with an `if_skipped`.
- `ready` does **not** declare `always_run`.
- the two new files satisfy the existing header-parity and `name:`/`description:` tests unchanged —
  that is an assertion about the files, not a change to the tests.
- **the existing `$<node>.output` reference scan is extended.** `test/workflow.test.ts` scans only
  `when:` and `loop.until_bash`; the new references live in `fan_out.items` and in `with.*.from`,
  and a stale id there fails at run time rather than at load.

The composed-graph load check stays what `archon-native-lifecycle.md` §12.7 made it: an acceptance
criterion the operator runs once by hand with `--dry-run`, not a step in `bun run verify`. Putting
the `archon` CLI on the gate's critical path was rejected there and the reasons have not changed.

## 10. Scope

**In scope beyond the three workflow files and five scripts:** `README.md`'s workflow table and
file list, which name exactly four workflows today, and `bin/cli.ts`'s post-install run line.
`archon-native-lifecycle.md` §12.5 treated both as part of a comparable change, and a template
whose README does not mention two of its six workflows is a template nobody finds them in.

**Out of scope:**

- **The review phase and everything it anchors on**, including `citedSpecs`, the `when:` guards in
  `ralph-review.yaml`, and where specifications live. §3.2 accommodates the anchor rule rather than
  changing it, which is the whole reason the discovery directory is constrained instead.
- The plan and build phases, their prompts and their cap scripts — including adding a
  `maxBudgetUsd` to `ralph-plan.yaml`, which §8 names and §11 carries.
- `template/commands/` and `template/ralph/templates/` — verbatim downstream copies of ralph.
- Generated workflows. The outer loop has its intelligence at run time; codegen was considered and
  rejected, because a generated DAG has to be regenerated whenever the feature set changes and is
  wrong the moment it is stale.
- Parallelism. `max_parallel: 1` is not a starting point to be raised later: §4 depends on it for
  sibling visibility and §4.1 for the halt reaching every feature after the one that failed. The
  engine will **not** stop someone raising it (§2), which is why §9 pins it.
- Writing feature files, or any opinion about their content beyond the metadata rows of §3.3.

## 11. Follow-ups

- **A budget on `ralph-plan.yaml`'s loop.** §8's figure is untrue until it exists, and the decision
  belongs to a spec that owns the plan phase.
- **[#1961]** — when Archon grows a run-tree-wide budget ceiling, §8's bound becomes one line on
  the `features` node.
- **`archon-native-lifecycle.md` §12.7 is stale** on one point: it says an include node declares
  the structural fields only, and `when:` on an `include:` is first-class (§2). One line, in that
  spec, when something next touches it.
- Whether `tally` should also write a machine-readable summary beside the prose. Deferred until
  something wants to read it; today nothing does.
