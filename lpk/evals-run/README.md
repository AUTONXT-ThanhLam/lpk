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

From the repository root, on the account `cc-switch` has active. The script drops
`ANTHROPIC_API_KEY` from every child, because it outranks the OAuth token.

```sh
cc-switch run env -u ANTHROPIC_API_KEY node lpk/evals-run/run.mjs \
  --task coupon --arms with,without,flow --runs 3 --max-cost-usd 10 --keep --out /tmp/flow.jsonl
```

One JSON row per run: `costUsd` (subagents included), `seconds`, `turns`, `hiddenPass`,
`hiddenFail`, `ownFail` (the repo's own tests), `commits`, `dirty`, `lpkRun` (the run state
exists). `--keep` leaves the workspaces in `/tmp` for reading the transcripts under `home/.claude`.

## What it showed

A pilot of 2 to 3 runs per arm on three tasks (coupon, cancel, csv), Sonnet. The rows were not
committed, so read these as direction, not as measurements.

- `with` mostly did not start a run: on a task of one file plus a test the agent judged the flow
  unnecessary, so no gate or review applied. It cost about 1.6 to 1.9 times `without`.
- `flow` started a run every time and cost many times `without` (up to about 16), in 70 to 230
  seconds against 15 to 30.
- All arms passed the five specified-behaviour tests. A sixth hidden test, added afterwards, grades a
  percent coupon that is a cent low in floating point (`applyCoupon(375, 18.4%)` returns 307, not
  306). Regraded on the kept workspaces it passed in 2 of 2 `flow` runs, 1 of 3 `with` runs and 0
  of 4 `without` runs.

A grader must be one either arm can pass, and a trap written in the repo's `REVIEW.md` is
solved by every arm, so a task earns its place only where the plain agent sometimes fails.
