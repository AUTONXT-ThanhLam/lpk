# Whole-flow runs

`claude plugin eval` cannot run lpk's flow: its sandbox mounts the working directory and `.git`
read-only, so no arm can branch or commit. `run.mjs` runs `claude -p` itself, in a throwaway repo
and a throwaway `HOME`, then grades the committed result with a hidden test the agent never sees.

Each task is a directory with `fixture.sh` (builds the repo), `prompt.txt` and `hidden.test.mjs`.

| Arm | Prompt | Plugin |
| --- | --- | --- |
| `without` | the task | none |
| `with` | `/lpk:lpk` and the task | loaded |
| `flow` | `/lpk:lpk`, the task, and an order to run `lpk run start` first and follow every step | loaded |

## Run

Needs GNU timeout (Linux; on macOS install coreutils).

From the repository root, on the account `cc-switch` has active. The script drops
`ANTHROPIC_API_KEY` from every child, because it outranks the OAuth token. The agent under test runs with your OAuth token in its
environment, the same as in an ordinary session. Each run is capped at the budget left.

```sh
cc-switch run env -u ANTHROPIC_API_KEY node lpk/evals-run/run.mjs \
  --task coupon --arms with,without,flow --runs 3 --max-cost-usd 10 --keep --out /tmp/flow.jsonl
```

One JSON row per run: `costUsd` (subagents included), `seconds`, `turns`, `hiddenPass`,
`hiddenFail`, `ownFail` (the repo's own tests), `commits`, `dirty`, `lpkRun` (the run state
exists). `--keep` leaves the workspaces in `/tmp` for reading the transcripts under `home/.claude`.

## What it showed

Sonnet, `results/<task>.jsonl`, one row per run. Pass means the hidden test passed in full; cost
and seconds are means per run (subagents included). `listed` has 4 `flow` rows and `contained` has
4 rows per arm and no `with` arm; every other cell has 5.

| Task | `without` | `with` | `flow` |
| --- | --- | --- | --- |
| `coupon` | 0/5, 0.07 USD, 19 s | 0/5, 0.11 USD, 24 s | 5/5, 0.82 USD, 283 s |
| `reopen` | 3/5, 0.05 USD, 17 s | 3/5, 0.10 USD, 20 s | 4/5, 0.60 USD, 159 s |
| `listed` | 0/5, 0.05 USD, 15 s | 0/5, 0.09 USD, 19 s | 0/4, 0.58 USD, 151 s |
| `contained` | 0/4, 0.05 USD, 17 s | not run | 0/4, 0.63 USD, 367 s |
| `cancel` | 5/5, 0.06 USD, 15 s | 5/5, 0.10 USD, 18 s | 5/5, 0.54 USD, 132 s |
| `csv` | 5/5, 0.05 USD, 16 s | 5/5, 0.10 USD, 22 s | 5/5, 0.46 USD, 222 s |

- `with` started an lpk run in 1 of 25 runs, so it behaves like `without` at twice the cost. Only
  `flow` runs the gates and reviews, always, at about 8.5 to 13 times the cost and 8.5 to 21 times the time.
- `coupon` is the one task where `flow` clearly won: it passed the floating-point cent trap
  (`applyCoupon(375, 18.4%)`) in 5 of 5 runs against 0 of 10 in the other two arms. The rows do not
  show which step of the flow caught it.
- `cancel` and `csv` are solved by every arm; they show the flow's price, not its worth.
- `reopen` differs by one run (3, 3, 4 of 5), which is noise. Its trap is not in the prompt or in
  `REVIEW.md`: a held item must stay held, which only `src/items.mjs` and its test show.
- `listed` and `contained` hold one trap of the same class: a path compared by its spelling, not by
  what it names (a symlink, or `realpath`). No arm passed in any run, `flow` included.

## What this sample cannot show

- Small n: 4 or 5 runs per cell. A difference of one run is not a difference.
- Sonnet only, one prompt per task, the agent's own reading of "follow REVIEW.md".
- The fixtures are invented, modelled on defects found in lpk's own code; the hidden tests were
  checked to fail on the base and pass with a reference solution. `reopen`'s grader accepts either a throw
  or an untouched item when a held item gets a proof, and every `reopen` row was graded with it.
- Pilot rows from before the harness wrote `results/` were not kept and are not counted.
- Not measured: the real CLI's behaviour at `--max-budget-usd` and at `error_max_turns`, and
  whether dropping a review lens costs correctness.

A grader must be one either arm can pass, and a trap written in the repo's `REVIEW.md` is solved by
every arm, so a task earns its place only where some arm sometimes fails. `cancel` and `csv` are
kept as the price baseline; `listed` and `contained` are kept as the limit no arm has passed yet.
