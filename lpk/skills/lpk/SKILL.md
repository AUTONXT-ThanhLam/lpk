---
name: lpk
description: Take one coding request (a task, a bug, a ticket, or a PR whose review feedback needs handling) to a delivered change that works where its user meets it, and reaches the team's tech lead with nothing they would block the merge for. Use when the owner says /lpk, or asks for a change to be built and delivered as a PR.
argument-hint: "<request | ticket key or URL | PR URL or number>"
---

# lpk: one request to a delivered change

The owner judges the result in this order: the person who uses the change gets what they need, then
quality, then speed, then cost. Done means three things are true on the commit you deliver: the
change works on the surface its user meets (the UI, the API, the CLI, the page), you proved that by
using it there, and the team's tech lead would find nothing they block the merge for.

Past runs taught where defects come from: most of what reached the tech lead was born in the design
or the build (a check that failed open, a route that skipped the new guard, a swallowed error, a
poll that never paused, a test that could not fail), not missed by review. And they taught where
time goes: waiting, one thing after another. So lpk front-loads facts and checks, catches defects
on the line they are written, and runs everything that does not depend on the next step at the
same time: the environment, the tests, the slices of the build, the reviews and their verification.
Memory bounds that: before each fan-out (builders, the review workflow, a second app instance)
check `free -g`, and below 6 GB available run its parts one at a time. Sessions that ran this
machine out of memory died with all their work. Never `sleep` to wait: agents and workflows notify
you when they finish, and CI is watched with the Monitor tool on `gh pr checks <pr> --watch`.

Run `date +%s` first and keep the number: elapsed and wall times are measured from it, never
estimated. Post one line as each part starts (what, elapsed minutes, what comes next), with the
minutes from `echo $(( ($(date +%s) - <start>) / 60 ))` run just before it: a past run posted
"80 minutes" when 18 had passed.

Arguments: `$ARGUMENTS` (a request, a ticket key or URL, or a PR URL or number). If it is a PR with
review comments, follow `feedback.md` in this skill's directory instead.

A request that produces no code (research, a design, a plan, a document) skips every step below:
deliver it in the reply or an Artifact, readable in a minute (a picture before prose; a design of
1,500 lines was once thrown away unread), and ask before turning it into code.

## 1. Understand, with the environment coming up meanwhile

Start the `lpk:env` agent in the background at once, with the repo path, the profile path and the
surfaces you expect the change to touch: dependencies, services, the app and the test login get
ready while you read. Then read the ticket (the tracker is read-only unless the owner asks), the code
involved, and what `main` does today. A bug: follow `diagnose.md` in this skill's directory
before designing the fix. If
`~/.local/share/lpk/profiles/<repo>.md` exists, read it: how to start the app, log in, run what CI
runs, the tech lead's GitHub login, which checks are already red on main, and the repo's
conventions (how it handles errors, logs, calls other services, names things and writes tests, each
with a file to copy from).

Ask the owner about what changes the plan, before work starts: rounds of `AskUserQuestion`, your
recommended option first, with a concrete before/after to react to. Each round asks every question
whose prerequisites are settled; one that hangs on an answer still open waits for the next round.
Never ask what the code, the ticket or a sensible default answers. Once the owner says go, or is away, decide and log each
decision for the report.

## 2. Gather the facts the design needs

Run these in the repo before designing; they are exact and cheap:
- when the repo is on GitHub and the profile names the tech lead's login: `lpk reviews fetch
  --reviewer <login>` (fast after the first time), then `lpk precedent <the files you expect to
  change>`: what the tech lead said before on this code. A past blocker on a file you touch is a
  constraint on your design. Without both, skip it.
- `lpk map --routes --guard <the guard you will add or extend>`: every route and tool, and whether
  that guard appears in its handler. A handler that delegates shows NOT SEEN: follow it once
  (with the LSP tool's references when the repo has a language server).
- `lpk map <state, field or function>` (sibling submodules come by themselves; `--sibling <dir>` adds another repo): every writer and
  reader, and the tests that name each file.
- `lpk rules --list`: the rule catalog, one line per rule, then the team rule files. Read those
  and the full text of the rules that touch this change (`lpk rules --all`).

## 3. Choose the lane

- **Quick**: at most three source files in one repo, no route, auth, schema, migration, CI, deploy
  or cross-repo contract change, and no new state or dependency. Skip the brief, the design check
  and the parallel tracks, but write the failure table for what the change calls or stores (step
  4's failure modes, a few rows); start the run (step 5), build test-first, then step 6 Quick.
- **Full**: everything else. A Quick change that grows past those limits becomes Full.

One PR carries one ticket and stays under about 1,500 changed lines: review rounds grow with
both. When the request bundles tickets, or the design will pass that size, split it now into one
branch and PR per ticket or slice, in merge order; ask the owner once when the split changes what
ships together. `lpk facts` prints the branch name and commit subjects: read which tickets they name.

## 4. Design Brief, checked and turned into tests at the same time (Full lane)

Write it to `$(git rev-parse --git-common-dir)/lpk/brief.md`, where it outlives a compaction
and every agent reads the same text (give them the path), and post it in chat, one screen:
- who uses the change and where they meet it; before and after, in their terms;
- 3-7 acceptance scenarios, each a thing done on the real surface with the expected result,
  including at least one failure scenario, and each quoting the sentence of the request it serves;
  a sentence of the request that no scenario serves goes under out of scope, with why;
- **entry points**: every path from step 2 that reaches the changed state, each marked "passes
  `<guard>`" or "out of scope because ...";
- **failure modes**: for each dependency, key and new state, what happens when it is unreachable,
  slow, failing, garbled, unset, raced, repeated or growing without bound. The default is to refuse or report; allowing
  the action needs the request's own words;
- behaviour that changes against `main`, and anything `main` accepted that will now be refused;
- **what already exists**: the helper, component, standard-library or platform feature or installed
  dependency that already does part of this, with its path; the design uses it the way the
  surrounding code does, and adds no dependency for a few lines;
- the approach and the strongest alternative you rejected, chosen by correctness and risk for the
  users, never because it is closer to the current code or less work;
- **slices**: when the work splits into parts that touch disjoint files, each slice with the
  files it owns and the contract between them (types, routes, signatures, events); otherwise one
  slice. Mark a slice **high risk** when it decides who may do what or moves state that cannot be
  undone (auth, permissions, state transitions, money, migrations);
- **test plan**: which test drives which entry point and fails without the change, in a suite CI
  runs; paired PRs and their merge order if the change crosses repos; out of scope.

Create the branch (named the way the repo names them, with the ticket key where tickets exist),
then start these at once, in the background:
- `lpk:design-critic` with the brief path, the repo path, the base branch and the `lpk precedent`
  output;
- `lpk:test-author` with the repo path (the branch checked out), the brief and the test command:
  it writes the failing acceptance tests, and e2e scripts where the repo runs them, test files only;
- `lpk:designer` in design mode when the change touches a screen, with the brief path and the
  repo: put the UI section it returns in the brief and build the screens to it.
The build does not wait for the verdict: start the run (step 5) and build the approach as written
in the checkout while they work; the test author writes only test files there, so you do not
collide. Fix each blocker the critic reproduces in the brief and the code (or show with evidence
that it does not hold) and tell the test-author what changed; a second critic round is needed only
when the approach itself changed. Read the tests it writes before you build on them: each must
drive the real entry point and fail for the right reason. Commit them on their own (several
slices: `slices.md` says what to do when the repo's pre-commit hook refuses red tests).

## 5. Build, with every line checked as it is written

Start the run before the first production line: `lpk run start --base <base> --verify "<command>"`
for each check CI runs on the touched code (typecheck, lint, the test suites; `lpk facts` lists
them). It prints what its hooks hold you to until `lpk run end`; each candidate a hook returns
after an edit is fixed at once, or you know the one line that says why it is right.

Test first, at the entry point the user meets: the acceptance tests exist and fail; make them
pass. While you work, run only the tests related to the files you touched (`vitest related`,
`jest --findRelatedTests`, the test files `lpk map` names); the full checks run in `lpk verify`.
Put each invariant in the lowest function every writer passes through. Read the whole function you
change: a defect in it that your users will meet is fixed too, or named in the report. Build for
the system, not the diff: before you change a function, field, status, output shape or default,
`lpk map <name>` (`--sibling` adds a repo outside the superproject) and read every writer, reader and consumer it
lists; the change is done when each of them still holds. A limit you choose on purpose (a cap, a
single-process assumption, a case left out) gets a comment `shortcut: <the limit>, <when to
revisit>` on its line, so reviewers read it as a decision and the next person knows when it breaks.

Several slices: follow `slices.md` in this skill's directory.

When a fix draws a new problem on its own lines, or a second fix on the same idea fails, stop
patching: go back to the cause, choose again and rebuild that part.

## 6. Verify, freeze and start the reviewers

When the code is complete, read the whole diff once as the tech lead will (`git diff <base>`) and
cut every line the request does not need: drive-by edits, debug output, options nobody asked for,
exports nothing imports, comments that narrate. Every line in the diff is one more place to block
the merge. Then run `lpk verify` (a Bash timeout of 600000 ms, or in the background when the
checks take longer) until it is green, and commit (subjects of at most 72 characters: the push
hook refuses longer ones, merge commits, secrets gitleaks finds when installed, and during the run
any code no green `lpk verify` ran on). Run `git fetch`, then `lpk facts`: it prints the bundle
directory (its `impact.md` lists every place a touched name is used outside the diff, here and in
sibling submodules, and `precedent.md` what the tech lead said before), the number of diff groups,
the commands CI runs, and whether the branch is behind the target and still merges. Behind it:
rebase onto the target now, `lpk verify`, commit, and run `lpk facts` again, so the reviewers see
the code that will merge.

Quick lane: do step 7 and run the scenarios on the real surface yourself (for a running app, the
lpk Chrome is `mcp__plugin_lpk_chrome-devtools__*`) while `lpk mutate --hunks --test "<the tests
related to the changed files>"`, `lpk code-review --out <bundle>/cr1` and `lpk code-review --security
--out <bundle>/sec1` run in the background
(every hunk whose undo leaves the tests green is a missing test, code nobody needs, or only a
comment), then fix and deliver.

Full lane: freeze the commit in its own tree, so the reviewers and the prover use exactly it while
you keep working in the checkout: `git worktree add --detach ../<repo>-review <commit>`, link the
dependency directories from the checkout (`node_modules`, `.venv`, ...) or install them, and move
the app there (stop the checkout's instance, start the same command from the frozen tree; the env
agent's report says how). Then run the `lpk:review` workflow with the Workflow tool (it runs in the
background while you do step 7), with `args`: `repo` (the frozen tree), `base`, `commit`,
`bundle`, `request`, `scenarios` (each with the request sentence it serves), `failureModes` (the
table), `surface` (URL, start command and each login with its role, or empty when nothing runs),
`main` (the reference instance, if one runs), `ui` (the screens the change touches, empty when
none: the designer reviews them on the surface), `testCmd` (the command that runs the tests related
to the changed files) and `e2e` (the test-author's scripts). It runs the reviewers and the prover
at once, the mutant after the prover, and one `lpk:verifier` per finding as it arrives, and returns
`confirmed`, `unverified`, `preexisting`, `dropped`, the prover's results and the reviewers that
gave `noAnswer`; write it to `<bundle>/review.json` for `lpk:learn`. Without the Workflow tool,
start the agents `${CLAUDE_PLUGIN_ROOT}/workflows/review.js` starts yourself.

Push the branch and open a draft PR where the owner has authorized it, so CI runs in parallel too;
read any bot review that arrives.

## 7. Self-check while they review

On the reviewed commit, in the checkout, all of these; fix each defect you find at once (the
reviewers and the prover use the frozen tree, so your edits never change what they see):
- `lpk check`: every candidate the hooks did not already show you is a defect, or you can say in
  one line why it is right.
- `lpk rules`: for each loaded rule marked `blocks: high`, find the line that makes it hold. A rule
  you cannot point to code for is a defect.
- main against the change, on many inputs: for each changed function or entry point whose output
  main already produced, write a harness outside the repo that reads one input (stdin, or the file
  `$LPK_INPUT` names when the runner closes stdin, as `go test` does) and prints only the result
  (no ids, times or traces that change per run; where the language imports only from inside the
  module, the command copies the harness into its tree first), generate the inputs with a script
  (the shapes the change touches, edge and malformed ones, hundreds when they are cheap), and run
  `lpk compare --run "<harness>" --inputs <dir>`. Each row that differs is a behaviour change the
  request asks for, or a regression to fix. The table goes in the PR body.
- the dead-code finders `lpk facts` lists, run as CI would on the touched packages: report only names the diff added that nothing uses, and
  remove them.

## 8. Fix what is real, once

In the Full lane the workflow has verified each finding; reproduce yourself the `unverified` ones,
the prover's FAILs and your own step 7 findings, and rerun yourself what a reviewer in `noAnswer`
would have checked. In the Quick lane, start one `lpk:verifier` per /code-review finding, all in
the background, with the repo, the commit, the base and the finding (the security report's
vulnerabilities included). Fix each CONFIRMED finding at its root whatever its stated severity, since
reviewers' sense of severity rarely matches the tech lead's, including tests that cannot fail and
text that claims more than the code. Each fix is its own commit that changes only what its finding
needs and adds a test that fails without it: `lpk mutate --hunks --base <the reviewed commit> --test "<the related tests>"`
proves it (a fix hunk whose undo leaves the tests green has no test). A refactor or rewrite a
finding seems to call for is a separate PR, named in the report. PRE-EXISTING ones go in the report; DROPPED ones are listed
with the verifier's reason. Leave pure preferences alone and list them in the report.

There is one review round. After the fixes: `lpk verify` green, rerun step 7 on the files they
touched, move the app back to the checkout and rerun yourself the scenarios the fixes affect, commit, and run one `lpk code-review --out
<bundle>/cr2 --base <the reviewed commit>` on the fixes alone. Never start the techlead, the prover
or a whole-branch review again: past runs that did spent more time in those passes than in the
build, and each pass found something new on new lines. A reproduced finding on a fix's own lines
means that fix is wrong: redo it at the cause, or revert it and report the defect as open; do not
review again. What is still open goes in the report and the PR body, never silently.

## 9. Deliver

CI counts as green when every required check passes on the final commit, at least one job ran, and
nothing is red that is green on `main` (compare with `gh run list --branch main`). Green is not
proof the new tests ran: in that run's log (`gh run list --commit <sha>`, then `gh run view <id>
--log`), find each new test file or test name and a pass count above zero; a test CI never runs is
wired into the CI command now. A PR whose base
is not the default branch (a stack) may skip the gate a PR into main runs: compare its `gh pr
checks` with the jobs of a recent PR into main, run each missing job's command locally, and say in
the body which ran where; or open it as a draft into main until its base merges.

Once the PR is open its scope is frozen: new work, another ticket or another PR's branch goes in a
new PR, never merged or rebased into this one. Every review comment, human or bot, gets a row in
one triage comment on the PR: the point, its cause (why the code was wrong, not only where), and
fixed in `<sha>` with what changed, declined with the reason, or open. After each push,
watch with the Monitor tool until each review bot has reviewed the new head (each review's
`commit_id` in `gh api repos/<o>/<r>/pulls/<n>/reviews`), add its new comments and edit the
triage comment. The PR is ready only when every bot's newest review is on the head and no row is
open.

Write the PR body last, from the final diff, in the repo's template when it has one, and in every
lane with these sections, which the tech lead reads first:
- **What changed and why**;
- **Depends on**: each PR in another repo this one needs merged first, or with it, linked, and
  the merge and deploy order; "none" when it stands alone (check the consumers `lpk map
  --sibling` lists);
- **Changes vs main**: each behaviour that differs, checked on both branches (the `lpk compare`
  table, or the command run on each), and "none" with how you checked when nothing differs;
- **Failure table**: each dependency or state the change touches, when it fails, is slow, repeats
  or grows, and what happens then;
- **Tests that fail without the change**: each new test, the entry point it drives, and its red
  run on the base (the test-author's or `lpk mutate`'s output);
- **Proof and what was not verified**.
Put the proof's text (commands with their output, request and response excerpts) in a
`<details>` block; screenshots stay on this machine, listed by path. Then give the body and the
bundle to the `lpk:claims` agent, asking also for at most three questions the tech lead would ask
on reading it: fix each sentence the code does not back and add each section above that is
missing; answer in the body only those whose
answer is a fact about behaviour.
A red check is a finding: reproduce it here, fix it at its cause, `lpk verify`, commit and push,
and add its command to the run's checks and the repo profile.
Follow the authority this repo's CLAUDE files give the owner's agent (draft or ready PR, merge,
deploy); without one, stop at a draft PR and ask. Whenever you stop to ask the owner, here or
earlier, send the one-line question with `PushNotification` too: the owner is often away. Then `lpk run end` (it names the file of the
owner's messages), stop what the env agent started (its report lists the commands) and remove the
frozen tree (`git worktree remove ../<repo>-review`).

Update `~/.local/share/lpk/profiles/<repo>.md` with what you had to discover this time (start
command, logins and their roles, test command, tech lead login, known-red checks, test data
prefix, conventions), so the next run starts faster.

Report to the owner in Vietnamese, in the reply itself (never only a link), readable in ten seconds.
Tag every claim with how you know it: [đã chạy] with the command and its real output, [đọc code]
with `file:line`, or [suy luận]. Numbers come only from command output.
1. verdict: delivered, or what blocks it;
2. each acceptance scenario with its evidence on the delivered commit, or NOT PROVED and why;
3. decisions you took alone;
4. the weakest point;
5. wall time from the `date +%s` you kept, and the blockers the design check, techlead, regression,
   /code-review, /security-review, ocr, claims, mutant and prover found, with how many the verifiers confirmed;
6. the PR link and what the owner does next.

Then run the `lpk:learn` skill on this run's evidence: every finding confirmed after the build,
each CI failure, and the owner's messages file. A defect caught late is a rule that should have
caught it early. Close with one line: the rules it saved and the process changes it proposes.
