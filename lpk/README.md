# lpk

A Claude Code plugin that carries one coding request to a delivered PR: facts from git first, a
design checked against the code, a test-first build with checks on every line as it is written,
then proof on the running app and a review of the same commit before the tech lead sees it.

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
the same on demand and prints which tool is missing.

## Use

- `/lpk:lpk <request, ticket or PR>` runs the whole flow; a PR with review comments runs the
  feedback flow.
- `/lpk:learn` turns defects found late (review comments, a run's evidence) into rules.
- `http://lpk.localhost:9339/` shows every live lpk run on this machine: what each delivers, its
  step, what is done and next, its last verify, commits and your messages, and the repo's own
  progress page when it has `.lpk/status/index.html`. `lpk run start` and `lpk status` print the
  link, and `lpk statusline` (for a `statusLine` command) makes the run's status line a link to
  it. A small model (`claude -p --model haiku`) writes the summary in the background every ten
  tool calls and at the end of each turn; the server listens on 127.0.0.1 only
  (`LPK_STATUS_PORT` changes the port) and stops half an hour after the last run ends.
  `LPK_STATUS_URL` is the address to print and accept instead, for a name of your own (a hosts
  entry forwarded to the port), and `lpk status serve --stay` keeps the server up for a login
  service.
- `node <plugin>/bin/lpk` with no arguments prints every command (`facts`, `rules`, `check`,
  `map`, `mutate`, `compare`, `code-review`, `verify`, ...).

What lpk writes for you stays on your machine, under `~/.local/share/lpk/`: `profiles/<repo>.md`
(how to start the app, log in, run what CI runs, and the tech lead's GitHub login, which turns on
`lpk reviews fetch` and `lpk precedent`), `rules/` (rules you learn) and `reviews/` (fetched review
comments). The shipped rules are in `rules/` here.
