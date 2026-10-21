# Step 4: Review

**Goal.** The commit that reaches the tech lead has had every lens its lane owes, each finding has
been ruled on by a verifier, and every confirmed one is fixed at its root in one round. All lenses
run at once, so the net costs its slowest lens; you keep working while it runs.

## Verify and freeze

1. Read the whole diff once as the tech lead will (`git diff <base>`) and cut every line the
   request does not need: drive-by edits, debug output, options nobody asked for, exports nothing
   imports, comments that narrate. Each line is one more place to block the merge.
2. Run `lpk verify` (a Bash timeout of 600000 ms, or in the background) until it is green, then
   commit. The commit hook refuses code that no green `lpk verify` ran on.
3. Run `git fetch`, then `lpk facts`: it prints the bundle directory (`impact.md`, `precedent.md`),
   the diff groups, the commands CI runs, and whether the branch is behind the target. When it is
   behind, rebase now, `lpk verify`, commit, and run `lpk facts` again, so the reviewers see the
   code that will merge.
4. Freeze the commit in its own tree, so the reviewers and the Prover use exactly it while you keep
   working: `git worktree add --detach ../<repo>-review <commit>`, with its dependencies installed,
   and move the app there (the env agent's report says how to stop and start it).
5. Where the owner granted early drafts for this repo (`lpk run status` shows it), push the branch
   and open a draft PR now, so CI and any review bot run while the net runs. Elsewhere ask before
   the first push. Draft the PR body from the brief now (`deliver.md` in this skill's directory
   lists its sections), so the Claims checker reads it in the net.

## Run the net

Run `lpk review start <base>..<commit>`: it records the range under review, and every finding is
stamped with it. Start `lpk repro prepare` in the background right after it: it creates and installs
the repro trees of the commit and the base while the net runs, so the first verifier does not wait
on an install. Then run the `lpk:review` workflow with the Workflow tool, in the background, on
the frozen tree. Its `args` are listed at the top of `${CLAUDE_PLUGIN_ROOT}/workflows/review.js`:
the repo, base, commit, bundle, request, scenarios (each with the request sentence it serves), the
failure table, the surface (URL, start command and each login with its role), the main instance,
the related-test command and the test author's e2e scripts; `range` exactly as `lpk review start`
printed it, and `lenses` the `lens` of every row `lpk reviews owed --json` lists, in its order and
with each repeat (a lens owed twice runs twice). The mutant runs beside the prover unless
`mutantAfterProver` is true: set it when the env agent's `db` line shows the test command and the
app share a database or a port, because then each breaks the other's runs. Without the
Workflow tool, start the agents it starts yourself, all in one message.

The net runs the lenses the lane owes, all at once, and one `lpk:verifier` per finding as each
arrives. `lpk reviews owed` names any lens still owed and why. A lens that stalled or errored is
re-run once; after that it is `ungraded`, and only the owner's waiver passes it.

## Check yourself while it runs

On the reviewed commit, in the checkout (the net reads the frozen tree, so your edits never change
what it sees):
- `lpk check`: each candidate the hooks did not already show you is a defect, or you can say in one
  line why it is right;
- `lpk rules`: for each loaded rule marked `blocks: high`, find the line that makes it hold;
- for each changed function whose output main already produced, a harness outside the repo that
  reads one input and prints only the result, generated inputs (edges and malformed ones), and
  `lpk compare --run "<harness>" --inputs <dir>`. Each row that differs is a change the request
  asks for, or a regression. The table goes in the PR body;
- the dead-code finders `lpk facts` lists, on the touched packages: remove names the diff added
  that nothing uses.
Record each defect you find with `finding_add`, written to `writing.md` in this skill's directory,
and start one `lpk:verifier` on it. Never rule on a finding yourself: a drop by the lead counts
only with the owner's yes.

## Fix what is real, in one round

Each `confirmed` finding is fixed at its root, whatever its stated severity, all in one round. Start
as the first verdicts land (`finding_list`): the net reads the frozen tree, so the fixes never
change what it sees. Only when the tests use a database or a port that the net's mutant or Prover
also uses (the env agent's `db` line), start when the net returns, because shared runs break each
other.
1. Group the confirmed findings by root cause. Start from the `same fix:` ids that end each
   CONFIRMED ruling's evidence, and read the claims too: a verifier sees only the findings filed
   before it ruled.
2. One root cause is one commit. It changes only what that cause needs and adds a test that fails
   on `fix^` and passes on `fix`. The builder's report names the finding ids each commit closes;
   the commit message never does, because ledger ids mean nothing in the repo's history.
3. Start one `lpk:builder` per group of root causes whose files do not overlap; causes that share a
   file go to one builder. Each works in its own worktree off the reviewed commit
   (`git worktree add -b <branch>-fix-<n> ../<repo>-fix-<n> <reviewed commit>`), all started in one
   message. Size the groups from the slowest cause, so no builder is the long pole. A finding
   confirmed later goes to the builder whose commit fixes its cause (SendMessage), else to the one
   that owns its files, else to a new builder. Until the green verify of step 6, the builder amends its cause's commit to close it too.
4. Give each builder its findings (ids, claims, repros, rulings), the related-test command and the
   bar of step 2. Builders run the related tests and `lpk check`, never `lpk verify`. Where their
   tests share a database or a port, give them one lock file (`flock <file> <command>`); elsewhere
   they run in parallel, because builders queued behind one lock each wait for all the others.
5. Note your branch head, then bring each builder's commit in with `git cherry-pick`. Run
   `lpk fixlines <commit>` for each: it prints the fix's lines that an earlier commit of this run
   wrote. A confirmed finding on those lines means revert or redesign, never another patch.
6. When the last commit of the round is in, run `lpk verify` once (a Bash timeout of 600000 ms).
   When it is red, the builder of the fix that broke it amends that commit, never a commit of its
   own, because a commit that closes no finding owes the whole net. Whenever a commit you picked
   is amended, drop your picks with `git reset --keep <the head you noted>` (they are yours and
   unpushed; an amended commit conflicts with its first version) and run step 5 again. A finding confirmed after the green
   verify gets a fix commit of its own, brought in the same way; it still owes only the delta review.
7. Close each finding a fix removes with `finding_fixed` yourself, never a builder: a cherry-pick
   changes the SHA, and `lpk reviews owed` knows a fix only by the SHA it was closed with. Load it
   with ToolSearch `select:mcp__plugin_lpk_lpk__finding_fixed`; give its id, `commit` the fix's SHA
   now on your branch, `closedBy` `test` with the builder's test output on `fix^` and on `fix`, or
   `repro` with the output of `lpk repro <id> --commit <fix> --at commit` now passing, as
   `evidence`. A finding with no reproduction (a comment, the docs, the PR text) closes when a
   verifier rules it `fixed` on the fix commit.
8. `unsettled` findings go to the owner with their reproduction; `preexisting` ones go in the
   report. Surviving mutants (`test-gap`) are listed in the report.
9. A refactor a finding seems to call for is a separate PR, named in the report.

Then one delta review: rerun the self-check on the files the fixes touched,
`lpk review start <reviewed commit>..<fix head>`, `lpk repro prepare` in the background,
and run the `lpk:review` workflow with `args.delta` (with `docsOnly` when the round touched only comments, docs or the PR body): one
`lpk code-review --range <reviewed commit>..<fix head>` plus the lenses that raised the fixed
findings, in parallel, each given the ledger's findings as already raised. A round that touches only comments, docs or the PR body owes
no `/code-review`: the lens that raised it re-checks it. Never re-run the whole net: past runs that
did spent more time there than in the build, and each pass found something new on new lines.

**Done when** `lpk reviews owed` is empty and the ledger holds no open finding and no confirmed
finding that is not fixed or pre-existing.
