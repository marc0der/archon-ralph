# archon-ralph

Guidance for coding agents (Claude Code and friends) working in this repository.

## What is archon-ralph?

archon-ralph packages the [ralph](https://github.com/marc0der/ralph) autonomous plan/build/review
loop as an [Archon](https://archon.diy) workflow. `bunx archon-ralph init` copies `template/` into
a target project's `.archon/`, where Archon drives the lifecycle: seed → plan loop → a
`loop_group` fixpoint of build and review → report.

This repository ships machinery, not an application. Nothing under `template/` runs here; it runs
in the projects that install it.

## Layout

| Path | Contents |
|---|---|
| `bin/cli.ts` | The `init` installer. Copies `template/` into `<dir>/.archon/`. |
| `template/workflows/` | `ralph-wiggum.yaml` composes `ralph-plan.yaml`, `ralph-build.yaml` and `ralph-review.yaml` with `include:`. |
| `template/commands/` | The loop prompts Archon reads through `loop.command`. |
| `template/scripts/` | Loop-control Bun scripts, sharing `template/scripts/lib/ralph.ts`. |
| `template/ralph/templates/` | User-editable `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` seeds. |
| `test/` | `bun test` suites. They import from `template/scripts/`. |
| `specs/` | The decision record. Never edit a spec to fit an implementation. |

`IMPLEMENTATION_PLAN.md`, `PROGRESS.md` and `.ralph/` at the root are this repository's own loop
artifacts. They are gitignored and never committed.

## Verification gate

```bash
bun run verify      # tsc --noEmit, then bun test — the gate
bun run typecheck   # types only
bun test            # tests only
bun test test/seed.test.ts   # one file
```

`bun run verify` must pass before any commit. One `tsc --noEmit` covers `bin/`, `test/` and
`template/scripts/`, so a type error inside the shipped template fails the gate here rather than
in a user's project.

## Conventions

- **Commits.** [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>):
  <subject>`, imperative mood, lowercase, at most 50 characters, no trailing period. Keep commits
  atomic — one concern each, in dependency order.
- **Node built-ins only.** Every script under `template/scripts/` imports from `node:fs`,
  `node:path`, `node:crypto` and `node:child_process` and nothing else. An installed `.archon/`
  has no runtime dependencies, and `bun install` inside it stays optional.
- **Every script is importable.** Guard the entry point with `if (import.meta.main)` and export a
  `main()`, so `test/` can exercise the functions without running the script.
- **Every count goes through `planItemsBody`.** Counting markers over the whole plan file counts
  the exemplar under `## Entry Format` as a real item. `planItemsBody` and `countItems` from
  `template/scripts/lib/ralph.ts` are the only counting path.
- **Every test wraps its body in `withTempRepo`.** `test/helpers.ts` mints the temporary
  directory, runs `git init`, sets `ARTIFACTS_DIR`, `chdir`s in and restores afterwards. No test
  rolls its own fixture, and no test writes into this repository.

## Keep in step with ralph

`template/commands/` and `template/ralph/templates/` are downstream copies of ralph, not original
work. Their upstream is the sibling checkout at `../ralph`, which carries `marc0der/ralph` as its
`upstream` remote; `git -C ../ralph fetch upstream` when a baseline commit does not resolve.

| Here | Upstream in `../ralph` |
|---|---|
| `template/commands/ralph-plan.md` | `prompts/plan.md` |
| `template/commands/ralph-build.md` | `prompts/build.md` |
| `template/commands/ralph-review.md` | `prompts/review.md` |
| `template/ralph/templates/IMPLEMENTATION_PLAN.md` | `templates/IMPLEMENTATION_PLAN.md` |
| `template/ralph/templates/PROGRESS.md` | `templates/PROGRESS.md` |

The current baseline is `f6d2405`, recorded in each prompt's `source:` frontmatter line. Port
ralph's text verbatim and confine local edits to the substitutions
`specs/archon-native-lifecycle.md` §6 lists. Where this repository and ralph disagree on a rule
the *agent* follows, ralph wins: archon-ralph changes how the agent is driven, not what it is told.
