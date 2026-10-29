# lpk

A plugin for Claude Code that carries one coding request to a delivered PR that works
where its user meets it and reaches the tech lead with nothing they would block. Defects are caught
in three layers, cheapest first:

- **the design**: the lead checks the Design Brief against the owner's words and the running code before
  anything is built; a risky change (who may do what, state that cannot be undone, several repos) gets
  rival designs and a design critic that runs what the design relies on, in at most three rounds;
- **the build**: each builder starts with the rules for its files, gets a hint after each edit, and
  writes the tests that prove its slice with the code;
- **the review net**: every lens runs at once on the frozen commit (the tech lead, a review of
  the diff itself, the bug hunter, regression, claims, the security reviewer when the change touches
  credentials, auth, a migration or a sensitive path, OpenCodeReview
  on a change of more than ten files, mutants, and the screen
  lenses when screens change), a verifier reproduces each finding, and the Prover uses the change
  on its real surface.

Delivery gates read only what the CLI itself ran or computed: a verified tree, the findings ledger,
the reviews each lane owes, the scenarios and CI. `lpk gates` prints what each gate read.

## Install

Claude Code:

```
/plugin marketplace add AUTONXT-ThanhLam/lpk
/plugin install lpk@lpk-dev
```

Restart Claude Code. `/plugin` lists `lpk@lpk-dev`; `/plugin marketplace update lpk-dev` pulls
new versions.

## Needs

Node 24, git, the GitHub CLI `gh` (signed in) and Google Chrome or Chromium — and Claude
Code to run it in. lpk needs no model CLI of its own: each agent runs on the model its file
names (`model:` in `agents/`); your session's model is the captain's.
The rest comes with the plugin: the first session fetches gitleaks (pinned, checked against its
release checksums) into `~/.local/share/lpk/bin` for the push guard, and OpenCodeReview and the
Chrome DevTools server run through `npx` at pinned versions. `node <plugin>/bin/lpk setup` does
the same on demand and prints which tool is missing. The browser is a Chrome with remote debugging
on port 9333; a run without one proves through the HTTP API and the CLI only.

## Use

- `/lpk:lpk <request, ticket or PR>` runs the whole flow;
  a PR with review comments runs the feedback flow.
- `/lpk:learn` turns defects found late (review comments, a run's confirmed findings, CI failures)
  into rules, saved at once.
- `node <plugin>/bin/lpk` with no arguments prints every command.

## Roles

Each agent's file sets its `model` (Sonnet) and `effort`. Run the session itself on Sonnet with an Opus
`advisorModel`; a plugin cannot set the session's model. What an
agent may not do is set there too, not in prose: the reviewing roles cannot edit files, and the
architects write only their own briefs.

What lpk writes for you stays on your machine, under `~/.local/share/lpk/`: `profiles/<repo>.md`
(how to start the app, log in, run what CI runs, and the tech lead's GitHub login, which turns on
`lpk reviews fetch` and `lpk precedent`), `rules/` (rules you learn), `reviews/` (fetched review
comments) and `runs.jsonl` (one line per run, for measuring what each lens catches). A run's own
records (the brief, the findings ledger, what the CLI ran) live in the repo's git directory under
`lpk/`. The shipped rules are in `rules/` here.
