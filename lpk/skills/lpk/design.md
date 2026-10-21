# Step 2: Design

**Goal.** A design that is checked against the real code before it is built, because 57% of the
fixed findings were born in the plan or the design. The brief is short, every claim in it comes
from a fact you ran or read, and the tests that decide "done" are written from it at once.

## Gather the facts

These are exact and cheap; run them before you design:
- `lpk reviews fetch --reviewer <login>` then `lpk precedent <files you expect to change>`, when
  the profile names the tech lead's login: what they said before on this code. A past blocker on a
  file you touch is a constraint on the design.
- `lpk map --routes --guard <guard>`: every route and tool, and whether the guard appears in its
  handler. A handler that delegates shows NOT SEEN: follow it once.
- `lpk map <state, field or function>` (`--sibling <dir>` adds a repo outside the superproject):
  every writer, reader and test. A durable value with more than one writer needs a reason.
- `lpk cochange <files>`: the files that usually change with these, and the fix, revert and
  hotfix commits on their lines. A needed file you forget is a finding later.
- `lpk rules --list`, then the full text of the rules that touch this change (`lpk rules --all`).
- `lpk floor`: the exact facts that make this change Full.

## Choose the lane

Quick or Full, as SKILL.md says, with the reason in one sentence (the lane's why). One PR carries
one ticket and stays under about 1,500 changed lines, because review rounds grow with both. When
the request bundles tickets or will pass that size, split it now into one branch and PR per ticket
or slice, in merge order, and ask the owner once when the split changes what ships together.

The Quick lane skips the rest of this file: number the requirements `R1`, `R2`… with their
sources, write the failure table for what the change calls or stores (a few rows), then go to
`build.md` in this skill's directory, which records both at `lpk run start`.

## Write the Design Brief (Full lane)

Write it to `$(git rev-parse --git-common-dir)/lpk/brief.md`, where it outlives a compaction and
every agent reads the same text, and post it in chat on one screen. Follow `writing.md` in this
skill's directory. It holds:
- who uses the change, where they meet it, and the before and after in their terms;
- the requirements, numbered `R1`, `R2`… in one list, each with its source (a quote, a document
  and section, or `inferred`). Every sentence of the owner's that asks for, forbids or limits
  something maps to one of them;
- 3 to 7 acceptance scenarios (`S1`, `S2`…), each done on the real surface with the expected
  result, at least one of them a failure, each with its route to proof (the command, test or screen
  that will show it) and the requirement ids it proves. Every requirement is proved by at least one
  scenario or failure row;
- the entry points that reach the changed state, each marked "passes `<guard>`" or "out of scope
  because ...";
- the failure modes (`FM1`, `FM2`…): for each dependency, key and new state, what happens when it
  is unreachable, slow, failing, garbled, unset, raced, repeated or growing without bound, and the
  requirement ids the row proves. The default is to refuse or report; allowing the action needs the
  request's own words;
- the behaviour that changes against `main`, and what `main` accepted that will now be refused;
- what already exists (a helper, component, platform feature or installed dependency), with its
  path, used the way the surrounding code uses it;
- the approach and at least one alternative you rejected, chosen by correctness and risk for the
  users, never because it is nearer the current code or less work;
- the slices: each with the files it owns and the contract between them. Mark a slice **high
  risk** when it decides who may do what or moves state that cannot be undone;
- the test plan: which test drives which entry point and fails without the change, in a suite CI
  runs, and the requirement id it proves (in the test's name or a `// R3` comment beside it).

Write the same in `brief.json`, beside it, with only what code reads: `requirements` (each
`{ id: "R1", text, source }`), `scenarios` (each with its `id`, its `text`, a `cmd` (and `expect`)
when a command proves it, and `proves`, the requirement ids), `failures` (each row with its `id`,
`provedBy` and `proves`), `slices` (each with its `files`) and `verify` (the check commands).
`lpk run start` records the scenarios of `brief.json` under the same ids; run it again after a
revision changes them. The `requirements` gate denies the handover until each requirement is proved
on HEAD: by a scenario or failure row that `proves` it and is green or a Prover PASS, or by a test
that names it on a line the change adds to a test file, with `lpk verify` green.

## Check it and write the tests at the same time

Save what the brief must trace to, verbatim, under `$(git rev-parse --git-common-dir)/lpk/sources/`:
the owner's request, each ticket or document it links, and the owner's answers so far. Create the
branch, named the way the repo names them, then start these in the background at once:
- the `lpk:design-review` workflow for round 1, with `repo`, `base`, `brief`, `briefJson`,
  `skillDir` (this skill's directory), `sources` (those files), `precedent` (the path of the
  `lpk precedent` output), `timeBound` (the owner's, else 45 minutes), `baseSuite` (the base test
  suite's time, once known) and `round: 1`. It runs the design critic, the plan simulator and the
  plan tracer at once, each fresh, and returns their findings rated High, Medium or Low;
- one `lpk:test-author` per slice of the brief, all in one message, each with the repo (the branch
  checked out), the brief's path, the test command, and only its slice's scenarios, failure rows and
  files; slices whose tests share a test file, helper, fixture, database or port share one test
  author;
- `lpk:designer` in design mode, when the change touches a screen.

The design is reviewed in rounds until no High remains. After each round:
1. Record it: `lpk decide "design review round <n>: <verdict>, <High>/<Medium>/<Low>" --why "<each
   High's cause, and what changes>"`.
2. `pass`: the review is done. `incomplete`: an angle never answered; run the round again.
3. `revise`: group the Highs by cause, together with the causes recorded for earlier rounds. Each
   finding is one place where its cause breaks; a fix closes the cause, not the place. For each
   cause, find every place in the brief that can break the same property (every writer of the same
   state, every scenario that proves it the same way, every requirement drawn from the same
   source) and close them all in this revision, with the one mechanism that holds the property
   where one exists (a fence or compare-and-set on the state, a single owner of a step, a constraint,
   a gate that runs the test). A cause that comes back after an earlier round fixed it was patched
   where it was seen: give it that mechanism now, and name it in the record. A High that is wrong is
   answered with a run, citing the command and its output in the brief beside the line it concerns:
   a disagreement is settled by a run, never by argument.
   Fix a Medium or Low when it is cheap, else list it for the report. Before editing, copy the brief
   to `brief.r<n>.md` beside it; then run round n+1 with `changed` set to the lines the revision
   changed, from
   `diff --unchanged-line-format= --old-line-format= --new-line-format="%dn%c'\012'" brief.r<n>.md brief.md`.
4. `redesign`: a High sits on lines the previous revision changed, so the design is wrong at its
   root. Choose a different approach, from the alternatives the brief weighed or a new one, never a
   third patch, and review it as round 1 again (no `changed`). A second `redesign` goes to the
   owner as one question, with the evidence.
5. A High raised again after the brief answered it with a run is still disputed: ask the owner one
   plain question, with both sides' evidence, and keep reviewing the rest.

When the owner says go, run `lpk go`: it records the brief's checks, so `lpk gates` can show what
changed after go. The build does not wait for the review: start the run (`build.md` in this
skill's directory) and build the slices no open High touches; a slice a later High touches waits
for the fix and is rebuilt from it. Read each test the test authors write before you build on it:
it must drive the real entry point and fail for the right reason.

**Done when** a design review round returned `pass` or its last High went to the owner, every
requirement has a scenario or failure row that proves it, every scenario has a test or a command
shown red on the base, and `lpk go` recorded the checks.
