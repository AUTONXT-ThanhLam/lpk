# lpk eval cases

Each directory holds one `case.yaml`: a small seeded input in the prompt, one agent or skill of
this plugin, and a grader that decides the answer. They run with `claude plugin eval` on Sonnet,
and the cases and the judge both use Sonnet.

| Case | Checks |
| --- | --- |
| `lane-docs` | the skill sends a two-file doc fix to the Quick lane |
| `lane-cookie` | the skill sends an auth change to the Full lane |
| `bug-hunter-seeded` | `lpk:bug-hunter` reports an off-by-one at its line |
| `security-seeded` | `lpk:security` reports a missing owner check on a route |
| `claims-seeded` | `lpk:claims` reports an error message that promises a fallback the code does not make |
| `techlead-seeded` | `lpk:techlead` blocks a cancel route that refunds again on every call |
| `code-reviewer-seeded` | `lpk:code-reviewer` reports a negative amount the request refuses and no test covers |
| `claims-clean`, `techlead-clean`, `code-reviewer-clean` | the same change without the seeded defect: the agent must not report the defect of its twin, so a reviewer that flags everything scores low |

## Run

From the repository root. The path `./lpk` is required: a bare name resolves to the installed plugin.

```sh
claude plugin eval ./lpk --ablation none --runs 3 -j 2 --model sonnet --judge-model sonnet \
  --max-cost-usd 3 --threshold 0 --trust-plugin --no-publish \
  --output-dir /tmp/eval-out --json /tmp/eval-after.json
```

`--ablation none` compares nothing against a run without the plugin. `--threshold 0` keeps the
exit code at 0 so you read the JSON. `--output-dir` keeps reports out of the plugin. Add `--case
<name>` for one case, and `--keep-temp` to keep the traces.

## Compare two plugin versions

Check the older version out in its own directory, copy this `lpk/evals` into it, run the same
command there with `--json /tmp/eval-before.json`, then join the two files per case:

```sh
jq -rn --slurpfile a /tmp/eval-before.json --slurpfile b /tmp/eval-after.json '
  def mean: add / length;
  def per: [.cases[] | {key: .name, value: (.arms.with | {score: (map(.score)|mean), cost: (map(.costUsd)|mean), turns: (map(.turns)|mean), secs: (map(.durationSeconds)|mean)})}] | from_entries;
  ($a[0]|per) as $x | ($b[0]|per) as $y
  | $x | keys[] as $k | [$k, $x[$k].score, $y[$k].score, $x[$k].cost, $y[$k].cost, $x[$k].turns, $y[$k].turns, $x[$k].secs, $y[$k].secs] | @tsv'
```

Columns: case, score before and after, cost, turns, seconds. A drop in score is the first thing to
read. A case at 1 on both sides says only that no regression showed. Cost moves smaller than the
spread of three runs mean nothing, and seconds vary most. The cases cannot measure whole-run time,
gates or fix rounds: `lpk dev bench` reads those from recorded runs.
