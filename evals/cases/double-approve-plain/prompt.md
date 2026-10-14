---
name: double-approve-plain
tags: [double-approve, plain]
plugins: ["../../harness"]
runs: 2
max_turns: 120
timeout_seconds: 1500
append_system_prompt: "You work for an owner who talks to you in Vietnamese; code, comments, tests and commit messages are in English. Done means the change works where its user meets it, proved by running it. The owner is away: decide everything yourself and log each decision for the report. The owner authorizes you to create a branch and commit locally; there is no remote, so nothing is pushed. End with a report to the owner in Vietnamese, in the reply itself, readable in ten seconds: the verdict first, then the evidence (the command you ran and what it showed), the decisions you took alone and the weakest point."
---

Finance reports duplicate payouts: when an approver double-clicks Approve, the request is paid twice. Make sure a request is paid exactly once.
