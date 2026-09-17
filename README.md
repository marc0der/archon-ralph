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

| Input | Default | Meaning |
|---|---|---|
| `--input skip_push=true` | `false` | Keep every commit local; the build loop never pushes. |
| `--input cycle_cap=2` | `3` | Stop after this many build/review cycles, open items or not. |

Keep `cycle_cap` below the cycle's `max_iterations` of 20. That ceiling is Archon's safety net and
exhausting it **fails** the run, where reaching `cycle_cap` ends it cleanly with a report.

## The sandbox and the live checkout

The workflow runs on your **live checkout** — `worktree: {enabled: false}`, like ralph. There is no
branch copy and no scratch directory: the build agent commits and pushes on the branch you are on,
and the run stops before the first phase if `HEAD` is detached. Commit or stash anything you do not
want the loop to touch.

Meta repositories are supported. The agent commits each changed file into the repository that owns
it — the one `git -C <dir> rev-parse --show-toplevel` names — and pushes that repository itself.
The build loop's own push touches the workspace and nothing else.

Archon runs Claude with `permissionMode: bypassPermissions`, so the `sandbox:` block in
`workflows/ralph-wiggum.yaml` is the boundary:

```yaml
sandbox:
  enabled: true
  autoAllowBashIfSandboxed: true
  filesystem:
    denyWrite: ["~/.ssh", "~/.gnupg", "~/.aws", "~/.config/gh", "~/.archon/config.yaml"]
  network:
    allowedDomains: ["github.com", "api.github.com", "registry.npmjs.org", "bun.sh"]
```

Extend it by editing that block: add paths to `denyWrite`, and add your git host and package
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
├── workflows/ralph-wiggum.yaml     # the workflow definition
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
`marc0der/ralph@36e8c8b`, carrying only the substitutions this workflow needs. Each one records
that baseline in its `source:` frontmatter line — check it before porting a change from upstream.

## License

MIT
