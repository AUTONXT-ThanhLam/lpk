# Diagnosing a bug before fixing it

Read this when the request is a bug: something broken, throwing, failing, wrong or slow. **Goal:**
the fix removes the cause that held, proved by a loop that went red on this bug before any theory.
A fix built on a guessed cause ships a second bug and leaves the first.

1. **Check it is not already fixed.** `lpk facts --about <file>...` prints the open PRs and the
   target commits HEAD lacks on the files involved. Run the red loop (step 2) on a fresh `origin/<target>` first: green there
   ends the run as "already fixed in `<sha>`", with the commit and the loop's output.
2. **Build a red loop.** One command, already run once, that drives the code path the user meets
   and asserts the user's exact symptom, so it goes red now and green once fixed. It is
   deterministic (pin time, seed, data) and takes seconds. Reach for, in order: a failing test at
   the entry point; a request against the running app; the CLI on a fixture input diffed against
   the expected output; a browser script in the lpk Chrome; a captured payload replayed through the
   code path; `git bisect run` when it worked at a known commit; `lpk compare` when main and the
   change disagree on some inputs. A bug that shows sometimes: `lpk repeat -- <command>` runs it as
   many times as fit in two minutes and prints how often it failed. When no loop can be built, stop
   and tell the owner what you tried and what access or artefact would let you build one.
3. **Reproduce it twice from a reset state** (a fresh database, a cleared cache, a new process). A
   bug that disappears after a reset points at state, and the fix is validating that state.
4. **Shrink it.** Cut inputs, data, config and steps one at a time, rerunning the loop after each,
   until every part left is needed for the red.
5. **Name three things apart**: the trigger (what starts it), the masking condition (why it did not
   show before) and the symptom (what the user sees). A fix aimed at the symptom leaves the trigger.
6. **Rank three to five causes**, each with what it predicts ("if X, then changing Y makes it
   pass"). Test the most likely first, one variable at a time; tag any debug output with one
   prefix so a single grep removes it.
7. **Fix at the cause** with the shrunk loop as the regression test, at the seam where the bug
   happens. A guard that only "might help" does not ship: each line of the fix is tied to the cause
   the loop showed. When no seam exists, the missing seam is a finding: name it in the report.
8. **Close**: the original loop is green, the debug output is gone, and the commit message names
   the cause that held, following `writing.md` in this skill's directory.
