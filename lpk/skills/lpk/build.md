# Step 3: Build

**Goal.** Code that meets the brief's scenarios, proved by tests that name their requirement ids, and holds for every caller, with each defect
caught on the line where it is written: a defect review finds costs a round; one the build finds
costs a minute.

## Start the run before the first production line

Continuing a run from an earlier session: run `lpk run status` first, and when `heldBy` says the
session has exited, `lpk run take`, or every finding call is refused. Check each branch and PR the
notes remember against `git` and `gh`, and read a reverted fix on the files you touch as a design
constraint. Each PR runs in its own
worktree, with its own `lpk run start` there, so PRs of one repo run side by side.

`lpk run start --base <base> --verify "<command>"`, once for each check CI runs on the touched code
(typecheck, lint, the test suites; `lpk facts` lists them). Give a check that is slow and that CI runs
too, such as a database suite, to `--verify-final "<command>"` instead. The fast checks gate every
commit and the final ones gate delivery, so a slow suite does not stall each commit. Both flags
repeat, and the lead names the final ones, because lpk never guesses that a check is slow. In the Full lane it records the
scenarios of `brief.json`. In the Quick lane add `--lane quick`, one `--req "<text>"` per
requirement (numbered `R1`, `R2`… in that order), and one `--scenario "<command>"` per scenario,
with `--expect "<literal>"` when the output must contain it and `--proves R1,R2` for the
requirements it proves (`--judged "<scenario>" --proves R1` for one the Prover judges). The run's preflight prints what is missing (the test command, `gh auth`, Chrome,
memory); fix it before you build. Its hooks then show a hint after each edit: fix each one at
once, or know the one line that says why it is right.

## Run the final tier

1. Register each slow check that CI runs with `--verify-final`. `lpk verify` runs the fast tier only.
2. In the review step, after you freeze the commit with `lpk run worktree review <commit>`, run
   `lpk verify --final --repo <review worktree>` with Bash `run_in_background`. A foreground call
   ends at 600000 ms, before a real suite does.
3. Run it beside the review net, against its own database or port. Never run two final runs at once.
4. After the fix round, freeze the new head under a new name: `lpk run worktree review-2 <new head>`
   (`review-3` for a later one). The name `review` is taken, and the command fails on it.
5. Run `lpk verify --final --repo <that worktree>` the same way. The final record of the old review
   worktree belongs to the old tree and counts for nothing.
6. Delivery needs both tiers green on the tree of HEAD (`lpk gates` shows it).

## Build with its tests

1. Build one scenario at a time, red first. For each scenario or failure row of your slice: write
   its test at the real entry point, named with the requirement ids it proves (`R1`…), and run it.
   Read the failure: it must show the symptom the requirement names, not an import, fixture or typo
   error, and a bug fix's regression test must fail on the base. Then write the code that turns it
   green, and move to the next row. One test per row, plus one for each plausible way your lines go
   wrong that no row covers, named in the report; no test per function. Two inputs that run the
   same line and fail the same way are one test (a table of cases), never two. Mock only what crosses the
   system's edge (network, clock, another service). A test that still passes when every function it
   imports returns `undefined` proves nothing (a weak assertion, a mock asserting its own mock, an
   expected value computed by the code under test, a pinned constant, a fixture asserting itself):
   rewrite or delete it. While you work run only the tests related to the files you touched
   (`vitest related`, `jest --findRelatedTests`, the tests `lpk map` names); the full checks run in
   `lpk verify`.
   A refactor, rename or move starts with a characterization test (or an `lpk compare` harness)
   green on the base and green after; a rename also greps strings and prose for the old name.
2. Read the whole function you change. A defect in it that your users will meet is fixed too, or
   named in the report.
3. Build for the system, not the diff: before you change a function, field, status, output shape or
   default, run `lpk map <name>` and read every writer, reader and consumer. The change is done when
   each of them still holds.
4. Put each invariant in the lowest function every writer passes through.
5. A test that starts a server, a process or a container closes it on every path, the failing ones
   included: a leaked server holds the port for the next run.
6. Write no code comments, and leave the ones already there. A limit you choose on purpose goes in
   the PR body as `shortcut: <the limit>, <when to revisit>`, so reviewers read it as a decision.
7. Fix at the root, never around it. A test or a task that looks wrong is reported as
   `contested: <why>`, never edited to pass.

In the Full lane you lead the build and never write it: every slice, a single one included, goes to
an `lpk:builder` as `slices.md` in this skill's directory says. A lead that builds carries the
build's context through every later turn; a builder's context ends with its slice. The Quick lane
builds here, except the screens: `lpk:designer` runs in design mode on the requirements and
returns its UI section, then in build mode with that section in its prompt (`SKILL.md`, Screens).

When the designer's build is done, its report names the proof directory (`DESIGN.md`, `refs/`,
`shots/`). Start the critic of `ui-craft/refs.md` stage 6 there: a fresh `lpk:ui-reviewer` in critic
mode, given only `shots/`, `refs/` and the job sentence with its result line. Send its problems to
the same designer for the one repair round, then go on to the review.

In either lane the designer's UI section holds the design and the build follows it. When the owner
wants a choice of looks, the variants are full-size screens that differ on one axis each, and the
pick goes in the build-mode prompt.

## When a fix draws a new problem

A fix that draws a new problem on its own lines, or a second fix on the same idea that fails, means
the design is wrong. Stop patching: write the one sentence both fixes assumed, count it with a
command (`lpk map`), choose again from the cause and rebuild that part. Stop and report `contract`
when two independent workarounds of one shape appear, a cast or escape hatch is needed to compile, or
a lock appears where the brief said state is unshared.

Commit messages follow `writing.md` in this skill's directory: what changed and why, a subject of
at most 72 characters.

**Done when** the slice's tests pass, `lpk check` shows nothing you cannot defend in one line.
