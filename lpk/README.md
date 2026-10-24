# lpk

A Claude Code plugin that carries one coding request to a delivered PR that works where its user
meets it and reaches the tech lead with nothing they would block. Defects are caught in three
layers, cheapest first:

- **the design**: three fresh reviewers (a critic running what the design relies on, a simulation of
  the run, a trace back to the owner's words) check the Design Brief in at most three rounds, before
  anything is built;
- **the build**: each builder starts with the rules for its files, gets a hint after each edit, and
  reviews its own slice before it reports done;
- **the review net**: every lens runs at once on the frozen commit (the tech lead, `/code-review`,
  `/security-review`, bug hunting, regression, claims, OpenCodeReview, mutants, and the screen
  lenses when screens change), a verifier reproduces each finding, and the Prover uses the change
  on its real surface.

Delivery gates read only what the CLI itself ran or computed: a verified tree, the findings ledger,
the reviews each lane owes, the scenarios and CI. `lpk gates` prints what each gate read.

## Install

```
/plugin marketplace add AUTONXT-ThanhLam/lpk
/plugin install lpk@lpk-dev
```

Restart Claude Code. `/plugin` lists `lpk@lpk-dev`; `/plugin marketplace update lpk-dev` pulls
new versions.

## Needs

Node 24, git, the GitHub CLI `gh` (signed in), the `claude` CLI and Google Chrome or Chromium.
The rest comes with the plugin: the first session fetches gitleaks (pinned, checked against its
release checksums) into `~/.local/share/lpk/bin` for the push guard, and OpenCodeReview and the
Chrome DevTools server run through `npx` at pinned versions. `node <plugin>/bin/lpk setup` does
the same on demand and prints which tool is missing. The browser is a Chrome with remote debugging
on port 9333; a run without one proves through the HTTP API and the CLI only.

## Use

- `/lpk:lpk <request, ticket or PR>` runs the whole flow; a PR with review comments runs the
  feedback flow.
- `/lpk:learn` turns defects found late (review comments, a run's confirmed findings, CI failures)
  into rules, saved at once.
- `node <plugin>/bin/lpk` with no arguments prints every command.

## Roles

Each agent's model and effort are set in its file under `agents/`, chosen by measured results:
Opus where judgement sets the quality (the three architects, the plan simulator, the designer, which also builds the screens, the
Prover), Sonnet where another layer checks the output (building, reviewing, verifying, the staff agent's side work, and the
design critics, one focus each, that together found more than one Opus critic at less cost), Haiku
for the environment. The reviewing roles cannot edit files, and the architects write only their
own briefs.

What lpk writes for you stays on your machine, under `~/.local/share/lpk/`: `profiles/<repo>.md`
(how to start the app, log in, run what CI runs, and the tech lead's GitHub login, which turns on
`lpk reviews fetch` and `lpk precedent`), `rules/` (rules you learn), `reviews/` (fetched review
comments) and `runs.jsonl` (one line per run, for measuring what each lens catches). A run's own
records (the brief, the findings ledger, what the CLI ran) live in the repo's git directory under
`lpk/`. The shipped rules are in `rules/` here.
