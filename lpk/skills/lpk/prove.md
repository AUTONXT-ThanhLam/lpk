# Step 5: Prove

**Goal.** Each acceptance scenario is shown PASS on the delivered commit, on the surface its user
meets, with evidence a reader can check. A scenario with no evidence is NOT PROVED, never PASS.

## What the gates read

- **Command scenarios** (`brief.json` `cmd`, or `--scenario` at `lpk run start`): `lpk prove --all`
  runs each against the current tree and records its exit and output. A command passes on exit 0
  and, when one was given, the expected literal in its output. It runs against the commit under
  test, never an app it did not start for that commit.
- **Agent-judged scenarios** (a screen, a flow, a judgement): the `lpk:prover` on the reviewed
  range, in either lane. Its structured output lists every scenario PASS, FAIL or NOT PROVED, and it
  records each FAIL and NOT PROVED in the ledger as a finding.

## How the Prover gets its surface

In the Full lane the net starts the Prover on the frozen tree. In the Quick lane, start it yourself
when a scenario is agent-judged, with the scenarios, the failure table, the commit, the surface and
the proof directory (`<bundle>/proof`).
- Start each app through `lpk spawn --port <port> -- <command>`: it records what it starts, reuses a live app it
  started for the same commit, port and data directory, and `lpk reap` stops exactly those when
  the run ends. Never stop a process another session started.
- When the env agent started a main instance, give it to the Prover as the reference for every
  behaviour the request did not ask to change.
- When the diff adds a migration, the Prover runs it forward on data shaped by main's code, then
  starts main's app on the migrated schema, because a deploy runs both for a while.
- The browser is the lpk Chrome, through `mcp__plugin_lpk_chrome-devtools__*`.
- Give it the profile's feature-map entries for the screens and commands the scenarios touch, so it
  opens each by its route and does not hunt for it. A route it had to correct comes back in its
  `noticed`, and you write it into the profile at handover.

## After a fix

Move the app back to the checkout, rerun yourself the scenarios the fixes affect, and run
`lpk prove --all` on the final tree: command scenarios key on the tree, so a rebase or a fix
re-runs them.

**Done when** `lpk gates` shows the scenarios row holding: every command scenario green on the
current tree, and every agent-judged scenario PASS in a Prover transcript on the reviewed range.
