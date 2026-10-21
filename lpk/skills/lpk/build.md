# Step 3: Build

**Goal.** Code that makes the acceptance tests pass and holds for every caller, with each defect
caught on the line where it is written: a defect review finds costs a round; one the build finds
costs a minute.

## Start the run before the first production line

`lpk run start --base <base> --verify "<command>"`, once for each check CI runs on the touched code
(typecheck, lint, the test suites; `lpk facts` lists them). In the Full lane it records the
scenarios of `brief.json`. In the Quick lane add `--lane quick`, one `--req "<text>"` per
requirement (numbered `R1`, `R2`… in that order), and one `--scenario "<command>"` per scenario,
with `--expect "<literal>"` when the output must contain it and `--proves R1,R2` for the
requirements it proves (`--judged "<scenario>" --proves R1` for one the Prover judges). The run's preflight prints what is missing (the test command, `gh auth`, Chrome,
memory); fix it before you build. Its hooks then show a hint after each edit: fix each one at
once, or know the one line that says why it is right.

## Build test-first

1. The acceptance tests exist and fail; make them pass. While you work, run only the tests related
   to the files you touched (`vitest related`, `jest --findRelatedTests`, the tests `lpk map`
   names); the full checks run in `lpk verify`.
2. Read the whole function you change. A defect in it that your users will meet is fixed too, or
   named in the report.
3. Build for the system, not the diff: before you change a function, field, status, output shape or
   default, run `lpk map <name>` and read every writer, reader and consumer. The change is done when
   each of them still holds.
4. Put each invariant in the lowest function every writer passes through.
5. A test that starts a server, a process or a container closes it on every path, the failing ones
   included: a leaked server holds the port for the next run.
6. A limit you choose on purpose gets a comment `shortcut: <the limit>, <when to revisit>` on its
   line, so reviewers read it as a decision.
7. Fix at the root, never around it. A test or a task that looks wrong is reported as
   `contested: <why>`, never edited to pass.

Several slices: follow `slices.md` in this skill's directory.

## Review your own slice before you call it done

Before you commit, run `lpk code-review --slice --base <base>`, with the commit the slice started
from: one Sonnet `/code-review` on the working tree (uncommitted and untracked code files included)
against that base. Reproduce each finding it raises, fix the ones that hold, and name the ones that
do not, each with its reason.
Its findings are printed for you, not added to the ledger, and the run records that the
self-review ran.

## When a fix draws a new problem

A fix that draws a new problem on its own lines, or a second fix on the same idea that fails, means
the design is wrong. Stop patching: go back to the cause, choose again and rebuild that part.

Commit messages follow `writing.md` in this skill's directory: what changed and why, a subject of
at most 72 characters.

**Done when** the acceptance tests pass, `lpk check` shows nothing you cannot defend in one line,
and each slice's self-review is fixed or answered.
