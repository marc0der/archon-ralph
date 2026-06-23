# archon-ralph

Scaffold the **Ralph Wiggum** autonomous plan/build loop — a port of
[marc0der/ralph](https://github.com/marc0der/ralph) to an
[Archon](https://archon.diy) workflow — into any project.

It drops a self-contained `.archon/` workflow into your repo that:

1. **Seeds** loop artifacts (`IMPLEMENTATION_PLAN.md`, `PROGRESS.md`) from templates.
2. Runs a **PLAN** loop (≤ 3 fresh passes) that writes `IMPLEMENTATION_PLAN.md` from `specs/` + the codebase.
3. Sizes a **BUILD budget** (incomplete items + 20 % headroom).
4. Runs **BUILD** iterations — each with a *fresh* context — implementing one plan item, testing, committing, pushing — until the plan is exhausted or the budget is spent.
5. **Reports** the run, then **archives** the artifacts to `.ralph/<timestamp>/`.

## Requirements

- [Archon CLI](https://archon.diy) (`archon`)
- [Bun](https://bun.sh) (the loop-control scripts run via `bun run`)

## Install into a project

```bash
cd your-project
bunx archon-ralph init
```

This copies the workflow into `your-project/.archon/`, skipping any files that
already exist. Re-run with `--force` to overwrite:

```bash
bunx archon-ralph init --force
```

Options:

| Flag | Meaning |
|---|---|
| `--force`, `-f` | Overwrite existing files instead of skipping them |
| `--dir <path>` | Target project root (default: current directory) |
| `--help`, `-h` | Show help |

## Run the loop

```bash
archon workflow run ralph-wiggum -g "your goal here"
```

By default Archon runs the workflow in a fresh git worktree off your base
branch. To run against your current checkout instead, add `--no-worktree`
(or `--from <branch>` to base the worktree elsewhere).

## What gets installed

```
.archon/
├── config.yaml                     # project-scoped Archon config (stub)
├── package.json / tsconfig.json    # Bun project for the control scripts
├── workflows/ralph-wiggum.yaml     # the workflow definition
├── commands/                       # plan / build / report prompts
│   ├── ralph-plan.md
│   ├── ralph-build.md
│   └── ralph-report.md
├── ralph/templates/                # user-editable artifact templates
│   ├── IMPLEMENTATION_PLAN.md
│   └── PROGRESS.md
└── scripts/                        # loop-control scripts (Node built-ins only)
    ├── ralph-seed.ts
    ├── ralph-plan-cap.ts
    ├── ralph-plan-count.ts
    ├── ralph-build-cap.ts
    └── ralph-archive.ts
```

The scripts import only Node built-ins, so the installed `.archon/` needs no
runtime dependencies. `bun install` inside it is optional — it only pulls
`@types/bun` for editor/type-check DX.

## License

MIT
