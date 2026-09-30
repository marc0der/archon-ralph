# One-Shot Review

Settled on 2026-09-30, after `marc0der/ralph` made its review phase a single pass. This spec amends
`specs/archon-native-lifecycle.md` — **the lifecycle spec** throughout — and replaces parts of
`specs/spec-anchored-review.md` — **the anchoring spec**. §2 lists every amendment, and nothing
outside that list changes. A bare `§n` names a section of this spec.

Ralph's own record of the change is `specs/one-shot-review.md` in the sibling ralph checkout, the
upstream namesake of this file, with `docs/adr/0001-one-shot-review.md` beside it and the terms in
its `CONTEXT.md`. They carry the reasoning this spec does not repeat: why convergence made review
quiet, why three standards weigh equally, why consequence ranks a finding, and why the catalogue
holds only what a linter cannot check. Read them first. What follows is the archon-ralph delta, and
it is the whole of it.

The baseline moves from `f6d2405` to `a0ac4fd`. Every change between those two commits belongs to
this one feature.

## 1. What ralph changed

Review is the cycle's gatekeeper. It runs **one pass**, measures the cycle's work against a clause
of a cited spec, a written rule or a kind from a closed catalogue of nine defects, ranks each
finding by its consequence, and files every finding that passes its test, with no cap. Five
consequences reach archon-ralph:

- **The lifecycle has six fixed phases.** `ralph auto` runs `archive init plan build review build`
  and stops. The second build fixes what review found, and nothing reviews it. Repetition belongs
  to cycles, and `auto` runs one.
- **The cycle base.** `.ralph/cycle-base` records the `HEAD` of every repository just before
  build's first commit of the cycle, one `<repo> <sha>` line each in `repo_state`'s format. Build
  writes it when it is absent, review reads it and never writes it, and `archive` moves it with
  the plan. The cycle's work is every change between the base and `HEAD`.
- **The review preconditions.** The cited-spec gate is removed, and a present cycle base takes its
  place. A plan that cites only rule files or the verification gate still ships code, and that code
  now gets reviewed. An empty anchor set is legitimate.
- **The exit line.** After the pass, ralph prints a line it counts itself:
  `Review filed N findings. Reviewed S specs and F changed files.` `N` is the open items after the
  pass, `S` is `cited_specs`, and `F` is the distinct paths `cycle_changed_files` lists. A clean
  review still prints counts, so it stays distinguishable from a backend that did nothing.
- **The prompts.** `prompts/review.md` is rewritten from scratch. `prompts/build.md` carries the
  catalogue word for word, as rules build meets before it commits. `prompts/plan.md` and the plan
  template name the four `Spec:` forms a finding takes.

Where this repository and ralph disagree on a rule the *agent* follows, ralph wins (the lifecycle
spec §6). This spec goes further, by decision (§10): **where ralph has an answer, archon-ralph ports
it as written**, workflow shape and report wording included, and only what ralph has no equivalent
for is decided here.

## 2. Amendments

Each bullet heads with the section it amends.

### The lifecycle spec

- **§1, Model, rule 1.** "The workflow shape may differ from `ralph auto`" no longer holds for the
  phases: `ralph-wiggum` runs ralph's six, in ralph's order (§3). Archon's DAG, `when:` guards,
  `until_bash`, inputs and sandbox stay the means.
- **§1, the decisions table.** *Lifecycle* becomes `precondition → seed → plan loop → build loop →
  review pass → build loop → report`. The *Fixpoint end* row and the paragraph below the table,
  which calls the fixpoint the follow-up ralph deferred, are withdrawn: ralph's
  `specs/one-shot-review.md` §17 keeps `auto` at one cycle for want of a cost bound, and so does
  this repository.
- **§2, Archon facts.** The `maxBudgetUsd` bullet is withdrawn; nothing declares it (§3.3). One
  fact is added: a node declares exactly one of `command:`, `prompt:`, `bash:`, `script:`, `loop:`,
  `loop_group:` and friends (`schemas/dag-node.ts`, `dagNodeFlatSchema`), so a `command:` node runs
  a `.archon/commands/<name>.md` prompt once, with no `until_bash`.
- **§3, the workflow.** Rewritten by §3 below: no `cycle` group, no `cycle_cap` input, a second
  build block.
- **§3.1, phases and guards.** The table's last two rows become: `review` runs when
  `open == 0 && shipped > 0 && base`; `build (second)` is the `fix` block, and runs as build. The
  review guard is ralph's `require_review_preconditions`, cited-spec check removed and cycle-base
  check added. The guard moves from the `when:` expression into `ralph-counts` (§4.1).
- **§3.2, the cycle.** Withdrawn. One run is one cycle, in ralph's sense: it ends when `seed`
  archives its artifacts at the start of the next run.
- **§4.1, the shared library.** Gains `CYCLE_BASE`, `writeCycleBase()` and `cycleChangedFiles()`
  (§4.2). `readSettings` loses `cycle_cap`.
- **§4.2, `ralph-seed`.** Step 1 archives `.ralph/cycle-base` with the two plan artifacts (§4.3).
  Step 5 writes `settings.json` from `INPUTS_SKIP_PUSH` alone.
- **§4.2, `ralph-snapshot`.** `review` writes `shipped-before.txt` and nothing else. `build` also
  writes the cycle base when it is absent (§4.2).
- **§4.2, `ralph-counts`.** Rewritten by §4.1.
- **§4.2, `ralph-review-cap`.** Replaced by `ralph-review-exit` (§4.4).
- **§4.2, `ralph-cycle-cap`.** Deleted, with `test/cycle-cap.test.ts`.
- **§4.2, `ralph-report`.** Rewritten by §5.
- **§4.2, `ralph-precondition`.** Gains the abort check of §3.2 in `build` and `review` mode.
- **§4.3, why a marker and a guard.** Gains §3.2: a guard fails the run, and the marker keeps every
  later block from starting.
- **§6, the prompts.** The opening sentence, item 1's `source:` line and the `upstream` fetch note
  name `a0ac4fd`. The closing paragraph's review clause becomes: review's one pass, three standards,
  catalogue, severity by consequence, uncapped filing and review entry. §6 below lists the
  substitutions each file takes.
- **§7 and §12.5, packaging.** `package.json`'s version becomes `0.4.0`: the `cycle_cap` input is
  gone, and Archon refuses an undeclared input (`workflow-inputs.ts`), so a caller that still
  passes `--input cycle_cap=…` now fails.
- **§9, the test list.** §9 below.
- **§12.1, the `maxBudgetUsd` README sentence.** Withdrawn.
- **§12.3, the phase-workflow table.** `ralph-review` runs precondition → init → counts → review
  snapshot → review pass → review exit → guard → report. `ralph-wiggum` runs precondition → seed →
  `include: ralph-plan` → `include: ralph-build` → `include: ralph-review` → `include: ralph-build`
  → report. The **Lifecycle shape** paragraph is withdrawn with its two declined options, which
  this spec adopts: ralph's fixed six phases, and the trailing build.
- **§12.3, unmet predicates in a standalone run.** Unchanged in rule: a false guard skips and
  reports, one rule for both entry points. The skip reasons become ralph's `auto` wording (§4.1).
- **§12.3, inputs.** `ralph-wiggum` declares `skip_push` alone and passes it to both build blocks.
- **§12.4, `ralph-report`.** Rewritten by §5.
- **§12.6, out of scope.** "A trailing build after the cycle cap" and "a `ralph-cycle` workflow of
  build, review, build" are withdrawn: `ralph-wiggum` is now that workflow, after `plan`.

### The anchoring spec

- **§1**, the finding budget and the fourth review precondition: withdrawn. The anchor set is kept.
- **§2**, every amendment naming `cited` in a guard, the cycle, the `review:` converged line or
  `no cited specs`: withdrawn. The amendments for `citedSpecs` in the library and for the
  conventions stand.
- **§3**, the fourth gate as a guard term: withdrawn whole.
- **§4**, `citedSpecs` stands as written, comma and all. `ralph-counts`'s `cited` count,
  `ralph-review-cap`'s `audited N specs`, and `ralph-report`'s `no cited specs` cause are
  withdrawn. The note on `planStateHash` stands for `plan` alone.
- **§5**, the prompt and template ports: superseded by §6 below.
- **§8**, the hard-fail fourth gate and the silent-drop gap: moot. There is no fourth gate, and a
  cited spec no longer stands between a cycle and its review.

## 3. The workflow

### 3.1 Shape

`ralph-wiggum.yaml`'s nodes become:

```yaml
nodes:
  - id: precondition
    script: ralph-precondition
    runtime: bun
    with: { mode: plan }

  - id: seed
    depends_on: [precondition]
    script: ralph-seed
    runtime: bun
    with: { mode: archive }

  - id: plan
    depends_on: [seed]
    include: ralph-plan

  - id: build
    depends_on: [plan]
    include: ralph-build
    with: { skip_push: "$INPUTS.skip_push" }

  - id: review
    depends_on: [build]
    include: ralph-review

  - id: fix
    depends_on: [review]
    include: ralph-build
    with: { skip_push: "$INPUTS.skip_push" }

  - id: report
    depends_on: [precondition, seed, plan, build, review, fix]
    trigger_rule: all_done
    script: ralph-report
    runtime: bun
    with: { mode: auto }
    always_run: true
```

The shape, not the text: the implementation carries the full `description:` block and banner
comments, and the `inputs:` block declares `skip_push` alone.

**Two blocks include one file.** Archon rejects an include cycle only when a workflow appears among
its own ancestors (`include-expander.ts`, `expandOne`'s `stack.includes(name)`), so two sibling
includes of `ralph-build` are legal. Their nodes are namespaced `build__*` and `fix__*`, and both
share `ARTIFACTS_DIR`, so `settings.json`, the counters and `abort.txt` keep working unchanged. The
id `fix` names the block's job, which ralph's README states as "a final `build` to fix what review
found". Its report row is labelled `build`, as ralph's is (§5).

**`ralph-build.yaml` does not change.** Its snapshot resets the counters and recomputes the budget
from the open count on each block, which is what a fresh `ralph build` does for phase 6.

### 3.2 A marker stops every later block

`depends_on: [review]` waits on every sink of the review block, and that block's only sink is its
`report`, which declares `trigger_rule: all_done` and always succeeds. A guard that failed on
`abort.txt` therefore does not stop the next block from starting. Inside the old `loop_group` the
failed guard failed the group; in a straight line of blocks nothing does.

Ralph stops `auto` at the first phase that fails, and the phases after it are `not reached`. The
`fix` block must not build on a plan a review pass un-ticked, and a review must not audit a cycle
whose push git rejected.

**Decision.** `ralph-precondition` in `build` and `review` mode fails when
`$ARTIFACTS_DIR/abort.txt` exists, naming the marker's first line. The block's `init` depends on
it, so the whole block is skipped and its report prints. `plan` mode is unchanged: `plan` runs
before anything can write the marker. A standalone block starts in a fresh `ARTIFACTS_DIR`, so the
check can only fire inside `ralph-wiggum`.

This reverses one consequence the lifecycle spec's `CYCLE` banner recorded: a rejected push no
longer lets the review block run before the run fails.

### 3.3 No money bound

`maxBudgetUsd: 50` sat on the `cycle` group and goes with it. Archon applies `maxBudgetUsd` per node
through the provider options (`dag-executor.ts`, `providers/src/claude/provider.ts`); nothing
totals a run. Ralph's `auto` carries no money bound either. Every phase is bounded by iterations:
`plan` by its cap of 6, each build by its budget of `ceil(open × 1.2)`, and review by its one pass.

### 3.4 The review block

`ralph-review.yaml`'s review nodes become:

```yaml
  - id: counts
    depends_on: [init]
    script: ralph-counts
    runtime: bun
    with: { mode: review }
    always_run: true

  - id: snapshot
    depends_on: [counts]
    when: "$counts.output.run == true"
    script: ralph-snapshot
    runtime: bun
    with: { mode: review }
    always_run: true

  - id: review
    depends_on: [snapshot]
    idle_timeout: 600000
    command: ralph-review

  - id: exit
    depends_on: [review]
    script: ralph-review-exit
    runtime: bun
    always_run: true

  - id: guard
    depends_on: [exit]
    trigger_rule: all_done
    script: ralph-guard
    runtime: bun
    always_run: true
```

`review` is a plain `command:` node: one pass, no loop, no `until_bash`, no `max_iterations`.
`exit` declares no `trigger_rule`, so it is skipped with the pass it follows. The report's
`depends_on` gains `exit`.

`ralph-build.yaml`'s `counts` gains `with: { mode: build }`, and its snapshot's `when:` becomes
`$counts.output.run == true`. Nothing else in the build block changes.

## 4. Script changes

### 4.1 `ralph-counts` is the phase gate

`ralph-counts` reads `INPUTS_MODE` (`build` or `review`), and an absent or unrecognised mode fails
the node as `ralph-snapshot` fails it. It prints one JSON object:

```
{"open": N, "shipped": N, "superseded": N, "base": true|false, "run": true|false}
```

`base` is whether `.ralph/cycle-base` exists. `run` is the phase's guard:

- `build`: `open > 0`.
- `review`: `open == 0 && shipped > 0 && base`.

When `run` is false, `ralph-counts` appends the phase's skip row to `outcome.log`, with ralph's
`auto` wording, checked in ralph's order:

| Mode | First failing check | Row |
|------|---------------------|-----|
| `build` | `open == 0` | `build: skipped — no open items` |
| `review` | `shipped == 0` | `review: skipped — no shipped items` |
| `review` | `open > 0` | `review: skipped — N open items remain` |
| `review` | no base | `review: skipped — no cycle base` |

The node writes one row and only when it skips, so every phase block that starts writes exactly
one row: the skip row here, the cap script's row, or the exit node's row.

**Why the gate moves out of `when:`.** A skipped node writes nothing, so the report derived every
skip reason after the fact, from the `cycle N:` lines and the plan as it stood at report time. Both
sources are gone: the cycle lines with `ralph-cycle-cap`, and the live plan because the `fix` block
rewrites it after review. Ralph records each skip in `cmd_auto`'s phase guard, at the moment it
decides, and this does the same. It also keeps the predicate in one place: the `when:` reads a
boolean the script computed, and cannot disagree with the reason the script wrote.

`cited` is removed from the object. The review guard no longer reads it, and `ralph-review-exit`
counts the anchor set itself. Artifact presence stays asserted as today: a missing artifact exits
non-zero before anything is printed.

### 4.2 The cycle base

`lib/ralph.ts` gains:

- `CYCLE_BASE = ".ralph/cycle-base"`, relative to the checkout root, not to `ARTIFACTS_DIR`. The
  base must outlive the run that wrote it: a standalone `ralph-build` followed by a standalone
  `ralph-review` is two runs with two artifacts directories, which is ralph's supervised first
  cycle. It is also the path the ported review prompt reads, with no new substitution.
- `writeCycleBase()` — writes `repoState()` to `CYCLE_BASE` when the file is absent, creating
  `.ralph/` if needed. Mirrors `write_cycle_base`. Returns whether it wrote.
- `cycleChangedFiles()` — the distinct paths the cycle changed, relative to the workspace root, in
  byte order. Mirrors `cycle_changed_files`: for each base line, `git -C <repo> diff --name-only
  <sha> HEAD`, or `git -C <repo> ls-files` when the sha is `-`; then `ls-files` for every
  repository `repoState()` lists that the base does not; each path prefixed with its repository,
  with a leading `./` stripped. A git command that fails contributes nothing, as `2>/dev/null` makes
  it in ralph. It returns `[]` when the base is absent.

`ralph-snapshot` in `build` mode calls `writeCycleBase()` before its other writes and prints
`build: wrote cycle-base` when it did. The snapshot runs only when the build block's gate passes,
so a build with nothing open writes no base. Ralph writes the base before its first iteration
whatever the queue holds, but a build with nothing open commits nothing, and the base it would have
written equals the one the next build writes.

In `ralph-wiggum` the `build` block's snapshot writes the base and the `fix` block's snapshot finds
it and keeps it, which is ralph's "a second build in the same cycle keeps the first build's base".

`ralph-snapshot` in `review` mode writes `shipped-before.txt` and nothing else. `plan-hash.txt` and
`review-iter.txt` go with the loop. `plan-hash.txt` is now `plan`'s alone, and the header comment
that says the two phases share it is corrected.

### 4.3 `ralph-seed` archives the base

`archive()` treats `.ralph/cycle-base` as a third artifact, as ralph's `ARTIFACTS` array does. Any
of the three present starts an archive; each present one moves into `.ralph/<timestamp>/` under
its basename, so the base lands at `.ralph/<timestamp>/cycle-base`. `scaffold()` still copies the
two plan templates only: the base is archived, never scaffolded.

`init` mode archives nothing, as today. The base therefore persists across standalone runs until a
`ralph-wiggum` run archives it, which is ralph's manual flow. archon-ralph has no `clean`
(the lifecycle spec §12.6); the README says that deleting `.ralph/cycle-base` by hand starts a new
cycle.

### 4.4 `ralph-review-exit`

`ralph-review-cap.ts` is renamed `ralph-review-exit.ts` and becomes an ordinary exec node. It no
longer caps anything, and it exits 0 on success like every other exec node, not by `until_bash`'s
inverted rule. It reads `ARTIFACTS_DIR` from its environment, as the other exec nodes do; the
`argv[2]` idiom was an `until_bash` workaround.

1. `shipped = countItems(planItemsBody(), "[x]")`. If `shipped < shipped-before`: write
   `abort.txt` and append the same line to `outcome.log`, with today's text, and exit 0. The guard
   fails the run.
2. Otherwise compute, from one `planItemsBody()` read, `findings = countItems(body, "[ ]")` and
   `specs = citedSpecs(body).length`, and `changed = cycleChangedFiles().length`.
3. Append `review: Review filed N findings. Reviewed S specs and F changed files.` to
   `outcome.log`, print the same text after the prefix to stdout, and exit 0.

The text after `review: ` is ralph's exit line, verbatim, `1 findings` and `1 specs` included. An
exit that cannot read the plan throws and fails the node, as the old cap script did.

### 4.5 Removed and unchanged

**Removed:** `ralph-cycle-cap.ts`, `ralph-review-cap.ts`, the `cycle_cap` field of `Settings`, and
`cycle-iter.txt`.

**Unchanged:** `ralph-plan-cap`, `ralph-build-cap`, `ralph-guard`, `planItemsBody`, `countItems`,
`citedSpecs`, `planStateHash`, `repoState` and `computeBudget`. `ralph-guard`'s header says it runs
twice per cycle and names `ralph-seed` moving "only the two plan artifacts"; both are corrected.

## 5. The report

### 5.1 The summary

`auto` mode prints one numbered row per phase, in ralph's `auto_report` format
(`  %d %-9s %s`), then the lines that follow it today:

```
Ralph lifecycle summary
  1 seed      ran — archived previous cycle to .ralph/20260930-101500/
  2 plan      ran — converged on pass 3
  3 build     ran — 9 iterations, plan exhausted
  4 review    ran — Review filed 2 findings. Reviewed 1 specs and 14 changed files.
  5 build     ran — 3 iterations, plan exhausted

Plan: 11 shipped, 0 open, 1 superseded
Repositories that moved: . (4 commits), source/svc (7 commits)
Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; previous cycle under .ralph/<timestamp>/
```

`seed` is one row because it is one node: ralph's `archive` and `init` together, a difference the
lifecycle spec §3.1 already records. So there are five rows, not six.

**The rows come from `outcome.log` alone, in order.** Every phase that started wrote exactly one
row (§4.1), so the report assigns them positionally: the `seed:` row, the `plan:` row, the first
`build:` row, the `review:` row, the second `build:` row. A row that says `skipped — …` is printed
as `skipped — …`; any other row is `ran — <text>`. The row that carries `abort.txt`'s first line
prints `failed — <that line>`, as today. A phase with no row prints `not reached`, which is ralph's
state for a phase after the one that failed.

Ralph prints `failed — exit N` from its child's exit code. Archon has no child exit code to report,
and the marker's first line says more, so that string stays as it is.

**Removed:** the `cycle N` block headers, the `Result:` row, the `, filed F findings` clause,
`parseOutcome`'s cycle split, `CYCLE_END`, `CYCLE_CLEAN`, `CYCLE_OPEN`, `CYCLE_CAPPED`,
`openAfter`, `reviewSkipped`, `NO_CITED_SPECS`, `uncitedPlan` and `currentCycle`. The `Plan:` row,
the moved repositories and the artifacts line are unchanged.

### 5.2 The block reports

`plan`, `build` and `review` mode each print the last row of their phase, rendered as the summary
renders it, then the plan counts, and in `build` mode the repositories that moved. A block whose
gate skipped it reads its own skip row, because the gate wrote one. The absent-row fallbacks
(`skipped — no open items`, `skipped — no shipped items to audit`) go: a block that wrote no row
failed before its gate, and prints `not reached`.

**Decision, settled while planning.** A block report's row carries no phase number. A block does
not know its position inside `ralph-wiggum`, where `build` is phase 3 or phase 5, so it prints the
label and the state column of §5.1 without the leading number. The state text is rendered by the
same function the summary uses.

Inside `ralph-wiggum` one case prints the wrong row. A `fix` block stopped by §3.2's abort check
writes no row, so its report prints the first build's row. The block reports are interim lines
there, the summary is the product (the lifecycle spec §12.4), and the run has already failed. This
is accepted.

## 6. Prompts and templates

Four downstream copies are re-ported from `a0ac4fd`, under the lifecycle spec §6's substitutions
and no others. The three prompts keep their frontmatter and name `a0ac4fd` in `source:`.

- **`template/commands/ralph-review.md`** — replaced by `prompts/review.md`. Item 3's workspace
  anchor replaces the anchor sentence and drops all seven remaining `{{WORKSPACE}}/` prefixes.
  The cycle-base bullet therefore reads `.ralph/cycle-base`, which is `CYCLE_BASE` (§4.2). Items 2,
  4 and 5 have nothing to act on. The frontmatter `description:` becomes "Ralph Wiggum review pass
  — review the cycle's work in one pass and file findings as new plan items.", ralph's `usage()`
  line for the mode.
- **`template/commands/ralph-build.md`** — ralph's two edits: the `### Review catalogue` section
  with all nine kinds, and the **Self-documenting code** guardrail in place of **Document the
  why**. Nothing to substitute: both edits carry no `{{WORKSPACE}}`.
- **`template/commands/ralph-plan.md`** — ralph's one edit: the review-finding sentence of the
  `Spec` field names the four forms.
- **`template/ralph/templates/IMPLEMENTATION_PLAN.md`** — ralph's one edit, the same four forms,
  verbatim. `PROGRESS.md` is unchanged upstream and is not re-ported.

The review prompt's worked example names `ralph build --dry-run` and `bats test/`. It is ralph's
text and stays: it is an example of a finding's shape, not an instruction to run anything.

## 7. Documentation

**`README.md`:**

- **What it does**, step 3, *Cycles*, becomes *Build, review, build*: the first build runs to
  exhaustion and records the cycle base; review runs once, when build left no open items, at least
  one shipped item and a cycle base, and files every finding as an open item; the second build
  fixes them. The fixpoint paragraph goes. One sentence states what ralph accepts: nothing reviews
  the second build's fixes, and a later run is where they get reviewed.
- The phase-workflow table's `ralph-review` row: review the cycle's work in one pass and file
  findings as open items. The `ralph-wiggum` row: plan, build, review, build, report.
- The skip-and-report paragraph: `ralph-review` skips on a plan with open items, nothing shipped or
  no cycle base.
- The inputs table loses `cycle_cap`, and the paragraphs on `max_iterations: 20` and
  `maxBudgetUsd` go. One sentence says there is no money bound, as in `ralph auto`, and that each
  phase is bounded by its iterations.
- **Supervised first cycle**: `ralph-build` records the cycle base, `ralph-review` reads it, and
  deleting `.ralph/cycle-base` starts a new cycle. Step 3's advice on style findings is re-worded
  to the catalogue: a finding that names no clause, no rule and no catalogue kind means the prompts
  need work.
- The source-tree listing: `ralph-counts.ts` becomes `the phase gate: counts, the guard and the
  skip row`; `ralph-review-cap.ts` becomes `ralph-review-exit.ts`, `the review exit line and the
  un-tick guard`; `ralph-cycle-cap.ts` goes.
- The prompts paragraph names `marc0der/ralph@a0ac4fd`.

**`AGENTS.md`** and **`CLAUDE.md`**, which stay identical copies: the **Keep in step with ralph**
baseline sentence names `a0ac4fd`. Nothing else: neither describes the review model.

**The workflow files:** `ralph-wiggum.yaml`'s `description:` becomes plan, build, review once,
build, report, and its `CYCLE` banner is replaced by one banner per build block and one for
review. `ralph-review.yaml`'s `description:` and `REVIEW` banner describe one pass, the three
guard terms and the exit line. `ralph-build.yaml`'s `BUILD` banner names the cycle base.

## 8. Accepted risks

Ralph's `specs/one-shot-review.md` §18 binds here in full: no second pass, argued `Critical`s,
long reviews with no cap, and manual flows that never archive, where the base persists and each
review re-reads a growing range. Two more are this repository's:

- **The `fix` block's report prints the first build's row** after an abort (§5.2).
- **A skipped first build writes no base.** In `ralph-wiggum` it is skipped only on a plan with no
  items, and then nothing ships and review skips on `no shipped items` first.

## 9. Testing

Extending the lifecycle spec §9 and §12.5. Every test stays inside `withTempRepo`.

- `writeCycleBase` writes `repoState()` to `.ralph/cycle-base` when absent, creating `.ralph/`,
  and leaves an existing file byte for byte.
- `cycleChangedFiles` lists a file committed after the base, lists nothing for an unchanged tree,
  lists every tracked file of a repository recorded as `-`, lists every tracked file of a nested
  repository created after the base, prefixes nested paths with their repository, returns the
  paths in byte order without duplicates, and returns `[]` without a base.
- `ralph-snapshot` in `build` mode writes the base once across two calls; in `review` mode writes
  `shipped-before.txt` and no `plan-hash.txt`.
- `ralph-seed` in `archive` mode moves `.ralph/cycle-base` to `.ralph/<timestamp>/cycle-base`,
  archives when the base is the only artifact present, and never scaffolds a base; `init` mode
  leaves the base alone; `settings.json` holds no `cycle_cap`.
- `ralph-counts` prints `base` and `run`; `run` follows each mode's guard; each row of §4.1's table
  is written for its case and nothing is written when `run` is true; an unrecognised mode fails.
- `ralph-precondition` fails in `build` and `review` mode when `abort.txt` exists, naming its first
  line, and passes `plan` mode.
- `ralph-review-exit` writes the abort on a dropped shipped count; otherwise appends the exit line
  with the open count, the cited-spec count and the changed-file count; reads `ARTIFACTS_DIR` from
  the environment.
- `ralph-report` in `auto` mode renders the five numbered rows of §5.1 from a fixture log, a
  skipped row, a failed row with `not reached` after it, and two `build:` rows as rows 3 and 5.
- The block reports print their own skip row, and `not reached` for a block that wrote none.
- The workflow structure test: `ralph-wiggum.yaml` declares no `loop_group`, no `cycle_cap` and no
  `maxBudgetUsd`, and includes `ralph-build` twice; `ralph-review.yaml`'s `review` node is a
  `command:` node naming a file under `template/commands/`; every snapshot's `when:` reads
  `$counts.output.run`; every `ralph-counts` node declares `with: {mode: …}`; the node after a
  `loop:` node still declares `trigger_rule: all_done`, and `exit` declares none.
- The three command files name `a0ac4fd` in `source:` and still contain no `{{WORKSPACE}}`.

Removed with the code: `test/cycle-cap.test.ts`, the `review-cap` convergence and cap-of-6 cases,
the cited-spec guard cases, and the report's cycle-block, `Result:` and `no cited specs` cases.
Prompt prose keeps its exemption: a plan item that edits a prompt carries a `grep -c` criterion.

## 10. Decisions settled while grilling

Settled on 2026-09-30, before any code was written. Each one is a question the upstream change does
not answer for archon-ralph.

- **Follow ralph fundamentally.** Where ralph has an answer — the phases, the base, the exit line,
  the skip wording — archon-ralph ports it as written, so a later sync has nothing local to
  re-check. Only what ralph has no equivalent for is decided here.
- **Ralph's six phases replace the fixpoint** (§3.1), reversing the lifecycle spec's decisions of
  2026-09-17 and 2026-09-18 on upstream's ADR 0001.
- **No money bound** (§3.3).
- **The base lives at the checkout root and the build snapshot writes it** (§4.2).
- **Review is a `command:` node followed by an exit node** (§3.4, §4.4).
- **The report is flat, in ralph's format and wording** (§5).
- **The version becomes `0.4.0`** (§2).

Two more were settled while writing this spec, by the rule in the first bullet:

- **An abort stops every later block** (§3.2). Ralph stops `auto` at the failed phase; without the
  check, `fix` would build on a plan review un-ticked.
- **`ralph-counts` is the phase gate and writes the skip row** (§4.1). Ralph records a skip where it
  decides it; the report can no longer infer the reason after the `fix` block has run.
