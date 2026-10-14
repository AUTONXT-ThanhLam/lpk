# Building several slices at once

Read this when the brief has more than one slice (step 5 of the lpk skill).

Commit the acceptance tests first. When the repo's own pre-commit hook refuses red tests (it
typechecks or runs them), never skip it: leave them uncommitted, and each builder copies its
slice's tests into its worktree and commits them with the code that makes them pass.

For each slice create a worktree from the branch head
(`git worktree add -b <branch>-<slice> ../<repo>-<slice> HEAD`) and start one `lpk:builder` per
slice, each with its worktree, the base, its files, contract and tests, the test command and the
profile path. A hook refuses a builder's write into the main checkout. Start them all in one
message and not in the background: they run at the same time and your turn waits for them, since
the run will not let a turn end on unverified source. Glue that joins the slices is a slice of its
own, or written after they are in.

A **high-risk** slice gets two builders, each told one of the two approaches the brief weighed;
keep the one whose tests pass with the cleaner `lpk check` and the smaller diff, and say which and
why in the report. Before removing the other, run the unit tests it wrote against the kept code:
one that fails there is a case the kept code misses; fix it or say why it does not apply.

Bring each slice in with `git cherry-pick` (a conflict means the slice left its files: resolve it
at the contract), then remove the worktrees and their branches.
