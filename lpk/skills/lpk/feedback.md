# Review feedback on an open PR

Read this when the lpk request is a PR whose review comments need handling.

Fetch every comment (`gh pr view --comments`, `gh api` for inline review comments) and the CI state.
Reproduce each comment against the current head and against `main`: fix it at the root, or answer
it in the PR with the evidence that it does not hold. Each reply names the point's cause (why the
code was wrong) and its fix. Answer in PR comments, not by rewriting the
PR body. The scope is the comments; the triage comment (step 9) is updated after each push, and
`lpk:claims` checks the PR body against the new diff each round: fix each sentence it no longer
backs.

Then start the run (step 5, first paragraph) and run steps 6 to 9 with these inputs: the request is
the PR's purpose plus the comments you fixed; each fixed comment is an acceptance scenario (what
the reviewer did or pointed at, and the result they expect now); the lane is Quick unless the
fixes cross the Quick limits in step 3, and then the failure-mode table covers only what the fixes
touch. Each fixed comment is one commit with a test that fails without it, as step 8 says.

Then run the `lpk:learn` skill on the PR.
