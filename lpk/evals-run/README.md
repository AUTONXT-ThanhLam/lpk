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

Flags shared by every arm: `--tasks <dir>` holds `<task>/prompt.txt` and `<task>/fixture.sh`,
`--hidden <dir>` holds `<task>/hidden.test.mjs` (both default to this directory);
`--out-dir <dir>` keeps each run in `<dir>/<task>-<arm>-<n>/` (`home` and the clone, named
`<task>-<arm>-<n>-<batch id>`): the home, the clone and the transcripts stay, and only a comparison
removes anything: the clone's worktrees outside the run directory, such as `/tmp/<clone>-main`; `--run-timeout <seconds>` (default 2400) and
`--max-run-usd <n>` (default the budget left) cap one run; `--max-turns` reaches `claude` only when
given. When `--hidden` is given, it may not equal, contain or lie inside `--out-dir`, and a row whose
transcripts hold the `--hidden` path, as given or resolved, carries `hiddenSeen: true` and is still graded:
the runner prints the fact and the reader decides. A read that never prints the path (a relative path
after a `cd`, a glob) is not seen; the directory lies outside every clone and `HOME`, so read the kept
transcripts before trusting a comparison.

## Comparing two lpk versions

```sh
cc-switch run env -u ANTHROPIC_API_KEY node lpk/evals-run/run.mjs \
  --baseline /tmp/lpk-main --candidate . --hidden /tmp/lpk-hidden --out-dir /tmp/lpk-proof \
  --task coupon --runs 3 --max-cost-usd 20 --out /tmp/proof.jsonl
```

Each arm is the top directory of a git checkout holding `lpk/bin`: its `lpk/bin` leads `PATH`, its `lpk` is the `--plugin-dir`, and both
send the `flow` prompt; no other directory holding an `lpk` stays on its `PATH`. `--out-dir` is
required, and so is `--hidden` except with `--smoke`; `--hidden` may not equal, contain or lie
inside either arm or this checkout either. Each pair runs the two arms in a random order;
a row adds `commit` (the arm's `HEAD`; `armDirty` counts its uncommitted changes, when any), `pair` (the run number, one above the highest already in `--out-dir`, so a
stopped batch never re-pairs) and `pos` (0 or 1).

The batch needs the host to itself: no other lpk session, and the owner's Chrome on `--busy-port`
(default 9333) closed. A listener on that port before a run stops the batch. After each run the
arm's own `lpk reap --repo <clone>` stops the apps it spawned (a failure is recorded in `reap`
and the batch goes on), and the clone's worktrees outside the
run directory (`/tmp/<clone>-main`) are removed. A listener left on the port whose
`--user-data-dir` (or, without one, its `HOME`) lies in the run's `home` is the run's own Chrome: it is stopped and the
row gets `ownChrome: true`; if it is still on the port after being stopped, the row is voided and
the batch stops. Any other listener voids the row (`voided: "a listener on the port
after the run"`) and stops the batch; it is never stopped.

`--smoke` runs one tiny task per arm instead of the tasks: its prompt asks for a background
Workflow call. The row gets `smoke: "pass"` only when the transcript holds the `Workflow` call and,
after it and before the last assistant message, its task notification with `completed`, as a user
message or as the queued command Claude Code records mid-turn.

## What it showed

Sonnet, `results/<task>.jsonl`, one row per run. Pass means the hidden test passed in full; cost
and seconds are means per run (subagents included). `listed` has 14 `flow` rows and `contained` has 4 `without` rows, no `with` arm and 14 `flow` rows (4 before the rules, 10 after);
every other cell has 5.

| Task | `without` | `with` | `flow` |
| --- | --- | --- | --- |
| `coupon` | 0/5, 0.07 USD, 19 s | 0/5, 0.11 USD, 24 s | 5/5, 0.82 USD, 283 s |
| `reopen` | 3/5, 0.05 USD, 17 s | 3/5, 0.10 USD, 20 s | 4/5, 0.60 USD, 159 s |
| `listed` | 0/5, 0.05 USD, 15 s | 0/5, 0.09 USD, 19 s | 0/4, 0.58 USD, 151 s before the rules; 10/10, 1.02 USD, 344 s with them |
| `contained` | 0/4, 0.05 USD, 17 s | not run | 0/4, 0.63 USD, 367 s before the rules; 10/10, 1.19 USD, 467 s with them |
| `cancel` | 5/5, 0.06 USD, 15 s | 5/5, 0.10 USD, 18 s | 5/5, 0.54 USD, 132 s |
| `csv` | 5/5, 0.05 USD, 16 s | 5/5, 0.10 USD, 22 s | 5/5, 0.46 USD, 222 s |

- `with` started an lpk run in 1 of 25 runs, so it behaves like `without` at twice the cost. Only
  `flow` runs the gates and reviews, always, at about 8.5 to 13 times the cost and 8.5 to 21 times the time.
- `coupon` is the one task where `flow` clearly won: it passed the floating-point cent trap
  (`applyCoupon(375, 18.4%)`) in 5 of 5 runs against 0 of 10 in the other two arms. The rows do not
  show which step of the flow caught it.
- `cancel` and `csv` are solved by every arm; they show the flow's price, not its worth.
- `reopen` differs by one run (3, 3, 4 of 5), which is noise. The prompt says an exit of 0 marks
  the item done and a non-zero exit puts it back to todo; the grader also requires a held item to
  stay held, a rule only `hold` and `open` in `src/items.mjs` show.
- `listed` and `contained` hold one trap of the same class: a path compared by its spelling, not by
  what it names (a symlink, or `realpath`). No arm passed in any run, `flow` included, until the
  `path-identity` rule and the line in `build.md` that sends a builder to read a flagged rule's text.
  With the rule and the `build.md` line `flow` passed `listed` 4 of 5 (0 of 4 before) and `contained` 5 of 10 (0 of 4 before). With the rule alone,
  `listed` was 1 of 5 and `contained` 0 of 5, because `lpk check` prints only a rule's id and 9 of 10 runs never read its text.
  In the three failing `contained` runs the builder wrote `relative(resolve(root), resolve(file))` and defended it; two never opened the rule.
  The hook that reports a candidate now prints the flagged rule's text once per run, and `flow` then passed `listed` 10 of 10 and
  `contained` 10 of 10. These are the last 10 `flow` rows in each results file.

## Other models

`--model haiku` and `--model opus` on the two path-identity tasks, with the hook that prints the flagged rule's text.
Rows carry a `model` field; the rows without one are Sonnet. n is 5 per cell.

| Task | Model | `without` | `flow` |
| --- | --- | --- | --- |
| `contained` | haiku | 0/5, 0.00 USD, 22 s | 5/5, 0.66 USD, 1323 s |
| `contained` | opus | 0/5, 0.14 USD, 31 s | 5/5, 1.83 USD, 333 s |
| `listed` | haiku | 0/5, 0.00 USD, 21 s | 5/5, 0.49 USD, 494 s |
| `listed` | opus | 2/5, 0.16 USD, 35 s | 5/5, 1.37 USD, 289 s |

- The three models agree: the trap is not solved without the flow (Sonnet 0 of 5 and 0 of 4, haiku 0 of 10, opus 2 of 10), and the flow solves it.
- Haiku `flow` is slow, not dear: three `contained` runs and one `listed` run took 1200 to 2400 s.
- An opus `contained` batch hit its `--max-cost-usd` in the middle of a `without` run; that row was dropped and the run repeated.

## What this sample cannot show

- Small n: 4 or 5 runs per cell. A difference of one run is not a difference.
- Sonnet for most cells, haiku and opus only on `listed` and `contained`; one prompt per task, the agent's own reading of "follow REVIEW.md".
- The fixtures are invented, modelled on defects found in lpk's own code; the hidden tests were
  checked to fail on the base and pass with a reference solution. `reopen`'s grader accepts either a throw
  or an untouched item when a held item gets a proof, and every `reopen` row was graded with it.
- Pilot rows from before the harness wrote `results/` were not kept and are not counted.
- Not measured: the real CLI's behaviour at `--max-budget-usd` and at `error_max_turns`, and
  whether dropping a review lens costs correctness.

Three larger invented tasks (an orders API whose amount is shown in nine places, an items store with an archive filter,
a notes store with a file format) were piloted and left out: `without` passed all 12 runs at about 0.09 USD and 5 turns,
so a `flow` run could only tie. A fourth, a digest job whose per-user failure must not stop the others, was dropped the same way once its prompt named where `now` goes: `without` passed 3 of 3. Stated-rule tasks of that size do not measure the flow; a task needs a rule whose
application, not its discovery, is hard, as the path-identity ones are.

A grader must be one either arm can pass, and a trap written in the repo's `REVIEW.md` is solved by
every arm, so a task earns its place only where some arm sometimes fails. `cancel` and `csv` are
kept as the price baseline; `listed` and `contained` are kept as the limit: both pass in 10 runs of 10.
