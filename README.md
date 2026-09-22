# archon-ralph

Scaffold the **Ralph Wiggum** autonomous plan/build/review lifecycle — a port of
[marc0der/ralph](https://github.com/marc0der/ralph) to an
[Archon](https://archon.diy) workflow — into any project.

It drops a self-contained `.archon/` workflow into your repo that:

1. **Seeds.** Archives the previous cycle's artifacts to `.ralph/<timestamp>/`, then scaffolds
   `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` from the templates.
2. **Plans.** A loop that rewrites `IMPLEMENTATION_PLAN.md` from `specs/` and the codebase, each
   pass with a *fresh* context. It stops when a pass leaves the plan and `specs/` unchanged, or
   after 6 passes.
3. **Cycles.** Build, then review, repeated as one `loop_group` iteration.
   - **Build** runs when the plan holds open items. Each iteration implements one item with a
     fresh context, tests, commits and pushes. It stops when the plan is exhausted, when two
     iterations in a row leave every repository unmoved, or when the budget — the open count plus
     20 % headroom — is spent.
   - **Review** runs when build left **no** open items and at least one shipped item. Each pass
     audits the shipped items and files findings as new open items. It stops when a pass changes
     nothing, or after 6 passes.
4. **Reports.** A factual summary of every phase, the plan counts and the repositories that moved.

A guard that is false **skips** its phase; a skip is never a failure. Build stopping short skips
review, and the next cycle picks the open items up.

The cycle is a fixpoint. It ends when a cycle leaves zero open items — a review pass that files
nothing — or when the cycle count reaches `cycle_cap`, whichever comes first.

The plan file's contract — the item schema, its six fields and its markers — is ralph's. See
[The implementation plan contract](https://github.com/marc0der/ralph#the-implementation-plan-contract)
in ralph's README.

## Requirements

- **[Archon](https://archon.diy) v0.6.0 or later** — `loop.command` resolves an extracted command
  file from that release onwards. Earlier versions cannot run this workflow.
- [Bun](https://bun.sh) (the loop-control scripts run via `bun run`)

## Install into a project

```bash
cd your-project
bunx github:marc0der/archon-ralph init
```

> Once published to npm, the shorter `bunx archon-ralph init` will also work.

This copies the workflow into `your-project/.archon/`, skipping any file that already exists — so
re-running over an install never clobbers your edits. Re-run with `--force` to overwrite, which
also replaces the user-editable `ralph/templates/`:

```bash
bunx github:marc0der/archon-ralph init --force
```

Options:

| Flag | Meaning |
|---|---|
| `--force`, `-f` | Overwrite existing files instead of skipping them |
| `--dir <path>` | Target project root (default: current directory) |
| `--help`, `-h` | Show help |

## Run the loop

```bash
archon workflow run ralph-wiggum "your goal here"
```

The goal is the positional message — there is no `-g` flag. It reaches the prompts as
`$ARGUMENTS`, and the run stops before the first phase without one.

Each phase also runs on its own, like ralph's `plan`, `build` and `review` commands.
`ralph-wiggum` is the three of them composed:

| Workflow | Runs | Goal |
|---|---|---|
| `ralph-plan` | the plan loop: rewrite `IMPLEMENTATION_PLAN.md` from `specs/` and the code | required |
| `ralph-build` | the build loop: implement the open items, test, commit, push | none |
| `ralph-review` | the review loop: audit the shipped items, file findings as open items | none |
| `ralph-wiggum` | plan, then build/review as a `loop_group` to the fixpoint, then report | required |

`ralph-plan` and `ralph-wiggum` **require** the goal, and stop before the first phase without one.
`ralph-build` and `ralph-review` take **none** — the plan in the tree is their whole input — and a
positional message passed to either is neither required nor refused, because inside `ralph-wiggum`
it is the parent's goal.

A phase workflow that has nothing to do is **skipped and reported**, never an error: `ralph-build`
on a plan with no open items and `ralph-review` on one with open items or nothing shipped both exit
0 with a report. That is the same guard the lifecycle uses, so the two entry points behave alike.

| Input | Default | Meaning |
|---|---|---|
| `--input skip_push=true` | `false` | Keep every commit local; the build loop never pushes. |
| `--input cycle_cap=2` | `3` | Stop after this many build/review cycles, open items or not. |

`skip_push` is declared by `ralph-build` and `ralph-wiggum`, `cycle_cap` by `ralph-wiggum` alone;
`ralph-plan` and `ralph-review` take no inputs.

Keep `cycle_cap` below the cycle's `max_iterations` of 20. That ceiling is Archon's safety net and
exhausting it **fails** the run, where reaching `cycle_cap` ends it cleanly with a report.

`cycle_cap` bounds the cycles; the cycle node's `maxBudgetUsd` bounds the money. The `50` in
`ralph-wiggum.yaml` is a placeholder — raise or lower it to what a run is worth to you, because
exceeding it **fails** the run.

To see the shape of a run before spending any of that, add `--dry-run` — the equivalent of ralph's
`ralph auto --dry-run`:

```bash
archon workflow run ralph-wiggum "your goal here" --dry-run
```

It simulates the DAG, printing the nodes, their order and their guards, and runs nothing: no
agent, no script, no commit.

## Supervised first cycle

`ralph-wiggum` does whatever your specs and prompts tell it to, in a run you are not watching. A
weak `Done when` costs you one iteration by hand and a whole build phase unattended.

Run a cycle yourself first:

1. `archon workflow run ralph-plan "<goal>"`, then read `IMPLEMENTATION_PLAN.md`. Are the items
   small enough for one iteration? Can the agent check every `Done when` without you?
2. `archon workflow run ralph-build --input skip_push=true`, then read the commits. This is what
   tells you whether your `CLAUDE.md` or `AGENTS.md` names the right test command, and
   `skip_push=true` keeps the branch local while you find out.
3. `archon workflow run ralph-review`, once build has emptied the plan. Findings about style or
   taste mean the prompts need work, not more iterations.
4. Tune the prompts in `.archon/commands/`. Iterate on those, not on the loop.

Each step leaves the plan and the log in the tree for the next one to pick up: the phase workflows
scaffold an artifact only when it is absent, and archive nothing. Only `ralph-wiggum` archives, at
the start of its run.

Once a hand-run cycle gives you a plan you would have written and commits you would have made,
`ralph-wiggum` runs the same thing without the waiting.

## A failed run is re-run from scratch

Resume is **unsupported**. There is no way to restart a failed `ralph-wiggum` run at the phase it
died in; run the workflow again from the start.

Nothing is lost by doing so. `ralph-wiggum` archives before it plans, so the plan the failed run
worked from is under `.ralph/<timestamp>/`, and every commit its build loop already made is in
git. A mistaken `archon workflow resume` is harmless rather than useful: it stops at the same
guard, on the same abort marker, with the live plan untouched.

## The sandbox and the live checkout

The workflow runs on your **live checkout** — `worktree: {enabled: false}`, like ralph. There is no
branch copy and no scratch directory: the build agent commits and pushes on the branch you are on,
and the run stops before the first phase if `HEAD` is detached. Commit or stash anything you do not
want the loop to touch.

Meta repositories are supported. The agent commits each changed file into the repository that owns
it — the one `git -C <dir> rev-parse --show-toplevel` names — and pushes that repository itself.
The build loop's own push touches the workspace and nothing else.

Archon runs Claude with `permissionMode: bypassPermissions`, so the `sandbox:` block in the
workflow file is the boundary:

```yaml
sandbox:
  enabled: true
  autoAllowBashIfSandboxed: true
  filesystem:
    denyWrite: ["~/.ssh", "~/.gnupg", "~/.aws", "~/.config/gh", "~/.archon/config.yaml"]
  network:
    allowedDomains: ["github.com", "api.github.com", "registry.npmjs.org", "bun.sh"]
```

All four workflow files declare that same block, and each one governs its own nodes: Archon writes
an included file's `sandbox:` onto its own nodes before inlining them, so a composed `ralph-wiggum`
run executes the plan, build and review phases under the **phase file's** boundary rather than its
own. Extending the boundary therefore means editing all four files — `ralph-wiggum.yaml`,
`ralph-plan.yaml`, `ralph-build.yaml` and `ralph-review.yaml` — and a block widened in one of them
alone applies to that phase only.

Extend it by editing those blocks: add paths to `denyWrite`, and add your git host and package
registries to `allowedDomains` — a domain that is not listed is not reachable, so a push to a
self-hosted forge fails until you list it. `allowWrite` is deliberately unset: a nested repository,
symlinked checkouts included, may sit anywhere under the workspace, and a write allowlist would
block its commits.

The block is **Claude's** sandbox. Another provider may ignore it, so read it as a guard rail on
the supported path rather than as containment.

## What gets installed

```
.archon/
├── config.yaml                     # project-scoped Archon config (stub)
├── package.json / tsconfig.json    # Bun project for the control scripts
├── workflows/                      # the workflow definitions
│   ├── ralph-wiggum.yaml           # the full lifecycle; composes the three below
│   ├── ralph-plan.yaml             # the plan phase, standalone
│   ├── ralph-build.yaml            # the build phase, standalone
│   └── ralph-review.yaml           # the review phase, standalone
├── commands/                       # plan / build / review prompts
│   ├── ralph-plan.md
│   ├── ralph-build.md
│   └── ralph-review.md
├── ralph/templates/                # user-editable artifact templates
│   ├── IMPLEMENTATION_PLAN.md
│   └── PROGRESS.md
└── scripts/                        # loop-control scripts (Node built-ins only)
    ├── lib/ralph.ts                # counts, fingerprints, settings, counters
    ├── ralph-precondition.ts       # refuse a goalless, detached or non-repo run
    ├── ralph-seed.ts               # archive the last cycle, scaffold, ignore
    ├── ralph-snapshot.ts           # reset a phase's counters and fingerprints
    ├── ralph-counts.ts             # open / shipped / superseded, for the guards
    ├── ralph-guard.ts              # fail the run on a cap script's abort marker
    ├── ralph-plan-cap.ts           # plan loop: converge or cap
    ├── ralph-build-cap.ts          # build loop: exhaust, noop, budget, push
    ├── ralph-review-cap.ts         # review loop: converge or cap
    ├── ralph-cycle-cap.ts          # the fixpoint: zero open items or cycle_cap
    └── ralph-report.ts             # the closing summary
```

The scripts import only Node built-ins, so the installed `.archon/` needs no
runtime dependencies. `bun install` inside it is optional — it only pulls
`@types/bun` for editor/type-check DX.

The three prompts under `commands/` are ralph's `prompts/plan.md`, `build.md` and `review.md` at
`marc0der/ralph@f6d2405`, carrying only the substitutions this workflow needs. Each one records
that baseline in its `source:` frontmatter line — check it before porting a change from upstream.

## License

MIT
