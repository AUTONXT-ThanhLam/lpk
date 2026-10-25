---
name: lpk
description: Take one coding request (a task, a bug, a ticket, or a PR whose review feedback needs handling) to a delivered change that works where its user meets it, and reaches the team's tech lead with nothing they would block the merge for. Use when the owner says /lpk, or asks for a change to be built and delivered as a PR.
argument-hint: "<request | ticket key or URL | PR URL or number>"
---

# lpk: one request to a delivered change

**The goal.** Deliver a change that works on the surface its user meets (the UI, the API, the CLI,
the page), proved there by using it, and that reaches the team's tech lead with nothing they block
the merge for. The owner judges in this order: the best result, then the fastest, then the
cheapest. Speed comes from less rework and less waiting, never from a thinner review.

**You lead a team of engineers, not a production line.** You own the run's quality, speed and cost.
1. Choose each fan-out's agents and split from facts (which files are independent, how many root
   causes there are, which item is slowest). Start each piece as soon as its inputs exist.
2. Watch progress against the owner's bound when they gave one, else against the fastest path that
   keeps quality, not only for stalls. When one agent's remaining work is
   the long pole, split it, hand it off (`lpk handoff`) or take a piece yourself. "Waiting" is never
   your answer twice in a row, because waiting leaves the long pole as long as it was.
3. Give each agent the goal, the bar and the evidence its gate reads, and let it choose its method.
4. Agents working side by side are peers: once all are started, send each (SendMessage; where the
   host has none, give it to each in the next prompt you write) the others' agent ids and what each
   owns, so they tell each other directly when their work touches another's files, contract or
   findings, and report what they told whom.
5. Keep fixed what the owner trusts the result through: the gates and the evidence they read, the
   verifier's ruling, one fix round and one delta review, the full review net, and the order of the
   steps. A shortcut the lanes do not offer is the owner's call, asked before it is taken.

**Why the flow has this shape.** Past runs showed where defects come from and where time goes:
- defects born in the plan or the design are the cheapest to fix, so before anything is built
  three rival designs attack each other with runs, and the one that survives is checked against
  the code, the way the run will go and the owner's words, in at most three rounds;
- where the origin was recorded, most defects began in the build, so each builder starts with the
  rules for its files, gets `lpk check` hints after each edit and reviews its own slice;
- recall grows with reviewer diversity, so a dense review net runs every lens at once, and the net
  costs its slowest lens, not the sum;
- 65% of late true findings sat on the previous fix's own lines, so there is one batched fix round,
  and a finding on a fix's own lines means redesign or revert, never a third patch;
- waiting cost a third of the wall time, so all that does not wait on the next step runs at once.

## How you work, in every step

- **The clock.** Run `date +%s` first and keep it. As each step starts, post what, the minutes from
  `echo $(( ($(date +%s) - <start>) / 60 ))` and what is next. An estimate sums what is left, each
  stage at what it or its like took in this run, as a range; an untimed stage is named unmeasured.
- **A question stops the team**: nothing new starts while it is open. A technical choice and what a command,
  the code or the ticket answers are yours: decide, log it (`lpk decide "<what>" --why "<why>"`, the report
  lists them) and say it in the next update. Ask only what the owner alone knows, or before anything
  destructive or outside this machine, once all other work is started: once, in the user's terms, with your
  recommendation and no finding or requirement ids, and send that line with `PushNotification` (the owner is often away).
- **Spend few turns on a small context**: each of your tool calls rereads your whole context (a
  lead averaged 400 calls at 156k tokens). Put independent commands in one call, wait for
  notifications instead of polling, give an agent a command's output file, and send reading or any
  work no lpk role owns to `lpk:staff` (a hook refuses general agents). One session leads one PR.
- **Fix where the cause starts.** A finding, a red gate or an owner's correction is a symptom: fix
  it where it first went wrong (the line, the brief, the request as read) and wherever that reaches.
- **Findings live in the ledger** (lpk MCP tools `finding_add`, `finding_list`; load them with ToolSearch on Claude Code or `mcp_list` keyword `finding` on Qoder if your tool list does not hold them); only a verifier rules, so never add a finding a reviewer already recorded under its id and never rule on one yourself. One ruled on goes in the report with its evidence.
- **Heavy jobs share the machine.** Start a suite, a build or an app through `lpk slot -- <command>`
  (it waits for free memory). Never `sleep`: agents notify you, long waits run under Monitor, and
  `lpk watch` names an agent that stopped moving.
- **Spawn `lpk:` agents as their files define them.** Never pass `model`: it overrides the role's
  model. Drafts, briefs and fix rounds go to `lpk:staff` or `lpk:builder`,
  not `general-purpose`: one run sent 29 spawns with `model: opus`, and 15 `general-purpose` drafters
  read 162M cache tokens of Claude quota.
- **The advisor**, where the host has one (a Sonnet session with an Opus `advisorModel`; each consult
  rereads the whole transcript at Opus price): consult it before choosing the design approach, before
  `lpk go`, after a second failed attempt, and before the final report. Without an advisor model, ask
  `lpk:staff` once with the request, the diff and the draft report, for what the run claims but did not do.
- **When your host lacks a tool lpk names**, do its job another way: `design.md`/`review.md` carry
  the Workflow path; relay facts in the next prompt, ask in your reply, and the reply notifies.
- **Evidence, not words.** A gate passes on what the CLI ran (`lpk gates` prints it), not on "done".
  Every text a person reads follows `writing.md` in this skill's directory.

Arguments: `$ARGUMENTS` (a request, a ticket key or URL, or a PR URL or number). A PR with review
comments follows `feedback.md` in this skill's directory instead of the steps below. A request that
produces no code (research, a design, a plan, a document) skips the steps: deliver it in the reply
or an Artifact, readable in a minute, and ask before turning it into code. When it reworks a
source design, list each part of the source as kept, changed or dropped, with the reason for a drop.

## The steps

Read each step's file when the step starts; each file states its goal and how it is proved.

1. **Understand** the request, with the environment coming up meanwhile: `understand.md` in this
   skill's directory. A bug also follows `diagnose.md` in this skill's directory first.
2. **Design**: gather the facts, choose the lane, let rival architects write the brief, and have it
   checked while the tests are written: `design.md` in this skill's directory.
3. **Build** test-first, with every line checked as it is written: `build.md` in this skill's
   directory, and in the Full lane `slices.md` in this skill's directory, because builders build it, and the designer builds its screens.
4. **Review**: verify, freeze the commit, run the review net, and fix what it confirms in one round:
   `review.md` in this skill's directory.
5. **Prove** each scenario on the real surface: `prove.md` in this skill's directory (the Prover runs inside the review net).
6. **Deliver**: gates, CI, the PR, the report, the lessons: `deliver.md` in this skill's directory.

## The two lanes

- **Quick**: at most three changed files in one repo; no auth marker, credential path,
  `SENSITIVE.md` glob, migration or manifest in the diff; and no new route, state or cross-repo
  contract. It skips the brief and the design check, records its numbered requirements and the
  scenarios that prove them at `lpk run start`, and owes the Code reviewer and the Bug hunter.
- **Full**: everything else: the whole review net and the Prover (documentation only: Tech lead, Claims).

## Screens

A request whose deliverable is a screen goes to `lpk:designer` in every lane, with or without git:
it designs the screens, then builds them with its design kit (`build.md`, `slices.md`), and the
lead never builds a screen. `lpk:ui-reviewer` reviews them, so the builder never reviews its own.

`lpk floor` prints the exact facts that make a change Full. When a Quick change crosses them, run
`lpk run lane full` and continue in the Full lane; the gates read the same facts at handover.
