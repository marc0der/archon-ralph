# Workspace Root Anchoring

Settled on 2026-09-30, after a `ralph-wiggum` run in a meta repository anchored its root on a
node's `source/` clone instead of the meta-repo checkout. This spec amends
`specs/archon-native-lifecycle.md` — **the lifecycle spec** throughout. §2 lists every amendment,
and nothing outside that list changes. A bare `§n` names a section of this spec.

This change has no `marc0der/ralph` counterpart. Ralph anchors its prompts with a `{{WORKSPACE}}`
substitution the harness fills; archon-ralph dropped that substitution and anchored on `pwd`
instead (the lifecycle spec §6, item 3). The defect is archon-ralph's own, so this spec names no
baseline commit and records no upstream file to read first. It is the whole of the delta.

## 1. The defect

The lifecycle spec §6 item 3 made every prompt's root "the directory this session starts in", found
by one `pwd`. That wording is correct only while two assumptions hold: the session starts at the
workspace root, and the agent never re-reads the root mid-session. A meta repository breaks the
second. A node's `source/` clone is itself a git repository, the item in hand names a path inside
it, and the agent re-runs `pwd` after it `cd`s into that clone to read or build. The clone's
directory then becomes "the root", and three things go wrong at once:

- `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` are read or written under the clone, not at the
  checkout root where `ralph-seed` scaffolds them and every script reads them.
- A `Spec:` or `Files` path loses its prefix from the root. `nodes/svc/source/x` written from
  inside the clone becomes `x`. `citedSpecs` can then no longer place a nested `Spec:` citation —
  it keeps a nested repository's `source/svc/specs/x.md` distinct from the root's `specs/x.md` only
  while the prefix is present — and the agent can no longer resolve a `Files` path to its owning
  repository.
- The agent reasons about the wrong `AGENTS.md`, because it now believes a nested repository is the
  project.

The same prompt already knows better further down. `ralph-build.md` phase 5 groups every changed
path by `git -C <dir> rev-parse --show-toplevel`, and warns that `git add -A` from "a meta
repository root" stages a nested repository as a gitlink. The anchor paragraph at the top
contradicts the commit rules at the bottom: one treats a nested repository as the root, the other
treats it as a thing you must never conflate with the root. This spec removes the contradiction.

## 2. Amendments to the lifecycle spec

- **§6, item 3, the Workspace anchor.** The anchor paragraph no longer reads "The workspace root is
  the directory this session starts in. Run `pwd` once …". It reads the paragraph §3 fixes:
  anchored on `git rev-parse --show-toplevel`, fixed for the session, with a nested repository
  named as never the root. The sentence "Every remaining `{{WORKSPACE}}/` prefix is dropped" is
  unchanged — the paragraph still carries no `{{WORKSPACE}}`, so the token test the lifecycle spec
  §9 names (line 634: no `{{WORKSPACE}}` in the three command files) still passes. The **Decision,
  2026-09-17** below item 3 stands as the record of why `pwd` was chosen over `$seed.output.root`;
  it gains one sentence that `pwd` was later found wrong in a meta repository and §3 replaced it,
  for the reason §1 gives.
- **§4.2, `ralph-seed`, step 8.** The clause "the prompts anchor on `pwd` instead (§6)" becomes
  "the prompts anchor on `git rev-parse --show-toplevel` instead (§6)". `ralph-seed`'s printed
  `root` is unchanged: it stays `process.cwd()`, which §4 confirms equals the toplevel for a
  correctly launched run.
- **§9, the test list.** It gains §7's cases: the `test/commands.test.ts` edit and the per-prompt
  anchor-phrase assertions.
- **§10, out of scope.** It gains §8's items.

## 3. The anchor rule

**Decision.** The anchor paragraph in all three prompts replaces `pwd` with
`git rev-parse --show-toplevel`, run once, and names a nested repository as never the root. The
paragraph is one sentence longer than today's and reads, in `ralph-build.md`:

> The workspace root is the checkout this session starts in. Run `git rev-parse --show-toplevel`
> once and use that absolute path wherever this prompt names the root. That path is fixed for the
> whole session. A nested repository beneath the root — a `source/` clone, a submodule, or any
> other directory that is itself a git repository — is **never** the root, even when the item names
> a path inside it. Never run `pwd` to decide the root, and never re-anchor the root to the item's
> directory. `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` live at this root and nowhere else. Read
> and write no other copy. Never create either file under a nested repository. Every path written
> in `IMPLEMENTATION_PLAN.md` — `Spec:` and `Files` — is relative to this root, so a path inside a
> nested repository keeps its full prefix from the root. The `Files` of the item in hand may name a
> path anywhere beneath the root. When it does, also read the `AGENTS.md` or `CLAUDE.md` and the
> `specs/` of the repository that owns that path. The repository that owns a path is the one
> `git -C <dir> rev-parse --show-toplevel` prints for the path's nearest existing ancestor
> directory; when no ancestor beneath the root is itself a repository, the root owns the path.

`ralph-plan.md` and `ralph-review.md` take the same paragraph under their own two trailing
differences, which §5 lists. The ownership sentence is one of the two differences for
`ralph-review.md`, which names no `specs/` (§5).

**Why `git rev-parse --show-toplevel` and not `pwd`.** Archon launches each phase at the workspace
root, so `pwd` and the toplevel agree at the first line of the session. They diverge the moment the
agent `cd`s into a nested repository and reads the root again. `rev-parse --show-toplevel` run at
the workspace root — before the agent enters any nested repository — prints the workspace root; the
command is also the one `ralph-build.md` phase 5 already uses to find a
path's owning repository, so the prompt names one mechanism for the root rather than two. It is read
once and pinned because `--show-toplevel` from inside a nested clone prints the clone, not the
workspace — the pinning, not the command alone, is what defends the root.

**Why name a nested repository explicitly.** The failure in §1 is the agent treating a nested git
repository as the root. `pwd` is one way in; a second `rev-parse --show-toplevel` from inside a
clone is another. The paragraph forbids the behaviour, not just the one command that caused it. A
run that pins the root once and never re-anchors is behaviourally correct whatever command set the
pin; the prompt nonetheless standardises on `git rev-parse --show-toplevel` and forbids `pwd`, so
the three prompts cannot drift apart on the command and a reader has one rule to check.

**The rule degrades to a no-op in a single-repository project.** A GitHub project with no `source/`
clone and no submodule has one repository, and its toplevel is its checkout root. "A nested
repository is never the root" names a thing that does not exist there and constrains nothing, and
"keeps its full prefix from the root" is the identity on a path already relative to the one
repository. The paragraph is therefore correct in both a meta repository and a plain project, which
is the whole point of fixing it in the template rather than in one installed `.archon/`.

**Stated assumption: Archon launches each phase at the workspace root.** The pin is correct only if
the first `git rev-parse --show-toplevel` runs with the process CWD at the workspace root rather
than inside a nested repository. archon-ralph cannot prove this from the code: `ralph-precondition`
checks `git rev-parse --is-inside-work-tree` (`ralph-precondition.ts`), which is true inside a
nested repository too, and nothing asserts the launch directory is the outermost repository. This
is the same unverified premise the lifecycle spec §6's Decision of 2026-09-17 records — Archon
v0.10.1 is a stripped binary with no source tree, so its launch and substitution behaviour needs a
live run to settle. The assumption is accepted on the same ground `pwd` was: if Archon ever launched
a phase inside a nested repository, `pwd` named that wrong directory as the root just as the first
`--show-toplevel` would, so this change does not weaken a property the current prompts hold. §8
scopes the live verification out. The re-anchoring ban is independent of the assumption: it defends
the real-world trigger of §1 — the agent `cd`-ing into a clone and reading the root again — whether
or not the launch CWD is ever wrong.

## 4. Scripts: audited, unchanged

No script changes. The defect is the agent's, not the harness's, and the scripts already anchor
correctly:

- **`repoState()` and `cycleChangedFiles()`** (`lib/ralph.ts`) enumerate repositories at most six
  levels below the checkout root with `gitRepos(".", …)` and run every git command with
  `-C <repo>` on a path relative to the process CWD. They never call `pwd`, never read
  `--show-toplevel`, and never treat a nested repository as the root — a nested repository is a
  *member* of the listing, prefixed by its path from the root, which is exactly what the fixed
  prompt now tells the agent to preserve. The prompt and the scripts agree after this change where
  the prompt and the scripts disagreed before it.
- **`ralph-seed`** prints `root: process.cwd()`. Archon launches the node at the workspace root, so
  `process.cwd()` is the toplevel. The amendment in §2 aligns the lifecycle spec's prose with the
  prompt's new command; the value does not move.

The only place any toplevel is resolved is `ralph-build.md` phase 5, where the shipped prompt text
instructs the agent to resolve it — prompt prose, not a script, and already correct.

## 5. The prompt edits

Three files, one paragraph each. The paragraph is identical across the three but for the two
trailing differences the prompts carry today, which this change keeps:

- **`template/commands/ralph-build.md`** — the paragraph of §3 verbatim. Its last sentence names
  "the `AGENTS.md` or `CLAUDE.md` and the `specs/` of the repository that owns that path".
- **`template/commands/ralph-review.md`** — the same paragraph, its last sentence naming "the
  `AGENTS.md` or `CLAUDE.md` of the repository that owns that path", with no `specs/`: review reads
  the specs the plan cites, not a path's sibling `specs/`.
- **`template/commands/ralph-plan.md`** — the same paragraph, speaking of "the goal" where the
  other two speak of "the item in hand", and ending "but still write the plan at the root". The
  plan prompt is the one that writes `IMPLEMENTATION_PLAN.md`, so it carries the explicit
  write-at-the-root clause.

No frontmatter changes: there is no new `source:` baseline, because this is not a ralph port. No
`{{WORKSPACE}}`, `{{GOAL}}` or other token is introduced or removed.

`template/ralph/templates/IMPLEMENTATION_PLAN.md` and `PROGRESS.md` are unchanged: neither names the
root or `pwd`.

One test file changes with the prompts: `test/commands.test.ts`, whose `pwd` assertion the prompt
edit would otherwise break (§7).

## 6. Documentation

- **`README.md`** does not describe root anchoring; it is unchanged. The **Supervised first cycle**
  section says deleting `.ralph/cycle-base` starts a new cycle and names the checkout root only in
  passing, with no `pwd` claim to correct.
- **`AGENTS.md`** and **`CLAUDE.md`** carry no root-anchoring prose and gain none. This change is
  not a ralph sync, so the **Keep in step with ralph** baseline sentence does not move.

## 7. Testing

Extending the lifecycle spec §9. Every test stays inside `withTempRepo`.

- The three command files still contain no `{{WORKSPACE}}`, which the existing token test asserts.
  The edit removes no token and adds none, so the test passes unchanged; it is named here because
  the amended paragraph is the one that first dropped `{{WORKSPACE}}`.
- **`test/commands.test.ts` changes.** The test `anchor the workspace root on pwd` asserts
  `holding("Run \`pwd\` once").toEqual(NAMES)` — all three prompts carry that phrase today, so the
  prompt edit turns the suite red and fails the mandatory `bun run verify` gate. The test is
  renamed and its assertion replaced. The new assertions pin the clauses that defend the root, each
  checked with `holding(...)`, which returns the prompts containing a substring:
  - `holding("Run \`pwd\` once").toEqual([])` — no prompt names the old command.
  - `holding("That path is fixed for the whole session").toEqual(NAMES)` — the pin.
  - `holding("is **never** the root").toEqual(NAMES)` — the nested-repository prohibition.
  - `holding("keeps its full prefix from the root").toEqual(NAMES)` — the prefix rule.

  Each clause is a full phrase that appears once in each prompt, so the assertion is exact: removing
  any one clause from any one prompt drops that prompt from the returned set and fails the test. A
  bare `git rev-parse --show-toplevel` check is **not** used — `ralph-build.md` already carries that
  string in its phase-5 commit rules (`ralph-build.md`), so its presence proves nothing about the
  anchor paragraph. The paragraph is the only prompt text that changes, so this is the only test
  that changes.

No script test changes, because no script changes (§4). The existing `cycleChangedFiles` and
`repoState` tests already cover a nested repository's paths keeping their prefix from the root,
which is the behaviour the fixed prompt now matches.

## 8. Out of scope

Added to the lifecycle spec §10.

- **Restoring a `{{WORKSPACE}}` substitution.** The lifecycle spec §6 item 3's Decision of
  2026-09-17 declined it for want of a way to verify Archon fills it, and this spec does not
  reopen that. The `rev-parse` anchor is correct whether or not the harness substitutes anything,
  which is the same property that justified `pwd` and the reason the Decision stands.
- **Any script change.** §4 settles that the scripts already anchor correctly.
- **A guard that fails a run started outside the workspace root.** Archon launches each phase at the
  root; a run started elsewhere is outside archon-ralph's control, and the prompt's pinned anchor is
  the whole defence.
- **Verifying Archon's launch CWD against a live run.** §3's stated assumption — that Archon starts
  each phase at the workspace root — rests on the same stripped-binary premise the lifecycle spec
  §6's Decision of 2026-09-17 left for a live run, and this spec does not run one. A plan item that
  edits a prompt does not depend on it: the pin and the re-anchoring ban are prompt prose, and the
  assumption bears only on the initial CWD the harness supplies.
- **The silent-reroot gap.** An agent that disobeys the paragraph and re-anchors anyway is not
  mechanically stopped, exactly as a reviewer that reads outside the anchor set is not
  (`specs/spec-anchored-review.md` §3). The rule rests on the prompt, as that one does.

## 9. Decisions settled while grilling

Settled on 2026-09-30, before any file was changed.

- **This is an archon-ralph-native change, not a ralph port** (preamble). No baseline commit, no
  `source:` move, no upstream record to read first.
- **The anchor command becomes `git rev-parse --show-toplevel`, pinned once** (§3), replacing
  `pwd`, and matching the owner-grouping command `ralph-build.md` phase 5 already uses.
- **The rule names a nested repository as never the root and forbids re-anchoring** (§3), so it
  binds the behaviour and not one command, and degrades to a no-op in a single-repository project.
- **The fix is the three prompt paragraphs; the scripts are audited and unchanged** (§4, §5).
- **It is recorded as its own spec**, amending the lifecycle spec §6 item 3 and §4.2 step 8 (§2),
  on the same precedent the sibling specs use: the amendments are listed, not applied by rewriting
  the lifecycle spec.
