# Building the slices

Read this in the Full lane (step 3), however many slices the brief has. **Goal:** the slices are
built at the same time without colliding, and each arrives reviewed by its own builder.

Commit the acceptance tests first. When the repo's own pre-commit hook refuses red tests (it
typechecks or runs them), never skip it: leave them uncommitted, and each builder copies its
slice's tests into its worktree and commits them with the code that makes them pass.

For each slice create a worktree from the branch head
(`git worktree add -b <branch>-<slice> ../<repo>-<slice> HEAD`) and start one `lpk:builder` per
slice in the background, all in one message, each with its worktree, the base, its files, contract
and tests, the test command, the brief and the profile path. You are notified as each one finishes.
When the slice changes a function, field or output shape that other files read, also give it a map:
`lpk map <each name> > <file outside the repo>`, never read by you, and its path. A builder given
the map reads the lines it lists instead of searching the repo; on a slice of eight files that cut
its diff by about 40% and its cost by about 8%.
A slice waits for another only when the brief names the dependency the contract cannot cover,
because slices built in turn add their times instead of overlapping them. Glue that joins the slices
is a slice of its own, with its own builder, started once the slices it joins are in. Builders
start after `lpk go`, when the design review has ended.

Each builder reports its commit, its self-review (`lpk code-review --slice`) and any `contested:`
item. Rule on each contested item before you bring the slice in: the test or the task changes, or
the builder was wrong, with the reason.

A builder whose slice is stuck (no new commit after its second failed attempt, or a report that it
cannot meet the contract), or whose remaining work is the run's long pole, is handed off or split.
`lpk handoff <slice>` prints what the slice has done and what is left, for a fresh builder to
start from, or for you to split between two builders on disjoint files.

A **high-risk** slice gets two builders, each told one of the two approaches the brief weighed;
keep the one whose tests pass with the cleaner `lpk check` and the smaller diff, and say which and
why in the report. Before removing the other, run the unit tests it wrote against the kept code:
one that fails there is a case the kept code misses; fix it or say why it does not apply.

Bring each slice in with `git cherry-pick`. A conflict means the slice left its files: abort the
pick and send it back to that slice's builder (SendMessage) to fix at the contract. Then remove
the worktrees and their branches.
