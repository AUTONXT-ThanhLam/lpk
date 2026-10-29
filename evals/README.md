# lpk eval suite

Paired `claude plugin eval` cases: each `<case>-lpk` sends `/lpk:lpk <request>` with the plugin
loaded, and `<case>-plain` sends the same request without it. Both load `harness/`, whose Stop hook
runs the case's hidden checks (`harness/checks/<case>.mjs`) against the workspace and writes
`verdict.txt`. The `hidden-checks` grader reads that file; the `report` grader judges the final
report to the owner.

Each fixture in `fixtures/` hides a trap a reviewer blocks on: a second writer that bypasses the
fix, a consumer that parses the changed output, a test that cannot fail, a symptom fixed instead of
its cause, an error swallowed into a fake value, commit hygiene, a background task whose failure is
lost, and a check-then-act race. Every check fails on the fixture as shipped.

Run from the repository root (the case plugins must sit outside the plugin under test):

```sh
claude plugin eval . --eval-dir evals/cases --ablation none --model sonnet --runs 3 -j 4 \
  --judge-model sonnet --scaffold --trust-plugin --allow-tools Bash Edit Write
```

The sandbox has no network, so the lpk arm cannot run its nested `/code-review`, techlead or
prover here; the cases measure what the skill's process changes before review.
