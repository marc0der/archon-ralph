# Archon-Native Lifecycle

archon-ralph ports [marc0der/ralph](https://github.com/marc0der/ralph) to an Archon workflow. The
port was taken from ralph at commit `3c53c0e` (2026-06-16). Ralph is now at `36e8c8b`
(2026-09-16) and has moved a long way since: a `review` mode, an `auto` lifecycle, a closed plan
item schema, harness-side convergence and noop detection, meta repository support, and a set of
prompt rules that make the build agent commit where the file lives. None of that reached
archon-ralph. This spec brings it up to date.

The decisions below were settled on 2026-09-17. They are recorded here with their reasons so that
the planning agent does not re-open them. Where this spec and ralph's own text disagree on a rule
the *agent* follows, ralph's prompts win: this spec changes how archon-ralph *drives* the agent, not
what the agent is told to do.

## 1. Model

Three rules, one per layer:

1. **Archon-native, not a mirror.** archon-ralph uses Archon's DAG, `loop_group`, `when:` guards,
   `until_bash`, inputs and sandbox rather than reproducing ralph's bash harness inside scripts. The
   workflow shape may differ from `ralph auto`; the outcomes must not.
2. **Scripts are the witness, never the agent.** Every loop ends on a deterministic check a Bun
   script performs (`until_bash`). No loop declares an `until:` sentinel, and no prompt asks the
   agent to emit a completion token or to judge whether it made progress. Ralph moved every such
   verdict into the harness because an agent's account of its own work proved unreliable; Archon's
   own loop schema warns that a sentinel "the model happens to emit while reasoning" ends a loop.
3. **The prompts carry ralph's contract.** `template/commands/ralph-plan.md`, `ralph-build.md` and
   `ralph-review.md` are ralph's `prompts/plan.md`, `build.md` and `review.md` with only the
   substitutions §6 lists. The six-field item schema, the size caps, the `[~]` marker, the
   immutability rule, the commit rules and the review contract all arrive by that route.

### Decisions recorded

| Question | Decision |
|----------|----------|
| Lifecycle | seed → plan loop → `loop_group{ build loop → review loop }` fixpoint → report |
| Fixpoint end | Zero open items after a cycle, or the cycle cap (default 3). Graceful, never `max_iterations` |
| Loop control | `until_bash` only; no `<promise>` tokens |
| Archive | First, inside seed, like `ralph auto`. The tree ends with this run's artifacts in place |
| Report | A Bun script, not an agent node |
| Isolation | `worktree: {enabled: false}`; the run acts on the live checkout, like ralph |
| Meta repositories | Supported: nested-repo fingerprint, commit-where-the-file-lives prompt rules |
| Push | The build `until_bash` pushes the workspace with ralph's skip rules; the agent pushes nested repos |
| Model | One workflow-level `model: opus`; no per-node model, no fork requirement |
| Safety | Archon `sandbox:` block at workflow level |
| Metrics | None of ralph's `metrics.jsonl`; Archon's per-node cost and tokens are the record |
| `init` upgrade | Skip-by-default stays; `--force` overwrites; README says so |

The fixpoint is the follow-up ralph's `specs/auto-lifecycle.md` §13 deferred for want of a cost
bound. Archon supplies the bound: a cycle counter in the loop_group's `until_bash` and
`maxBudgetUsd` on the node.

## 2. Archon facts this spec relies on

Verified on 2026-09-17 against Archon `v0.10.1` (`/home/marco/src/oss/Archon`, fork of
`coleam00/Archon`). File references are into `packages/workflows/src/`.

- **`loop.command`** resolves a `.archon/commands/<name>.md` file as the iteration prompt
  (`schemas/loop.ts`). It is upstream since `v0.6.0`. archon-ralph therefore **no longer requires
  the marc0der fork**. The one remaining fork-only change, node-level `model:` on a loop node, is
  not used here.
- **`loop_group`** repeats a `nodes:` sub-DAG per iteration; the body "may contain any node type,
  including another `loop_group`" (`schemas/dag-node.ts` near `loopGroupNodeConfigSchema`). A
  `loop:` node with `command:` is a legal body node.
- **`until_bash`** runs after each iteration; exit 0 completes the loop, **any non-zero exit means
  keep looping** (`dag-executor.ts`, "Numeric exit code from the bash script = condition not met
  yet"). Only an unexecutable bash fails the node. So `until_bash` cannot abort a run; §4.3 states
  the marker pattern that does.
- **`max_iterations`** is required and its exhaustion **fails the node**. Every script-side cap
  therefore exits 0 before the ceiling is reached, and `max_iterations` is a safety ceiling only.
- **`until_bash` environment** carries `USER_MESSAGE`, `ARGUMENTS`, `LOOP_USER_INPUT`,
  `LOOP_PREV_OUTPUT` and the project's configured env. It does **not** carry `ARTIFACTS_DIR` or
  `INPUTS_*`. `$ARTIFACTS_DIR` and `$<node>.output[.field]` references are substituted textually
  into the `until_bash` string before it runs. The existing idiom stays: pass `"$ARTIFACTS_DIR"` as
  `argv[2]`.
- **Exec nodes** (`bash:`, `script:`) receive `ARTIFACTS_DIR`, `STATE_DIR`, `ARGUMENTS` and, for
  every declared workflow input, `INPUTS_<UPPER_SNAKE>` (`exec-environment.ts`). A non-zero exit
  fails the node. `script: <name>` with `runtime: bun` runs `bun run .archon/scripts/<name>.ts`
  from the checkout root.
- **`when:`** takes `$<node>.output.<field> <op> <value>` with `==`, `!=`, `<`, `<=`, `>`, `>=`,
  `&&`, `||`, no parentheses (`condition-evaluator.ts`). The producer's stdout must be one JSON
  object (a single ```` ```json ```` fence is tolerated). A false `when:` **skips** the node.
- **A skipped upstream skips its dependents** unless the dependent declares `trigger_rule:
  all_done` or `none_failed_min_one_success` (`.archon/workflows/test-workflows/e2e-joins.yaml`).
  Every node that must run after a guarded loop carries `trigger_rule: all_done`.
- **`always_run: true`** is a resume-cache opt-out, not a "run after skip" flag. Every exec node
  whose value is a side effect (a file it writes) declares it.
- **`$<node>.output`** is substituted into prompts, `bash:` bodies and `until_bash`. A failed
  producer throws; a skipped producer is readable through `with: {from, if_skipped}` only.
- **Inputs**: a workflow declares `inputs: {<name>: {default, required, description}}`; the CLI
  passes `--input name=value`; `$INPUTS.<name>` is substituted into prompts and `when:`, and exec
  nodes read `INPUTS_<UPPER_SNAKE>`.
- **`worktree: {enabled: false}`** pins a run to the live checkout; a caller passing a worktree
  flag then hard-errors.
- **`sandbox:`** at workflow or node level takes `enabled`, `autoAllowBashIfSandboxed`,
  `network.allowedDomains`, `filesystem.allowWrite`/`denyWrite`/`denyRead`, `excludedCommands`
  and friends (`schemas/dag-node.ts` near `sandboxSettingsSchema`).
- **The goal** is the positional message: `archon workflow run ralph-wiggum "<goal>"`, surfaced as
  `$ARGUMENTS`. There is no `-g` flag; the README's `-g` examples are wrong today.
- **`.archon/` is not copied into worktrees any more**; a run takes a frozen source capture. With
  worktrees off this does not matter, but the old comment in the workflow saying templates are
  "auto-copied into worktrees" is stale.
- **`maxBudgetUsd`** is a node-level field. It goes on the `loop_group`.

## 3. The workflow

`template/workflows/ralph-wiggum.yaml` is rewritten. The shape:

```yaml
name: ralph-wiggum
description: |
  Use when: ...
  Does: Archives the previous cycle, seeds IMPLEMENTATION_PLAN.md and PROGRESS.md,
        runs the plan loop to convergence, then repeats build-to-exhaustion and
        review until a review pass files nothing or the cycle cap is reached.
  NOT for: ...
provider: claude
model: opus
worktree:
  enabled: false
sandbox:
  enabled: true
  autoAllowBashIfSandboxed: true
  filesystem:
    denyWrite: ["~/.ssh", "~/.gnupg", "~/.aws", "~/.config/gh", "~/.archon/config.yaml"]
  network:
    allowedDomains: ["github.com", "api.github.com", "registry.npmjs.org", "bun.sh"]
inputs:
  skip_push:
    default: false
    description: Do not push the workspace after a build iteration.
  cycle_cap:
    default: 3
    description: Maximum build-review cycles before the run stops.

nodes:
  - id: precondition
    script: ralph-precondition
    runtime: bun

  - id: seed
    depends_on: [precondition]
    script: ralph-seed
    runtime: bun
    always_run: true

  - id: plan-snapshot
    depends_on: [seed]
    script: ralph-snapshot
    runtime: bun
    with: { mode: plan }
    always_run: true

  - id: plan
    depends_on: [plan-snapshot]
    idle_timeout: 600000
    loop:
      command: ralph-plan
      max_iterations: 7
      fresh_context: true
      until_bash: bun run .archon/scripts/ralph-plan-cap.ts "$ARTIFACTS_DIR"

  - id: cycle
    depends_on: [plan]
    maxBudgetUsd: 50
    loop_group:
      max_iterations: 20
      until_bash: bun run .archon/scripts/ralph-cycle-cap.ts "$ARTIFACTS_DIR"
      nodes:
        - id: counts-pre-build
          script: ralph-counts
          runtime: bun
          always_run: true

        - id: build-snapshot
          depends_on: [counts-pre-build]
          when: "$counts-pre-build.output.open > 0"
          script: ralph-snapshot
          runtime: bun
          with: { mode: build }
          always_run: true

        - id: build
          depends_on: [build-snapshot]
          idle_timeout: 600000
          loop:
            command: ralph-build
            max_iterations: 200
            fresh_context: true
            until_bash: bun run .archon/scripts/ralph-build-cap.ts "$ARTIFACTS_DIR"

        - id: build-guard
          depends_on: [build]
          trigger_rule: all_done
          script: ralph-guard
          runtime: bun
          always_run: true

        - id: counts-pre-review
          depends_on: [build-guard]
          trigger_rule: all_done
          script: ralph-counts
          runtime: bun
          always_run: true

        - id: review-snapshot
          depends_on: [counts-pre-review]
          when: "$counts-pre-review.output.open == 0 && $counts-pre-review.output.shipped > 0"
          script: ralph-snapshot
          runtime: bun
          with: { mode: review }
          always_run: true

        - id: review
          depends_on: [review-snapshot]
          idle_timeout: 600000
          loop:
            command: ralph-review
            max_iterations: 7
            fresh_context: true
            until_bash: bun run .archon/scripts/ralph-review-cap.ts "$ARTIFACTS_DIR"

        - id: review-guard
          depends_on: [review]
          trigger_rule: all_done
          script: ralph-guard
          runtime: bun
          always_run: true

  - id: report
    depends_on: [cycle]
    trigger_rule: all_done
    script: ralph-report
    runtime: bun
    always_run: true
```

The YAML above is the shape, not the text: the implementation carries the full `description:`
block and the comments §3.4 names. Values are defaults; the sandbox lists in particular are a
starting point the operator edits (§3.3).

### 3.1 Phases and guards

Read against `ralph auto`'s six phases (`archive init plan build review build`):

| ralph phase | archon-ralph | Runs when |
|-------------|--------------|-----------|
| archive, init | `seed` | always |
| plan | `plan` | always |
| build | `build` (per cycle) | `open > 0`, read from the plan on disk at that moment |
| review | `review` (per cycle) | `open == 0 && shipped > 0` |
| build (second) | the next cycle's `build` | as build |

A guard that is false **skips** the phase; a skip is never a failure. The two `when:` expressions
restate ralph's `have_open_items` and `have_shipped_items` predicates. Artifact presence, which
ralph's guards also check, is asserted by `ralph-counts` itself: it exits non-zero when either
artifact is missing, because inside a lifecycle a missing artifact after `seed` is a defect, not a
state (ralph's own phase-2 assertion makes the same call).

`review` is guarded on `open == 0`, so it never audits a plan with pending work — ralph's
`require_review_preconditions`, expressed as a guard rather than a hard stop. When `build` stops
short, `review` is skipped and the next cycle's `build` picks the open items up, which is the
second use ralph gives its phase 6.

### 3.2 The cycle

One `loop_group` iteration is one ralph cycle: build to exhaustion, then review. `ralph-cycle-cap`
completes the group when, after the iteration, the plan holds zero open items **or** the cycle
count has reached `cycle_cap`. Zero open items after a cycle means one of three things, all of
which are a finished lifecycle: review ran and filed nothing; build shipped everything and review
was skipped for having nothing shipped (impossible in practice, but harmless); or plan wrote no
items and both phases were skipped. Open items after a cycle means review filed findings or build
stopped short, and the next cycle runs both phases again.

`max_iterations: 20` on the group is a ceiling `cycle_cap` never reaches; the README says
`cycle_cap` must stay below it. `maxBudgetUsd` is the money bound; its default is a placeholder
the operator sets.

### 3.3 Sandbox

Archon runs Claude with `permissionMode: bypassPermissions` unconditionally, and this workflow
runs on the live checkout. The `sandbox:` block is the boundary. The template ships the block
above and the README states what it does: writes outside the listed denials stay allowed, because
nested repositories may sit anywhere (symlinked checkouts included), so `allowWrite` is not set;
network access is an allowlist the operator extends with their own git host and registries. The
README states plainly that the sandbox is Claude's sandbox and that other providers may ignore it.

### 3.4 What the workflow file no longer says

- The `REQUIRES the marc0der/Archon fork` comment and the `--no-worktree` advice: both wrong now.
- The `model is set at the WORKFLOW level on purpose: loop nodes ignore a per-node model` comment:
  true upstream, but archon-ralph now uses one model by decision, so the comment states the
  decision, not the limitation.
- The `templates ... auto-copied into worktrees` comment.
- The `archon-ralph-dag` reference in `NOT for:`; no such workflow exists.
- The `report` agent node and `commands/ralph-report.md`.
- Every `until:` sentinel (`PLAN_STABLE`, `PLAN_COMPLETE`) and the `plan-count` node, whose work
  moves into `ralph-snapshot`.

## 4. Scripts

All scripts live in `template/scripts/`, import only Node built-ins (`node:fs`, `node:path`,
`node:crypto`, `node:child_process`), and share one library, `template/scripts/lib/ralph.ts`. Each
script guards its entry point with `if (import.meta.main)` so `test/` can import its functions
without running it. Scripts that Archon invokes by name (`script: ralph-seed`) run with the checkout
root as the working directory; the `until_bash` scripts receive the artifacts directory as
`argv[2]` and also run from the checkout root.

### 4.1 The shared library

`lib/ralph.ts` exports:

- `planItemsBody(file)` — the text from the `## Items` heading to the end, or the whole file when
  the heading is absent. Mirrors ralph's `plan_items_body`. **Every count in every script goes
  through it.** The current scripts count `^- \[ \]` over the whole file and so count the exemplar
  under `## Entry Format` as an open item; that is the bug that stops today's build loop ever
  exiting on `remaining <= 0`.
- `countItems(body, marker)` for `'[ ]'`, `'[x]'`, `'[~]'`, matching `^- \[.\]` at column zero.
- `planStateHash()` — md5 over `IMPLEMENTATION_PLAN.md` followed by, for every regular file under
  `specs/` in `LC_ALL=C` order (byte order of the relative path), following symlinks, the path and
  then the contents. An unreadable spec contributes its path only. Mirrors `plan_state_hash`.
- `repoState()` — one `<path> <sha>` line per `.git` entry found at most 6 levels below the
  checkout root, following symlinks, pruning at each `.git`, `-` where `HEAD` does not resolve,
  sorted in byte order. Mirrors `repo_state`, including its over-detection bias: a repository that
  appears or vanishes is a change, a dirty worktree is not. `git rev-parse -q --verify HEAD` is the
  form; plain `rev-parse HEAD` is forbidden for the reason `specs/nested-git-repos.md` §3 gives.
- `readSettings(artifactsDir)` — `settings.json` written by `ralph-seed` (§4.2), with defaults
  `{skip_push: false, cycle_cap: 3}`.
- `readCounter(file, fallback)`, `writeCounter(file, n)`, `appendOutcome(artifactsDir, line)` —
  the counter and outcome-log helpers every cap script uses. `outcome.log` is an append-only text
  file the report reads.
- `computeBudget(open)` — `Math.floor((open * 6 + 4) / 5)`, ralph's `ceil(open × 1.2)` in integer
  form, and `1` when `open < 1`.

### 4.2 Script contracts

**`ralph-precondition`** (exec node, fails the run on any defect, prints what it checked):

- `ARGUMENTS` is non-blank. Message: `ralph-wiggum requires a goal: archon workflow run
  ralph-wiggum "<specification or sentence>"`. Ralph made the goal mandatory for `plan` and `auto`
  because a goalless plan run in a meta repository plans against the wrong node's specs.
- The working directory is inside a git work tree.
- `HEAD` is not detached, unless the repository has no commit yet. The build loop pushes the
  current branch; a detached workspace has none.
- `bun` and `git` are on `PATH`.

**`ralph-seed`** (exec node, `always_run`). In order:

1. If `IMPLEMENTATION_PLAN.md` or `PROGRESS.md` exists at the root, move both (those present) to
   `.ralph/<YYYYMMDD-HHMMSS>/`, creating the directory lazily. This is `ralph archive` and it runs
   first for the reason `specs/auto-lifecycle.md` §2 gives: the run ends with its own artifacts in
   the tree.
2. Scaffold `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` from `.archon/ralph/templates/`. A missing
   template fails the run naming the path.
3. Create `specs/` if absent.
4. Append `IMPLEMENTATION_PLAN.md`, `PROGRESS.md` and `.ralph/` to `.gitignore` when not already
   present as whole lines, creating the file if needed and ensuring a trailing newline first. This
   is `ralph init`'s behaviour and it matters now that the run lives in the checkout.
5. Write `<ARTIFACTS_DIR>/settings.json` from `INPUTS_SKIP_PUSH` and `INPUTS_CYCLE_CAP` (defaults
   `false` and `3`). The `until_bash` scripts cannot see `INPUTS_*`, so this file is how the inputs
   reach them.
6. Record `run-start.txt`: the `repoState()` listing at the start of the run, for the report.
7. Append `seed: archived previous cycle to <dir>/`, or `seed: nothing to archive`, to
   `outcome.log`. The report reads its rows from that file alone, so every phase writes one.
8. Print **one JSON object and nothing else** to stdout:
   `{"root": "<absolute checkout root>", "archived": "<dir>" | null, "branch": "<name>"}`.
   `root` is the record of where the run acted; the prompts anchor on `pwd` instead (§6).

**`ralph-snapshot`** (exec node, `always_run`, `with: {mode: plan|build|review}` read from
`INPUTS_MODE`). Writes the pre-loop state the cap script compares against:

- `plan` and `review`: `plan-hash.txt` = `planStateHash()`; resets `<mode>-iter.txt` to `0`.
- `review` additionally: `shipped-before.txt` = the `[x]` count.
- `build`: `repo-state.txt` = `repoState()`; `build-budget.txt` = `computeBudget(open)`;
  resets `build-iter.txt` and `build-noops.txt` to `0`.

Snapshots run once per phase per cycle, so the build budget is recomputed from the open count each
cycle, exactly as a fresh `ralph build` would compute it.

**`ralph-counts`** (exec node, `always_run`). Prints one JSON object:
`{"open": N, "shipped": N, "superseded": N}` from `planItemsBody`. Exits non-zero naming the file
when `IMPLEMENTATION_PLAN.md` or `PROGRESS.md` is missing.

**`ralph-plan-cap`** (`until_bash` of `plan`):

1. `n = plan-iter + 1`, written back.
2. `after = planStateHash()`; `before` from `plan-hash.txt`; write `after` to `plan-hash.txt`.
3. If `before == after`: append `plan: converged on pass n` to `outcome.log`, exit 0.
4. If `n >= 6` (ralph's `PLAN_DEFAULT_CAP`): append `plan: reached the cap of 6 passes`, exit 0.
5. Else exit 1.

**`ralph-build-cap`** (`until_bash` of `build`):

1. `n = build-iter + 1`, written back.
2. `after = repoState()`; `before` from `repo-state.txt`; write `after` back.
3. `noop = (before == after)`. If noop, `noops += 1`, else `noops = 0`; written back.
4. Push, unless `settings.skip_push`. Evaluated every iteration against the workspace as it
   stands:
   - no `origin` remote (`git remote get-url origin` fails): print `No 'origin' remote — skipping
     push.`
   - `HEAD` does not resolve: print `No commit on the workspace branch — skipping push.`
   - otherwise `git push origin <branch>`; when the output contains `has no upstream branch`,
     retry with `git push -u origin <branch>`.
   - a push git rejects: write `abort.txt` with `build: push rejected` and git's output, append the
     same to `outcome.log`, **exit 0**. The loop completes and `build-guard` fails the run (§4.3).
5. `open = countItems('[ ]')`. Complete (exit 0) on the first of: `open == 0` (`plan exhausted`),
   `noops >= 2` (`no changes for 2 consecutive iterations`), `n >= budget` (`budget of B spent`).
   Each appends `build: n iterations, <reason>` to `outcome.log`. Else exit 1.

The push happens before the exit decision so that the last iteration's commits are pushed, as in
ralph where the push block precedes the early-exit check.

**`ralph-review-cap`** (`until_bash` of `review`):

1. `n = review-iter + 1`, written back.
2. `shipped = countItems('[x]')`. If `shipped < shipped-before`: write `abort.txt` with `review:
   reduced the shipped item count from A to B; review may never un-tick an item. Restore
   IMPLEMENTATION_PLAN.md before re-running.`, append to `outcome.log`, exit 0.
3. Hash comparison and cap exactly as `ralph-plan-cap`, with messages `review: converged on pass n,
   audited S shipped items` and `review: reached the cap of 6 passes`.

**`ralph-guard`** (exec node, `trigger_rule: all_done`, `always_run`): if `abort.txt` exists, print
its contents to stderr and exit 1; else exit 0. This is the only place a run fails for a loop-side
reason, because `until_bash` cannot fail a node (§2). The marker is written by exactly two paths:
a rejected push and a review un-tick.

**`ralph-cycle-cap`** (`until_bash` of `cycle`):

1. `cycles = cycle-iter + 1`, written back.
2. `open = countItems('[ ]')`. If `open == 0`: append `cycle N: clean — no open items remain`,
   exit 0.
3. If `cycles >= settings.cycle_cap`: append `cycle N: reached the cycle cap of C with open items
   remaining`, exit 0.
4. Else append `cycle N: O open items remain — starting cycle N+1`, exit 1.

**`ralph-report`** (exec node, `trigger_rule: all_done`, `always_run`). Prints, to stdout, the
lifecycle summary ralph's `auto_report` prints, from `outcome.log`, the counters, `abort.txt`,
`run-start.txt` and the plan:

```
Ralph lifecycle summary
  seed     ran — archived previous cycle to .ralph/20260917-101500/
  plan     ran — converged on pass 3
  cycle 1
    build  ran — 9 iterations, plan exhausted
    review ran — converged on pass 2, audited 9 shipped items, filed 2 findings
  cycle 2
    build  ran — 3 iterations, plan exhausted
    review ran — converged on pass 1, audited 11 shipped items, filed 0 findings
  Result: clean after 2 cycles

Plan: 11 shipped, 0 open, 1 superseded
Repositories that moved: . (4 commits), source/svc (7 commits)
Artifacts: IMPLEMENTATION_PLAN.md and PROGRESS.md in the tree; previous cycle under .ralph/<timestamp>/
```

The phase rows come from `outcome.log` alone. The report splits the file into cycles on its `cycle
N:` lines: the lines before the first `cycle` line are `seed` and `plan`, and the lines after a
`cycle` line belong to the next cycle. A cycle block with no `build:` line reports `build skipped —
no open items`. A cycle block with no `review:` line reports `review skipped — N open items remain`
when its `cycle N:` line names open items, and `review skipped — no shipped items to audit` when
that line says `clean`. The `filed F findings` clause on a `review` row is the open count the same
`cycle N:` line names, and `0` when that line says `clean`. An abort is reported `failed —
<abort.txt first line>` and the report exits 0: it is a report, the guard already failed the run.
Per-repository commit counts come from `git -C <repo> rev-list --count <start>..HEAD` where both
shas exist, else the repository is listed as `moved`.

**Decision, 2026-09-17.** `ralph-snapshot` resets every counter file at the start of each cycle, so
the counters hold the last cycle's numbers only. Every per-cycle figure the report prints therefore
has to be in `outcome.log`, which is why `ralph-build-cap` writes its iteration count into the line
and `ralph-seed` writes a row of its own.

### 4.3 Why a marker and a guard

`until_bash` has two outcomes, complete and continue, and Archon fails a loop node only when
`max_iterations` is exhausted. Ralph has two conditions that must stop the whole run mid-loop: a
push git rejects and a review pass that un-ticks a shipped item. Each cap script writes `abort.txt`
and completes the loop; the guard node that follows every guarded loop reads the marker and fails.
`trigger_rule: all_done` on the guard is what lets it run when the loop it follows was skipped, in
which case it finds no marker and exits 0.

## 5. Templates

- `template/ralph/templates/IMPLEMENTATION_PLAN.md` is replaced by ralph's
  `templates/IMPLEMENTATION_PLAN.md` at `36e8c8b`, verbatim: three headings, the six-field
  exemplar, the rules, the three markers. The current three-field template is what the old prompts
  wrote to; the new prompts write the new shape.
- `template/ralph/templates/PROGRESS.md` is unchanged; it already matches ralph's.

## 6. Prompts

`template/commands/ralph-plan.md`, `ralph-build.md` and `ralph-review.md` are produced from
ralph's `prompts/plan.md`, `prompts/build.md` and `prompts/review.md` at `36e8c8b` by these
substitutions and no others:

**Decision, 2026-09-17.** Ralph's prompts and the plan template of §5 come from a sibling
checkout at `../ralph`, which carries `marc0der/ralph` as its `upstream` remote. Fetch `upstream`
there when `36e8c8b` does not resolve. The sync script of §11 replaces that manual step.

1. **Frontmatter.** Each file keeps a YAML frontmatter with `description:` (one line, present
   tense, naming the loop) and, for `ralph-plan.md` only, `argument-hint: "<goal>"`. Add
   `source: marc0der/ralph@36e8c8b prompts/<name>.md` so the next sync knows the baseline.
2. **Goal.** In `ralph-plan.md`, `{{GOAL}}` becomes `$ARGUMENTS`. `ralph-build.md` and
   `ralph-review.md` carry no goal, exactly as ralph's do; the current `(If the goal above is
   blank, ...)` paragraphs are gone with the `## Goal` blocks.
3. **Workspace anchor.** The anchor paragraph reads: "The workspace root is the directory this
   session starts in. Run `pwd` once and use that absolute path wherever this prompt names the
   root." Every remaining `{{WORKSPACE}}/` prefix is dropped, leaving the artifact paths
   root-relative.

   **Decision, 2026-09-17.** The earlier text made the anchor `$seed.output.root`, conditional on
   verifying that a loop's command prompt passes through `substituteWorkflowVariables`. Archon
   v0.10.1 is installed here as a stripped binary and its source tree is absent, so that check
   needs a live run to settle. The `pwd` wording is correct whether or not the substitution
   happens, so the prompts take it unconditionally and no plan item carries the check. `ralph-seed`
   still prints `root` in its JSON: the report and a future anchor change both want it.
4. **Loop control.** The `## Loop control (Archon)` sections are deleted. Nothing replaces them:
   ralph's `## Convergence` sections already tell the agent that an unchanged plan is a finished
   plan and that it must not pad the file. No prompt mentions a promise token, a sentinel, or a
   consecutive-noop rule.
5. **Subagents.** Ralph's wording stands: "If your harness supports subagents, use them ...", "A
   subagent returns evidence, never a conclusion", "Never run build or test commands in more than
   one subagent at a time". The current "up to 50 parallel Sonnet subagents", "Opus reasoning
   subagent with ultrathink" and `dev-browser --headless` lines are gone with the old text.

Everything else in the three files is ralph's text unchanged: the six-field schema and its caps,
Simplified Technical English, the `[~]` path, the never-edit-`specs/` rule in build, the
**Where to commit** and **How to commit** blocks, review's two checks, two severities, finding
budget of 5, coverage line and the three review-only editing rules.

`template/commands/ralph-report.md` is deleted.

## 7. CLI, README and packaging

**`bin/cli.ts`** keeps skip-by-default. Changes:

- The help and the final hint say `archon workflow run ralph-wiggum "<goal>"`, not `-g`.
- After a run that skipped files, print: `Skipped files are not updated. Re-run with --force to
  bring .archon/ up to date; --force also overwrites ralph/templates/.`
- `package.json` version becomes `0.2.0`.

**`README.md`** is rewritten to describe the workflow in §3: the phases and their guards, the
fixpoint and `cycle_cap`, the inputs (`--input skip_push=true`, `--input cycle_cap=2`), the sandbox
block and how to extend it, the live-checkout policy and what it means for meta repositories
(supported; the agent commits where the file lives; the harness pushes the workspace only), the
upgrade rule for `init`, and prompt provenance. The **Why the fork?** section is deleted and the
requirement becomes "Archon v0.6.0 or later". The **What gets installed** tree lists the new
scripts, the `lib/` directory and no `ralph-report.md`. The plan-contract summary links to ralph's
README rather than restating it.

**Packaging.** `template/package.json` and `template/tsconfig.json` stay. `tsconfig.json`'s
`include` at the repo root gains `test/**/*.ts` and `template/scripts/**/*.ts` so one `tsc
--noEmit` covers everything; `typescript` joins `devDependencies`.

## 8. Repository hygiene

archon-ralph has no tests and no guardrails file, so ralph's build agent has no verification
command to run and ralph's plan agent can write no terminal verification item. This spec adds both.

- **`AGENTS.md`** at the repository root (and `CLAUDE.md` as an identical copy, since the
  prompts read either): what archon-ralph is, the layout (`bin/`, `template/`, `test/`), the
  verification gate `bun run verify`, the conventions below, and a **Keep in step with ralph**
  section naming ralph's three prompts and template as the upstream of `template/commands/` and
  `template/ralph/templates/`.
- **`package.json` scripts**: `"test": "bun test"`, `"typecheck": "tsc --noEmit"`,
  `"verify": "bun run typecheck && bun test"`.
- **Conventions**: Conventional Commits with an imperative subject of at most 50 characters,
  atomic commits, scripts import Node built-ins only, every script is importable
  (`import.meta.main` guard), every count goes through `planItemsBody`, and every test wraps its
  body in `withTempRepo` from `test/helpers.ts` (§9).

## 9. Testing

Tests live in `test/*.test.ts` and run with `bun test`. They import from `template/scripts/` and
`template/scripts/lib/`; nothing under `template/` is a test, because `bin/cli.ts` copies that tree
into projects. Each test runs in a fresh temporary directory under `$TMPDIR` with `git init`, a
mock `ARTIFACTS_DIR`, and `process.chdir` into it, and restores the previous directory afterwards.

**Decision, 2026-09-17.** That setup is one shared helper, `test/helpers.ts`, exporting
`withTempRepo(fn)`; no test rolls its own. Ralph keeps the same fixture in
`test/test_helper.bash`. `withTempRepo` mints the directory, runs `git init`, sets
`process.env.ARTIFACTS_DIR` to an `artifacts/` subdirectory, `chdir`s in, calls `fn({root,
artifactsDir})`, and restores the previous directory and environment in a `finally`.

- `withTempRepo` chdirs into a fresh directory, exposes `artifactsDir`, and restores the previous
  working directory even when the body throws.

- `planItemsBody` returns the text below `## Items`, and the whole file when the heading is absent.
- The exemplar under `## Entry Format` counts as nothing: a freshly scaffolded plan has `open == 0`.
- `countItems` counts `[ ]`, `[x]` and `[~]` at column zero only; an indented marker is not counted.
- `planStateHash` changes when the plan changes, when a spec changes, when a spec is added or
  removed, and when a symlinked spec's target changes; it is stable across two calls with no change.
- `repoState` lists the root repository; lists a nested repository; follows a symlinked directory
  to a repository outside the temp root; records `-` for a commitless repository; does not list a
  repository whose `.git` sits at depth 7; is unchanged by a dirty worktree; changes when a nested
  repository commits, appears, or vanishes.
- `computeBudget` returns 1 for 0 items, 2 for 1, 6 for 5, 12 for 10.
- `ralph-precondition` fails on a blank `ARGUMENTS`, outside a work tree, and on a detached `HEAD`
  with a commit; passes on an unborn branch.
- `ralph-seed` archives both artifacts to `.ralph/<timestamp>/`, prints `Nothing to archive` via
  `archived: null` when there is nothing, scaffolds both artifacts, creates `specs/`, appends the
  three `.gitignore` entries once and never twice, writes `settings.json` from `INPUTS_*` with
  defaults, and prints a single JSON object whose `root` is the absolute temp directory.
- `ralph-snapshot` writes `plan-hash.txt` for `plan` and `review`, `shipped-before.txt` for
  `review`, and `repo-state.txt`, `build-budget.txt` and zeroed counters for `build`.
- `ralph-counts` prints the three counts as JSON and exits non-zero naming the missing artifact.
- `ralph-plan-cap` continues while the hash changes, completes on an unchanged hash, completes on
  pass 6 whatever the hash, and appends the matching `outcome.log` line.
- `ralph-build-cap` continues while repositories move; completes after two consecutive noops;
  completes when `open` reaches 0; completes when the iteration count reaches the budget; pushes to
  a bare `origin` and moves its branch; sets upstream when the branch has none; skips with the
  exact message when there is no `origin` and when there is no commit; writes `abort.txt` and exits
  0 when `origin` rejects the push; does neither skip line nor push under `skip_push: true`; treats
  a commit in a nested repository as progress.
- `ralph-review-cap` writes `abort.txt` and exits 0 when the shipped count drops; converges on an
  unchanged hash with the audited count in the message; caps at 6.
- `ralph-guard` exits 1 and prints the marker when `abort.txt` exists, exits 0 otherwise.
- `ralph-cycle-cap` completes on zero open items, completes at `cycle_cap`, continues otherwise,
  and appends the matching line.
- `ralph-report` renders `ran`, `skipped — <reason>` and `failed — <reason>` rows from fixture
  `outcome.log`, counter and marker files, and exits 0 in every case.
- The workflow YAML parses; every `depends_on` and every `$<node>.output` reference in `when:` and
  `until_bash` names a node in scope; every `loop:` and `loop_group:` declares `until_bash` and
  `max_iterations` and no `until:`; every node that depends on a `loop:` or `loop_group:` node
  declares `trigger_rule: all_done`; every `script:` names a file under `template/scripts/`; every
  `loop.command` names a file under `template/commands/`.

  **Decision, 2026-09-17.** The earlier wording made the rule "every node after a `when:`-guarded
  node in the cycle body". That contradicts the workflow of §3, where `build` and `review` follow a
  guarded snapshot and declare no `trigger_rule`, because §3.1 requires a false guard to skip the
  phase itself. The rule the workflow actually obeys is the one §4.3 states: the node after a loop
  must run even when that loop was skipped, so it declares `trigger_rule: all_done`. The four such
  nodes are `build-guard`, `counts-pre-review`, `review-guard` and `report`.
- The three command files contain no `{{GOAL}}`, no `{{WORKSPACE}}`, no `<promise>`, no `PLAN_STABLE`,
  no `PLAN_COMPLETE`, no `dev-browser`, and no `50 parallel`; only `ralph-plan.md` contains
  `$ARGUMENTS`; all three contain the anchor reference.
- `bin/cli.ts init` into a temp directory creates every template file; a second run skips them all
  and prints the `--force` hint; `--force` rewrites them.

Prompt prose has no test beyond the token checks above, by ralph's convention that no test asserts
prose. Plan items that edit a prompt carry a `grep -c` criterion on a phrase they add or remove.

## 10. Out of scope

- Per-node models and any fork requirement.
- Ralph's `metrics.jsonl`, `ralph metrics`, raw stream retention and `--verbose` rendering. Archon
  records per-node cost and tokens; `archon workflow logs` is the surface.
- A devcontainer or any `DEVCONTAINER` guard.
- Approval gates or interactive loops; the run is unattended like `ralph auto`.
- `--resume` semantics beyond what Archon's `workflow resume` already provides.
- Carrying `PROGRESS.md` across lifecycles; the archive-first loss ralph accepts is accepted here.
- Warning about unpushed nested commits; excluding transient repositories from the fingerprint.
- Reviewing an archived plan; a plan path input.
- A version stamp or refuse-on-stale behaviour for `init`.
- Multi-provider prompts; `provider: claude` stays the default and the prompts are backend-neutral.
- Publishing to npm.

## 11. Follow-ups

- **Syncing prompts from ralph.** A script that fetches ralph's three prompts and template at a
  named sha and applies §6's substitutions would make the next update mechanical. The `source:`
  frontmatter field is its input.
- **Warn about unpushed nested commits.** For each nested entry whose `HEAD` moved in an
  iteration, `git -C <repo> rev-list --count @{upstream}..HEAD` says whether the agent pushed.
- **Per-iteration cost.** Archon's `loop_iteration_completed` events carry no cost or tokens. If
  that changes upstream, `ralph-report` can total them per phase.
- **Per-phase models.** When node-level `model:` on loop nodes lands upstream, `plan` and `review`
  on a stronger model than `build` recovers the cheap-builder half of ralph's contract without a
  fork.
