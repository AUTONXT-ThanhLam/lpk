---
name: lpk
description: Take one coding request (a task, a bug, a ticket, or a PR whose review feedback needs handling) to a delivered change that works where its user meets it, and reaches the team's tech lead with nothing they would block the merge for. Use when the owner says /lpk, or asks for a change to be built and delivered as a PR.
argument-hint: "<request | ticket key or URL | PR URL or number>"
---

# lpk: one request to a delivered change

**The goal.** Deliver a change that works on the surface its user meets (the UI, the API, the CLI,
the page), proved there by using it, and that reaches the team's tech lead with nothing they block
the merge for. The owner judges in this order: the best result, then the fastest, then the
cheapest. A run of 30 to 45 minutes is fine for a task plain Claude Code does in 15; one or two
hours is not. Speed comes from less rework and less waiting, never from a thinner review.

**You lead a team of engineers, not a production line.** You own the run's quality, speed and cost.
1. Choose each fan-out's agents and split from facts (which files are independent, how many root
   causes there are, which item is slowest). Start each piece as soon as its inputs exist.
2. Watch progress against the owner's bound, not only for stalls. When one agent's remaining work is
   the long pole, split it, hand it off (`lpk handoff`) or take a piece yourself. "Waiting" is never
   your answer twice in a row, because waiting leaves the long pole as long as it was.
3. Give each agent the goal, the bar and the evidence its gate reads, and let it choose its method.
4. Agents working side by side are peers: once all are started, send each (SendMessage) the others'
   agent ids and what each owns, so they tell each other directly when their work touches another's
   files, contract or findings, and report what they told whom.
5. Keep fixed what the owner trusts the result through: the gates and the evidence they read, the
   verifier's ruling, one fix round and one delta review, and the full review net.

**Why the flow has this shape.** Past runs showed where defects come from and where time goes:
- 57% of the fixed findings were born in the plan or the design, so before anything is built
  three rival designs attack each other with runs, and the one that survives is checked against
  the code, the way the run will go and the owner's words, in rounds until no High finding remains;
- most of the rest were born in the build, so each builder starts with the rules for its files,
  gets `lpk check` hints after each edit, and reviews its own slice before it reports done;
- recall grows with reviewer diversity, so a dense review net runs every lens at once, and the net
  costs its slowest lens, not the sum;
- 65% of late true findings sat on the previous fix's own lines, so there is one batched fix round,
  and a finding on a fix's own lines means redesign or revert, never a third patch;
- waiting cost a third of the wall time, so everything that does not depend on the next step runs
  at the same time.

## How you work, in every step

- **The clock.** Run `date +%s` first and keep the number. Post one line as each step starts: what,
  the elapsed minutes from `echo $(( ($(date +%s) - <start>) / 60 ))`, and what comes next. A past
  run posted "80 minutes" when 18 had passed.
- **Keep going.** When a step does not need the owner, keep going. Put status notes in the same
  message as your next action. Stop and ask only when you cannot continue without the owner, or
  before anything destructive or outside this machine.
- **Probe before you ask.** A question that a command, the code or the ticket answers is answered
  by running it. A requirement with a sensible default is decided and logged, not asked.
- **Log each decision** you take alone: `lpk decide "<what>" --why "<why>"`. The report lists them.
- **Evidence, not words.** A gate passes on what the CLI ran or computed: `lpk gates` prints each
  gate and what it read. An agent's "done" is not evidence.
- **Keep your own context small**: every later turn pays for it. Read a command's output from its
  file, and give an agent that path, never a copy retyped by a model (a retyped list once lost a
  whole PR's findings). Hand a long read to an agent and keep only its conclusion. Start a fresh
  agent with a short brief rather than re-brief one whose context is mostly spent.
- **Findings live in the ledger.** Every finding is recorded with the lpk MCP tools (`finding_add`,
  `finding_list`; load them with ToolSearch `select:mcp__plugin_lpk_lpk__finding_list`), and only a
  verifier rules on one. A finding you rule on yourself goes in the report with its evidence.
- **Heavy jobs share the machine.** Start a test suite, a build or an app through
  `lpk slot -- <command>`: it waits for free memory, because sessions that ran this machine out of
  memory died with all their work. Never `sleep`: agents and workflows notify you when they finish,
  and long waits run under the Monitor tool (`lpk watch` names an agent that stopped moving).
- **Write plainly.** Every text a person reads follows `writing.md` in this skill's directory.
- **Name agents by job title** in what the owner reads: the Tech lead, the Verifier, the Prover.

Arguments: `$ARGUMENTS` (a request, a ticket key or URL, or a PR URL or number). A PR with review
comments follows `feedback.md` in this skill's directory instead of the steps below. A request that
produces no code (research, a design, a plan, a document) skips the steps: deliver it in the reply
or an Artifact, readable in a minute, and ask before turning it into code.

## The steps

Read each step's file when the step starts; each file states its goal and how it is proved.

1. **Understand** the request, with the environment coming up meanwhile: `understand.md` in this
   skill's directory. A bug also follows `diagnose.md` in this skill's directory first.
2. **Design**: gather the facts, choose the lane, let rival architects write the brief, and have it
   checked while the tests are written: `design.md` in this skill's directory.
3. **Build** test-first, with every line checked as it is written: `build.md` in this skill's
   directory, and `slices.md` in this skill's directory when the brief has more than one slice.
4. **Review**: verify, freeze the commit, run the review net, and fix what it confirms in one round:
   `review.md` in this skill's directory.
5. **Prove** each scenario on the real surface: `prove.md` in this skill's directory. The Prover
   runs inside the review net; this file says what proof the gates read.
6. **Deliver**: gates, CI, the PR, the report, the lessons: `deliver.md` in this skill's directory.

## The two lanes

- **Quick**: at most three changed files in one repo; no auth marker, credential path,
  `SENSITIVE.md` glob, migration or manifest in the diff; and no new route, state or cross-repo
  contract. It skips the brief and the design check, records its numbered requirements and the
  scenarios that prove them at `lpk run start`, and owes one `/code-review`, `/security-review`
  and the Bug hunter.
- **Full**: everything else. It owes the whole review net and the Prover.

`lpk floor` prints the exact facts that make a change Full. When a Quick change crosses them, run
`lpk run lane full` and continue in the Full lane; the gates read the same facts at handover.
