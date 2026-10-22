# Step 2: Design

**Goal.** A design that is checked against the real code before it is built, because 57% of the
fixed findings were born in the plan or the design. The brief is short, every claim in it comes
from a fact you ran or read, and the tests that decide "done" are written from it at once.

## Gather the facts

These are exact and cheap; run them before you design:
- `lpk reviews fetch --reviewer <login>` then `lpk precedent <files you expect to change>`, when
  the profile names the tech lead's login: what they said before on this code. A past blocker on a
  file you touch is a constraint on the design.
- `lpk map --routes --guard <guard>`: every route and tool, and whether its handler has the guard.
- `lpk map <state, field or function>` (`--sibling <dir>` adds a repo outside the superproject):
  every writer, reader and test. A durable value with more than one writer needs a reason.
- `lpk cochange <files>`: the files that usually change with these, and the fixes on their lines.
- `lpk rules --list`, then the full text of the rules that touch this change (`lpk rules --all`).
- `lpk floor`: the exact facts that make this change Full.

## Choose the lane

Quick or Full, as SKILL.md says, with the reason in one sentence (the lane's why). One PR carries
one ticket and stays under about 1,500 changed lines, because review rounds grow with both. When
the request bundles tickets or will pass that size, split it now into one branch and PR per ticket
or slice, in merge order. A plan of several PRs is a brief too (the PRs, their order, the contract
between them), reviewed like one: an unreviewed contract once broke the base in ten places. Then
each PR is its own lpk run in its own worktree, side by side.

The Quick lane skips the rest of this file: number the requirements `R1`, `R2`… with their
sources, write the failure table for what the change calls or stores (a few rows), then go to
`build.md` in this skill's directory, which records both at `lpk run start`.

## Write the Design Brief (Full lane)

Save what the brief must trace to, verbatim, under `$(git rev-parse --path-format=absolute --git-dir)/lpk/sources/`:
the owner's request, each ticket or document it links, and the owner's answers so far.

Three architects write it, not you alone: three briefs from different approach cards, attacking
each other with runs, meet most defects before the first round. Run the `lpk:design-duel` workflow with `repo`, `base`,
`skillDir` (this skill's directory), `sources` (those files), `precedent` (the path of the
`lpk precedent` output, when there is one) and `dir` (`$(git rev-parse --path-format=absolute --git-dir)/lpk/duel`).
Without the Workflow tool, start the `lpk:architect` agents yourself, one per card (`small`,
`failure`, `pattern`), in its three steps (write, attack, revise), each step's three in one message.
It returns the briefs, the judge's `pick` and the attacks each brief still lets happen.

Take the judge's pick, unless a High it left open is one another brief closes: then take that
brief, or carry its mechanism over and cite it. With no pick, choose by the same rule; with an
`error` (fewer than two briefs), take the one written, or write it yourself. Copy the
chosen `brief.md` and `brief.json` to `$(git rev-parse --path-format=absolute --git-dir)/lpk/`, where they outlive a
compaction and every agent reads the same text, record the choice with `lpk decide`, and post the
brief in chat on one screen. The briefs you did not take are the alternatives a `redesign` starts
from.

The brief follows `writing.md` in this skill's directory. It holds:
- who uses the change, where they meet it, and the before and after in their terms;
- the requirements, numbered `R1`, `R2`… in one list, each with its source (a quote, a document
  and section, or `inferred`). Every sentence of the owner's that asks for, forbids or limits
  something maps to one of them;
- 3 to 7 acceptance scenarios (`S1`, `S2`…), each done on the real surface with the expected
  result, at least one of them a failure, each with its route to proof (the command, test or screen
  that will show it) and the requirement ids it proves. Every requirement is proved by at least one
  scenario or failure row;
- the entry points that reach the changed state, each "passes `<guard>`" or "out of scope: why";
- the failure modes (`FM1`, `FM2`…): for each dependency, key and new state, what happens when it
  is unreachable, slow, failing, garbled, unset, raced, repeated or growing without bound, and the
  requirement ids the row proves. The default is to refuse or report; allowing the action needs the
  request's own words. Where `main` already handles that failure another way, keep `main`'s
  behaviour unless the request changes it, because a new refusal is a regression;
- the behaviour that changes against `main`, and what `main` accepted that will now be refused;
- each mechanism the design builds (a loop, lock, retry, queue, poller, cache, event stream, table,
  script, component) and the first rung that holds it: not needed; a helper in the repo (its path);
  the public API of an installed dependency at its installed version (the export, and a run); the
  standard library or platform; built here, with the run that shows what the rungs above lack. A
  design from the owner or the tech lead gives requirements; its mechanisms climb the same rungs,
  and where a lower rung holds one, the brief takes it and says so in the next update to the owner;
- the approach and at least one alternative you rejected, chosen by correctness and risk for the
  users, never because it is nearer the current code or less work;
- the slices: each with the files it owns and the contract between them. Mark a slice **high
  risk** when it decides who may do what or moves state that cannot be undone;
- the test plan: which test drives which entry point, the plausible mistake it fails on, in a suite
  CI runs, and the requirement id it proves (in the test's name). A failure row no reasonable
  implementation gets wrong needs no test; every scenario has a test or a command red on the base.

Write the same in `brief.json`, beside it, with only what code reads: `requirements` (each
`{ id: "R1", text, source }`), `scenarios` (each with its `id`, its `text`, a `cmd` (and `expect`)
when a command proves it, and `proves`, the requirement ids), `failures` (each row with its `id`,
`provedBy` and `proves`), `slices` (each with its `files`) and `verify` (the check commands).
`lpk run start` records the scenarios of `brief.json` under the same ids; run it again after a
revision changes them. The `requirements` gate denies the handover until a green scenario, a
Prover PASS or a new test naming it with `lpk verify` green proves each requirement on HEAD.

## Check it, then write the tests

Create the branch, named the way the repo names them, then start these in the background at once:
- the `lpk:design-review` workflow for round 1, with `repo`, `base`, `brief`, `briefJson`,
  `skillDir` (this skill's directory), `sources` (those files), `precedent` (the path of the
  `lpk precedent` output), `timeBound` (the owner's, else 45 minutes), `baseSuite` (the base test
  suite's time, once known) and `round: 1`. It runs five design critics (one focus each), the plan
  simulator and the plan tracer at once, each fresh, and returns their findings rated High, Medium
  or Low; a High that rests only on inference counts as Medium;
- `lpk:designer` in design mode, when the change touches a screen.

When the review ends, start one `lpk:test-author` per slice, all in one message, each with the repo
(the branch checked out), the brief's path, the test command, and only its slice's scenarios,
failure rows and files; slices whose tests share a test file, helper, fixture, database or port
share one test author. Tests written during the review were rewritten three times in a past run.

The design is reviewed in rounds, at most three. From round 2 on, pass `open` (the previous round's
High findings) and `changed`: only the angles with an open High run again, each checking its Highs
are closed and reading the changed lines and what they reach. After each round:
1. Record it: `lpk decide "design review round <n>: <verdict>, <High>/<Medium>/<Low>" --why "<each
   High's cause, and what changes>"`, and append its Mediums and Lows to `notes.md` beside the brief.
2. At any verdict and rating, close each `reuse-first` finding (the `reuse` critic's, or one naming
   the rule) in the brief before the build: the helper or the dependency's API takes over the
   mechanism, or the brief cites the run that shows where it falls short.
3. `pass`: the review is done. `incomplete`: an angle never answered; run the round again.
4. `revise`: group the Highs by cause, together with the causes recorded for earlier rounds. Each
   finding is one place where its cause breaks; a fix closes the cause, not the place. For each
   cause, find every place in the brief that can break the same property (every writer of the same
   state, every scenario that proves it the same way, every requirement drawn from the same
   source) and close them all in this revision, with the one mechanism that holds the property
   where one exists (a fence or compare-and-set on the state, a single owner of a step, a constraint,
   a gate that runs the test). A cause that comes back after an earlier round fixed it was patched
   where it was seen: give it that mechanism now, and name it in the record. A High that is wrong is
   answered with a run, citing the command and its output in the brief beside the line it concerns:
   a disagreement is settled by a run, never by argument.
   A High only the owner can settle (the time bound, the scope) is one question to them. Mediums and
   Lows stay in `notes.md`, never in a revision. A revision grows the brief by at most a tenth
   (`wc -w`): briefs that grew 40% a round drew new Highs.
   Before editing, copy the brief to `brief.r<n>.md` (or hand the revision to `lpk:staff`); then run
   round n+1 with `changed` from `diff --unchanged-line-format= --old-line-format= --new-line-format="%dn%c'\012'" brief.r<n>.md brief.md`.
5. `redesign`: a design critic's open High is still open on the lines the revision changed, so the
   design is wrong at its root. When it sits in a hand-built mechanism, first ask whether the repo or a
   dependency does it. Choose a different approach, from the briefs the duel did not take, the
   alternatives the brief weighed or a new one, never a third patch, and review it as round 1 again
   (no `changed`). A second `redesign` in one review is answered as `last`.
6. `last`: round 3 still has Highs. Answer each with a run, or carry it into the build as a named risk with its test.
7. A High raised again after the brief answered it with a run: take the side the run supports, or
   the safer one, and log it.

When the review has ended and the owner says go (or is away), start the run (`build.md` in this
skill's directory), then run `lpk go`: it records the brief's checks, so `lpk gates` can show what
changed after go. A hook refuses an `lpk:builder` before `lpk go`, because code built on a brief
still under review was thrown away three times in a past run. Read each test the test authors write
before you build on it: it must drive the real entry point, fail for the right reason and name the
mistake it catches.

**Done when** a design review round returned `pass` or `last`, every requirement has a scenario or
failure row that proves it, every scenario has a test or a command red on the base, and `lpk go` ran.
