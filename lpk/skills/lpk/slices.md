# Building the slices

Read this in the Full lane (step 3), however many slices the brief has. **Goal:** the slices are
built at the same time without colliding, and each arrives tested by its own builder.

For each slice create a worktree from the branch head
(`lpk run worktree <slice> HEAD --branch <branch>-<slice>`, which binds it to your run) and start one `lpk:builder` per
slice in the background, all in one message, each with its worktree, the base, its slice name, the test command, the brief's path,
`notes.md` beside it and the profile path. The builder reads its files, contract and proofs from
`lpk handoff <slice>` and opens `brief.md` only at a section, so it never carries the whole brief. You are notified as each one finishes.
When the slice changes a function, field or output shape that other files read, also give it a map:
`lpk map <each name> > <file outside the repo>`, never read by you, and its path. A builder given
the map reads the lines it lists instead of searching the repo.
A slice whose files are screens (`lpk floor` lists them as `screen file`) goes to `lpk:designer` in
build mode, started the same way with the UI section of the brief added and, like a builder, only
after `lpk go`; every other slice goes to
`lpk:builder`. A slice that mixes the two is split by file, the backend first, so the designer
builds against a contract that exists.
A slice waits for another only when the brief names the dependency the contract cannot cover,
because slices built in turn add their times instead of overlapping them. A builder runs only the tests of its own files while it works. The repo's full suites, and any
suite on a database, queue, port or container the slices share, run once in `lpk verify`: builders
that share a stateful resource wait on each other and add their times, so give each slice its own
instance of it or order the slices. A builder that reports `CHECKPOINT`, or stops at its 100-turn limit with work left, is handed
off: run `lpk handoff <slice>` and start a fresh `lpk:builder` (`lpk:designer` for a screen slice) in the same worktree. Never continue
it by messaging the same agent, which keeps its whole conversation and the cost of every later turn.
Glue that joins the slices
is a slice of its own, with its own builder, started once the slices it joins are in.

Each builder reports its commit and any `contested:`
item. Rule on each contested item before you bring the slice in: the test or the task changes, or
the builder was wrong, with the reason.

A builder whose slice is stuck (no new commit after its second failed attempt, or a report that it
cannot meet the contract), or whose remaining work is the run's long pole, is handed off or split between two builders on disjoint files.

A **high-risk** slice gets two builders, each told one of the two approaches the brief weighed;
keep the one whose tests pass with the cleaner `lpk check` and the smaller diff, and say which and
why in the report. Before removing the other, run the unit tests it wrote against the kept code:
one that fails there is a case the kept code misses; fix it or say why it does not apply.

A mechanical edit repeated across many files is one codemod run by one builder, not split across
builders. Before each cherry-pick compare `git diff --name-only <base> <commit>` with the slice's
files; a file outside them sends the slice back.
Bring each slice in with `git cherry-pick`. A conflict means the slice left its files: abort the
pick and send it back to that slice's builder (message it where the host has one; else start that builder again with the conflict and the contract) to fix at the contract. Then delete
the slice branches; `lpk run end` removes the worktrees.
