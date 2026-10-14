# Diagnosing a bug before fixing it

Read this when the request is a bug: something broken, throwing, failing, wrong or slow. A fix
built on a guessed cause ships a second bug and leaves the first; the cure is a loop that goes
red on this bug before any theory.

1. **Build a red loop.** One command, already run once, that drives the code path the user
   meets and asserts the user's exact symptom, so it goes red now and green once fixed. It is
   deterministic (pin time, seed, data) and takes seconds. Reach for, in order: a failing test
   at the entry point; a request against the running app; the CLI on a fixture input diffed
   against the expected output; a browser script in the lpk Chrome; a captured payload replayed
   through the code path; `git bisect run` when it worked at a known commit; `lpk compare` when
   main and the change disagree on some inputs. A bug that shows sometimes: loop the trigger
   until it shows at a rate you can work with. When no loop can be built, stop and tell the
   owner what you tried and what access or artefact would let you build one.
2. **Shrink it.** Cut inputs, data, config and steps one at a time, rerunning the loop after
   each, until every part left is needed for the red.
3. **Rank three to five causes**, each with what it predicts ("if X, then changing Y makes it
   pass"). Test the most likely first, one variable at a time; tag any debug output with one
   prefix so a single grep removes it.
4. **Fix at the cause** with the shrunk loop as the regression test, at the seam where the bug
   happens. When no such seam exists, the missing seam is a finding: name it in the report.
5. **Close**: the original loop is green, the debug output is gone, and the commit message
   names the cause that held.
