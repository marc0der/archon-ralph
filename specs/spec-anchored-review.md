# Spec-Anchored Review

Settled on 2026-09-22, after `marc0der/ralph` re-anchored its review phase on `specs/`. This spec
amends `specs/archon-native-lifecycle.md` — **the lifecycle spec** throughout. §2 lists every
amendment, and nothing outside that list changes. A bare `§n` names a section of this spec; the
bolded head of each §2 bullet names a section of the lifecycle spec.

Ralph's own record of the change is `specs/spec-anchored-review.md` in the sibling ralph checkout,
the upstream namesake of this file. It carries the reasoning this spec does not repeat: why two
convergent hops still drift, why coverage is falsifiable where decomposition is not, and why the
anchor set is derived from the plan rather than from a status header on each spec. Read it first.
What follows is the archon-ralph delta, and it is the whole of it.

The baseline moves from `36e8c8b` to `f6d2405`. Every change between those two commits belongs to
this one feature.

## 1. What ralph changed

The anchor moves from `IMPLEMENTATION_PLAN.md` to `specs/`. Review no longer asks whether `build`
did what each `- [x]` item said; it asks whether the tree satisfies the specifications the cycle
worked from. Four consequences reach archon-ralph:

- **The anchor set.** The distinct `specs/…` paths appearing in a `Spec:` field of the plan. It is
  derived from the plan because `specs/` is a chronological record rather than a statement of
  current requirements, so a pass that read the corpus whole would file drift against correct code.
  Each spec in the set is then audited **whole**, which is what puts a clause `plan` read and never
  decomposed into an item back in range.
- **Three severity levels, not two.** `Critical` for a clause of a spec in the anchor set the tree
  does not satisfy, ranged over the whole tree. `Major` for defective code this cycle committed,
  ranged over the cycle's commits. `Minor` for code this cycle committed that violates a **written
  rule**, ranged the same way. Item fidelity is gone: no level corresponds to "build did not
  implement what the item names".
- **The finding budget rises from 5 to 10**, because the anchor widened and a first pass over a
  multi-spec cycle legitimately finds more. It stays a standing invariant on the file, not a
  per-pass quota.
- **A fourth review precondition.** At least one `specs/` path is cited. A plan whose items all
  cite the verification gate satisfies the other three gates and still gives review no
  specification to read.

Ralph implements the gate twice — `exit 1` in `require_review_preconditions` for a standalone
`ralph review`, and a skip in `cmd_auto`'s phase 5 guard. archon-ralph has one mechanism for both
entry points, and §3 settles which.

Where this repository and ralph disagree on a rule the *agent* follows, ralph wins (the lifecycle
spec §6). The prompt text is therefore ralph's at `f6d2405`, verbatim, under that section's
substitutions and no others.

## 2. Amendments to the lifecycle spec

Each bullet heads with the section of the lifecycle spec it amends.

- **§3.1, the guard table.** The `review` row's *Runs when* becomes
  `open == 0 && shipped > 0 && cited > 0`. The paragraph below it names two of ralph's predicates,
  `have_open_items` and `have_shipped_items`; that list gains `have_cited_specs` and becomes three.
  The count of `when:` expressions in the same sentence does not change — there are still two,
  build's and review's. The paragraph on `require_review_preconditions` gains the fourth gate:
  review is skipped on a plan that cites no spec, because it would otherwise start an audit with
  no standard to measure against.
- **§3's workflow listing.** The `when:` on `review-snapshot` gains the third term. The lifecycle
  spec §12.3 moved that node into `ralph-review.yaml`, where it is `snapshot` and reads
  `$counts.output.*`; the term is added wherever the review guard is written.
- **§3.2, the cycle.** "Zero open items after a cycle means one of three things" becomes four. The
  fourth is the one §3 records: build shipped everything and review was skipped for citing no
  spec. Unlike the second case it is neither impossible nor harmless, and the sentence says so.
- **§4.1, the shared library.** It gains `citedSpecs(body)` (§4 below). The sentence "**Every count
  in every script goes through it**" is unchanged: `citedSpecs` takes a body and not a file for
  exactly that reason, and its callers pass `planItemsBody()`.
- **§4.2, `ralph-counts`.** The printed object becomes
  `{"open": N, "shipped": N, "superseded": N, "cited": N}`.
- **§4.2, `ralph-review-cap` step 3.** The converged message becomes `review: converged on pass n,
  audited S specs`. The un-tick guard of step 2 is unchanged.
- **§4.2, `ralph-report`.** The sample summary prints `audited 9 shipped items` and `audited 11
  shipped items`; both become `audited N specs`. The paragraph below the sample gives two causes
  for an absent `review:` row and gains the third, `no cited specs`. It also stops deriving the
  cause from the `cycle N:` line alone: a line that says `clean` no longer settles which of the
  two zero-open causes fired, and the plan does (§4).
- **§5, the templates.** `template/ralph/templates/IMPLEMENTATION_PLAN.md` is replaced by ralph's
  at `f6d2405`, not `36e8c8b`; §5 below says what moved inside it. The rest of the section — three
  headings, the six-field exemplar, the rules, the three markers — is unchanged, and so is the
  sentence that `PROGRESS.md` already matches ralph's.
- **§6, the substitution list.** The opening sentence, item 1's `source:` line and the `upstream`
  fetch note in the Decision paragraph each name `f6d2405` in place of `36e8c8b`. The closing
  paragraph reads "review's two checks, two severities, finding budget of 5"; it becomes
  three checks, three severity levels and a budget of 10, and gains the anchor set, the
  rules-directory clause now present in all three prompts, and review's read-only access to the
  specs it cites.
- **§8, the conventions.** "every count goes through `planItemsBody`" is unchanged in substance.
  `AGENTS.md` and `CLAUDE.md` name `planItemsBody` and `countItems` as the only counting path; they
  name `citedSpecs` beside them, because it reads the same body for the same reason.
- **§9, the test list.** "`ralph-counts` prints the three counts" becomes four. "`ralph-review-cap`
  … converges on an unchanged hash with the audited count in the message" keeps its shape and the
  count becomes the cited-spec count.
- **§12.3, unmet predicates in a standalone run.** The sentence naming ralph's hard stops — a
  `build` with no open items, a `review` with nothing shipped or with open items — gains the
  fourth, a `review` whose plan cites no spec. The rule below it is unchanged, and §3 applies it to
  the fourth gate.
- **§12.5, the composition test list.** "the block reports render `skipped — no open items` and
  `skipped — no shipped items to audit` from a log with no phase row" gains the third
  block-report cause, `skipped — no cited specs`.

## 3. The fourth gate is a guard term

**Decision.** The fourth precondition is a third term in the review phase's existing `when:`
expression. A plan that cites no spec **skips** the review phase and is reported; it is never an
error, in a composed run or a standalone one.

`ralph-review.yaml`'s `snapshot` node becomes:

```yaml
    when: "$counts.output.open == 0 && $counts.output.shipped > 0 && $counts.output.cited > 0"
```

This follows the rule the lifecycle spec §12.3 already settled under **Unmet predicates in a
standalone run**: ralph hard-stops a review with nothing shipped or with open items, and
archon-ralph skips and reports instead, one rule for both entry points. The fourth gate is the same
kind of condition as the other three and takes the same treatment. Ralph's two mechanisms collapse
to one because its reason for having two does not apply here: `cmd_auto` needs a skipping guard so
a lifecycle is not reported as failed for a condition `auto` exists to absorb, and archon-ralph's
phase blocks are that guard already.

**A lifecycle whose plan cites no spec therefore finishes clean without auditing anything.**
`build` runs to exhaustion, `review` skips, `ralph-cycle-cap` finds no open items and closes the
group, and the summary's `Result:` line reads `clean after 1 cycle`. This is not a corner: it is
the case §1 names as the gate's own motivation, a plan whose items all cite the verification gate.
It is accepted rather than prevented. The review row names the cause and points the operator at
`ralph-plan` (§4), which is the whole remedy, and teaching `ralph-cycle-cap` to treat the skip as
unfinished would contradict the decision above that a false guard is never an error. The lifecycle
spec §3.2 gains the case.

The first gate stays where it is. Artifact presence is asserted by `ralph-counts` itself, which
exits non-zero on a missing artifact, for the reason the lifecycle spec §3.1 gives.

**Decision.** `ralph-counts` publishes the size of the anchor set as `cited`, a fourth count beside
`open`, `shipped` and `superseded` — a number, not the paths. The guard compares numbers, which is
the one thing Archon's `when:` expressions are known to do here; publishing an array would make the
guard depend on array-length semantics that v0.10.1 has not been checked for. Anything that needs
the paths themselves re-derives them.

**The set never narrows, and that is why one guard evaluation suffices.** The guard is evaluated
once per cycle, from `counts`, before the loop starts; `ralph-review-cap` recomputes the set on
every pass to write its exit line. What the guard needs is not that the two agree but that the set
cannot fall back to empty beneath it, and nothing removes a citation: review appends items and
never deletes one or alters a `- [x]` marker, and `build` edits no `Spec:` field. Only a `plan`
run can narrow the set, and it runs once, before the cycle group.

The set can widen, in one case, and the guard is indifferent to it because it has already passed. A
`Major` cites `IMPLEMENTATION_PLAN.md` and a `Critical` cites a spec already in the set, but a
`Minor` cites a rule file, and a project whose rules directory sits under `specs/` adds a path with
every `Minor`. The visible effect is confined to `ralph-review-cap`'s exit line, which counts the
rule file on a later pass. Ralph has the same hole and accepts it; so does this. The `Critical`
case rests on the prompt's "Read no specification outside the anchor set" rather than on anything
mechanical, and a pass that disobeys inflates the same count and nothing else.

## 4. Script changes

**`citedSpecs(body)`** joins `lib/ralph.ts`, mirroring ralph's `cited_specs`. It returns the
distinct `specs/` paths the items in `body` cite, sorted in byte order through the same `byteOrder`
comparator the fingerprints use:

- Keep each line whose **first whitespace-separated field is `Spec:`**, the line trimmed first —
  items are indented, and a CRLF plan carries a trailing `\r` that would otherwise stick to the
  last token. A field match and not a substring match, so a `Steps` line that names a spec path, or
  mentions the `Spec:` field, contributes nothing.
- From such a line, keep every token containing `specs/`, where tokens are separated by spaces,
  tabs and backticks. A path is therefore a whole non-space, non-backtick token, which keeps a
  nested repository's `source/svc/specs/x.md` distinct from the root's `specs/x.md`.
- Deduplicate.

Three citation forms name no specification and are excluded by that rule alone, with no special
case: the terminal verification item's `AGENTS.md verification gate` or `CLAUDE.md verification
gate`, a `Major` finding's `IMPLEMENTATION_PLAN.md` citation, and a `Minor` finding's rule-file
citation. No such token contains `specs/`, except where a project puts its rules directory under
`specs/` — the widening §3 accepts.

**`body` comes from `planItemsBody`, never from the whole file.** The exemplar under
`## Entry Format` in `template/ralph/templates/IMPLEMENTATION_PLAN.md` cites `specs/file.md`, so
the whole-file form reports a freshly scaffolded plan as citing one spec, and the fourth guard term
would be true for a plan with no items at all. This is the same trap the lifecycle spec §4.1
records for marker counts, and it is why `citedSpecs` takes a body rather than reading the file
itself.

**Marker filtering: none.** `citedSpecs` reads every `Spec:` field in the items body whatever
marker its item carries, a `[~]` item's included. Ralph's `cited_specs` filters no marker either,
and the lifecycle spec §4.1's rule is that these helpers mirror ralph's functions. The sentence
"Items marked `[~]` neither anchor nor block a run" in ralph's own `spec-anchored-review.md` §7 is
about gates 2 and 3, which count `[x]` and `[ ]` and against which a `[~]` does neither; read as a
claim about the anchor set it would contradict ralph's implementation, and the implementation is
the authority.

**Two consequences of mirroring, accepted.** A `Spec:` field listing two paths separated by a comma
yields the token `specs/a.md,` with the comma attached, so a spec cited both with and without a
trailing comma counts twice and can disagree with the agent's own `Audited N of M specs.` line; and
the exit line reads `audited 1 specs` for a set of one. Both are ralph's behaviour at `f6d2405`,
and the lifecycle spec §4.1's rule that these helpers mirror ralph's functions settles them.

**`ralph-counts`** imports `citedSpecs` and adds `cited: citedSpecs(body).length` to the object it
prints, from the body it already reads once.

**`ralph-review-cap`** reads `planItemsBody()` into a local and uses it for both the shipped count
of step 2 and `citedSpecs` in step 3, so the two figures come from one read. Its converged line
becomes `review: converged on pass ${n}, audited ${audited} specs`. The count is what the pass
swept, and Ralph derives it rather than trusting the agent's own claim: a clean review changes no
file, which is otherwise indistinguishable from a backend that read the prompt and did nothing. The
un-tick guard, the hash comparison and the cap of 6 passes are unchanged.

**`ralph-report`** distinguishes the new skip cause. The review guard now carries three terms and
the cycle line counts only one of them, so a skip with nothing open is ambiguous between the other
two, and the operator's next command differs: `ralph-build` for a plan that shipped nothing,
`ralph-plan` for one that cites no spec. A skipped node writes no row, so the cause is derived from
the plan as it stands — the same live read `planRow` already makes, evaluated once before the cycle
blocks are rendered and passed to `reviewSkipped` beside `open`. In `auto` mode that single read
explains a row in every cycle block, cycles that closed earlier in the run included, and it is
accurate for all of them for the reason §3 gives: the set never narrows, `plan` runs once before
the group, and nothing after it removes a citation. A widening cannot mislead it either: the set
widens only when a review pass files a `Minor` citing a rule file under `specs/`, and a pass runs
only on a non-empty set.

- A predicate beside `planRow` is true when `counts().cited == 0`, and **false** for an absent or
  unreadable plan: `counts` fails the run on a missing artifact, so that state is reported by the
  other rows, and claiming the gate fired would name a cause the run never reached.
- `reviewSkipped(open)` returns `no cited specs — run ralph-plan to anchor the items on them` in
  place of `no shipped items to audit` when that predicate holds. It takes precedence over the
  shipped cause, which inverts ralph's precondition order and is right here: the row is only
  reached with `open == 0`, so a plan that also shipped nothing has no open item for `ralph-build`
  to take either, and `ralph-plan` is the operator's next command under both causes at once. Its
  other two branches are unchanged.
- `reviewReport`, the review block's own renderer, takes the same cause for its absent row. The
  remaining two terms are indistinguishable there and keep one wording, as the lifecycle spec §12.4
  leaves them.

**Unchanged:** `ralph-precondition`, `ralph-snapshot`, `ralph-seed`, `ralph-guard`,
`ralph-plan-cap`, `ralph-build-cap`, `ralph-cycle-cap`, `computeBudget`, `planStateHash`,
`repoState` and `readSettings`. Three of those deserve a note:

- **`computeBudget` needs no change for a budget of 10.** `ceil(10 × 1.2)` is 12, the build node's
  `max_iterations` is 200, and the lifecycle spec §9 already pins `computeBudget(10) == 12`. A full
  queue of ten findings gets twelve build iterations to drain it, exactly as ralph intends.
- **`planStateHash` needs no change.** Review now **reads** `specs/` and still never writes it, so
  the `specs/` term stays inert for review and the convergence check is untouched. The ban on
  writing is load-bearing twice over: a reviewer that may amend a specification manufactures its
  own standard, and a write under `specs/` changes the fingerprint and defeats the exit.
- **`ralph-snapshot` keeps writing `shipped-before.txt`.** Review has even less reason to touch a
  `- [x]` marker now that it does not judge items at all, and the guard costs nothing.

The review node's `idle_timeout: 600000` and `max_iterations: 7` are unchanged. A pass reads more
than it did, but `idle_timeout` bounds an idle period rather than a pass, and ralph's cap of 6
passes did not move.

## 5. Prompts and templates

Four downstream copies are re-ported from `f6d2405`. The three prompts take the lifecycle spec
§6's substitutions, keep their frontmatter, and name the new baseline in `source:`. The plan
template takes neither: it carries no frontmatter and no `source:` line, and the lifecycle spec §5
copies it verbatim. Its baseline is recorded where it already is, in the **Keep in step with
ralph** table of `AGENTS.md` and `CLAUDE.md` (§6).

- **`template/commands/ralph-review.md`** — rewritten from `prompts/review.md`. Ralph's text
  carries the anchor set, the three checks and their ranges, the red suite as one finding, the
  budget of 10, the additive-only authority, the coverage line `Audited N of M specs.`, and the
  three review-only editing rules. Two of the lifecycle spec §6's five substitutions apply: item
  1's frontmatter, and item 3's workspace anchor, which replaces `The workspace root is
  {{WORKSPACE}}.` and drops every remaining `{{WORKSPACE}}/` prefix. Items 2, 4 and 5 have nothing
  to act on — ralph's review prompt carries no goal, no loop-control section, and already states
  the subagent rules §6 keeps. The frontmatter `description:` reads "audit every shipped
  IMPLEMENTATION_PLAN.md item" today and becomes false with the rest of the file; it is rewritten
  to the specs the plan cites, in present tense, and keeps naming the loop.
- **`template/commands/ralph-plan.md`** — two edits. The **Operational guardrails** bullet in Phase
  1 gains the clause telling the agent to follow the guardrails' pointer to the project's rules
  directory and read every rule there. The `Spec` field description gains the three review citation
  forms in place of the single form it states today.
- **`template/commands/ralph-build.md`** — two edits. The same **Operational guardrails** clause.
  And the sentence "A review finding points at the plan item it audits instead, so it has no spec
  clause to contradict" is false once a `Critical` cites a clause; ralph's replacement makes the
  `[~]` route apply to such an item as to any other.
- **`template/ralph/templates/IMPLEMENTATION_PLAN.md`** — the `Spec` rule line gains the same three
  citation forms. `PROGRESS.md` is unchanged upstream and is not re-ported.

The rules-directory clause reaching all three prompts is not incidental. A reviewer that knows the
rules and a builder that does not replenishes `Minor` violations exactly as fast as review drains
them, and the tier only exhausts if `build` reads the same directory.

**Decision.** archon-ralph declares **no rules directory**, as ralph declares none for itself. Its
conventions stay in the `## Conventions` section of `AGENTS.md` and `CLAUDE.md`, which is a
guardrails file and not a rules directory, so a review of this repository files no `Minor` finding
at all. That is a floor and not an invitation to fall back on taste: a preference with no written
source is unfileable at every level. The clause still ships in the prompts, for the projects that
install `.archon/` and do name one.

## 6. Documentation

**`README.md`** keeps its shape. Six edits:

- The **Cycles** step's `Review` bullet: review runs when build left no open items, at least one
  shipped item **and at least one cited spec**, and each pass audits the specs the plan's items
  cite rather than the shipped items.
- The phase-workflow table's `ralph-review` row: the review loop audits the code against the specs
  the plan cites and files findings as open items.
- The skip-and-report paragraph: `ralph-review` on a plan with open items, nothing shipped **or no
  cited spec** exits 0 with a report.
- The source-tree listing's `ralph-counts.ts` line names the fourth count:
  `open / shipped / superseded / cited, for the guards`.
- The **Supervised first cycle** step 3. Its advice — findings about style or taste mean the
  prompts need work — was written against two severities, where a style finding was outside the
  contract at any level. Under three it holds only for a finding with no written rule behind it; a
  `Minor` citing a rule file is the tier working as designed. The step draws that line and keeps
  its conclusion for the unfounded case.
- The prompts paragraph below the source-tree listing names the prompts' baseline as
  `marc0der/ralph@36e8c8b`; it names `f6d2405`. **Decision, 2026-09-22**, settled while planning:
  the list above omitted it, and a baseline the prompts no longer carry is a false statement about
  the shipped files. It is the same edit as §6's `AGENTS.md` and `CLAUDE.md` baseline sentence, and
  it lands with them.

**`AGENTS.md`** and **`CLAUDE.md`**, which stay identical copies:

- The **Keep in step with ralph** baseline sentence names `f6d2405`.
- The `## Conventions` counting bullet names `citedSpecs` beside `planItemsBody` and `countItems`.

Neither file describes the review model — that is ralph's `CLAUDE.md`'s job and this repository
ships machinery — so neither gains a severity table.

The workflow files' own `description:` blocks are part of the change: `ralph-review.yaml`'s says
review audits the items the plan records as shipped and that a plan with open items or nothing
shipped is skipped, and `ralph-wiggum.yaml`'s says each review iteration audits the shipped items.
Both are re-worded to the cited specs and the third skip cause.

Three in-file comments state the old anchor or the old guard and are re-worded with the code they
sit above: `ralph-review.yaml`'s `REVIEW` banner, which says the phase audits the shipped items and
is guarded on nothing open and something shipped; `ralph-wiggum.yaml`'s `CYCLE` banner, which says
a review with nothing shipped skips and reports as it does standalone; and `ralph-counts.ts`'s
header, which calls them the plan's three item counts and quotes the review guard as
`open == 0 && shipped > 0`.

## 7. Testing

Extending the lifecycle spec §9. Every test stays inside `withTempRepo`.

- `citedSpecs` returns the distinct cited paths and ignores a path in a `Files:` line.
- `citedSpecs` ignores a `specs/` path that is not in a `Spec:` field, including one in a `Steps`
  line.
- `citedSpecs` excludes an `AGENTS.md verification gate` and a `CLAUDE.md verification gate`
  citation.
- `citedSpecs` excludes a rule-file citation.
- `citedSpecs` deduplicates two items citing the same spec.
- `citedSpecs` keeps a nested repository's `source/svc/specs/x.md` distinct from `specs/x.md`.
- `citedSpecs` keeps the comma of a `Spec:` field listing two paths, so `specs/a.md,` and
  `specs/a.md` are distinct — the mirrored behaviour §4 accepts.
- `citedSpecs` returns the paths in byte order.
- `citedSpecs` counts a citation under a `[~]` item.
- `citedSpecs` over `planItemsBody` ignores the exemplar under `## Entry Format`; a freshly
  scaffolded plan has `cited == 0`.
- A plan with no `## Items` heading still yields its citations, covering `planItemsBody`'s
  whole-file fallback.
- `ralph-counts` prints `cited` beside the three marker counts.
- `ralph-review-cap` reports the cited-spec count in its converged message, and reports `1` for a
  plan whose items all cite one spec.
- `ralph-report` renders `skipped — no cited specs …` for a cycle with no open items whose plan
  cites no spec, and `skipped — no shipped items to audit` when it cites one.
- `reviewReport` renders the same two causes for an absent review row.
- A new assertion in the workflow-structure test: the review guard in `ralph-review.yaml` names
  `$counts.output.cited`. The existing test checks that `$counts` resolves to a node in scope and
  says nothing about the field, so the third term needs a check of its own.
- `ralph-report` falls back to the shipped cause when the plan is absent: `counts` throws, the
  predicate is false, and the row reads `skipped — no shipped items to audit`.
- `ralph-report`'s fixture `outcome.log` lines read `audited N specs`. **Decision, 2026-09-22**,
  settled while planning: §2's amendment to the lifecycle spec §4.2 rewords the sample summary, and
  `test/report.test.ts` asserts that sample verbatim. A fixture line no `ralph-review-cap` run can
  write is a stale standard, by the same reasoning as the seeded citations below.
- The three command files still contain no `{{WORKSPACE}}`, which the existing token test asserts.

**Every seeded plan in the suite gains a `Spec:` citation under each item, except where the test
is about a citation's absence.** Eight test files seed
a `- [x]` item and two seed a citation today. Ralph made the same change to its own fixtures in one
commit. The reason is not that every test reads citations — most ignore the field — but that a
fixture standing in for a plan should satisfy the contract the plan now carries, so a later test
that starts reading citations finds them already there. The exceptions are the `citedSpecs` cases
above that assert an exclusion, and the report cases that need a plan citing no spec, or no plan
at all.

Prompt prose keeps its exemption under the lifecycle spec §9: no test asserts it, and a plan item
that edits a prompt carries a `grep -c` criterion on a phrase it adds or removes.

## 8. Out of scope

Added to the lifecycle spec §10.

- **A hard-fail fourth gate.** The guard skips and reports; §3 settles it.
- **A rules directory for this repository**, and any `Minor` finding against archon-ralph itself.
- **Publishing the anchor set's paths**, in `ralph-counts`'s JSON or in `ralph-report`'s `Plan:`
  row. The count is what the guard and the exit line need.
- **Ralph's own out-of-scope list for this feature**, its §13, which binds here in full: a goal
  for review, a recorded cycle start point or plan-path argument, status or supersession headers
  on spec files, the loop enforcing the budget or the severity levels — both stay in the prompt —
  review writing any file but `IMPLEMENTATION_PLAN.md` and a `PROGRESS.md` supersession entry,
  review re-decomposing, re-scoping or re-ordering an item `plan` wrote, hardening `Done when`
  criteria, and commits, pushes and pull request comments. One item translates rather than
  carries: ralph refuses `-g` on `review`, where archon-ralph neither requires nor refuses a
  positional message (the lifecycle spec §12.3). No goal reaches the review prompt either way.
- **The silent-drop gap.** A spec `plan` read and produced no item from is outside the anchor set
  and invisible to review. Ralph accepts it; closing it needs a goal passed to review or a recorded
  cycle start point, and both are out of scope above.

## 9. Decisions settled while grilling

Settled on 2026-09-22, before any code was written. Each one is a question the upstream change does
not answer for archon-ralph.

- **Port the whole upstream change, not review alone.** All three prompts and the plan template
  move to `f6d2405`. Porting `ralph-review.md` by itself would leave the three prompts disagreeing
  on what a `Spec:` field may cite, and would leave `build` blind to the rules whose violations
  review files (§5).
- **The fourth gate is a `when:` term, skipped and reported** (§3).
- **`ralph-counts` publishes `cited` as a count** (§3).
- **`ralph-report` re-derives the cause and names `no cited specs` distinctly** (§4).
- **This change is recorded as its own spec**, and not by copying ralph's, whose every identifier
  names a Bash function this repository does not have. It was first recorded as §13 of the
  lifecycle spec, on that spec's §12 precedent that an addendum corrects the sections above rather
  than rewriting them; that half was reversed on 2026-09-22 so the change could be reviewed on its
  own. §2 keeps what the addendum form was for: the amendments are listed, not applied by
  rewriting the lifecycle spec.
- **A lifecycle that audits nothing is reported, not prevented** (§3).
- **The anchor set may widen under a rules directory inside `specs/`**, and the guard is
  indifferent to it (§3).
- **archon-ralph declares no rules directory** (§5).
- **Every seeded plan in the suite gains a citation** (§7).
- **The review node's `idle_timeout` and `max_iterations` are unchanged** (§4).
