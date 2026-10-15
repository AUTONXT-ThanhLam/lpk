---
name: learn
description: Turn evidence of a defect (review comments from any reviewer, the findings an lpk run confirmed, CI failures, fix commits after review, reverts and hotfixes, the owner's corrections) into rules lpk checks from then on, saved at once. Use when the owner says /lpk:learn, at the end of every lpk run, and after the lpk skill handles review feedback on a PR.
---

# lpk:learn: rules from every defect found

lpk's rule catalog came from the tech lead's past reviews. Every defect found after the line that
caused it was written is evidence of what the catalog still misses. This skill turns that evidence into rules, saved without asking: the owner
wants the catalog to grow with every review, and reads what was saved in the report.

Arguments: `$ARGUMENTS`: PR URLs or numbers, `<owner/repo> <reviewer-login>` for their recent
reviews, or the confirmed findings of an lpk run handed over by the lpk skill.

1. Collect the evidence. Each source gives defects with the file and line they sit on:
   - **review comments** from every reviewer of the PR, not only the tech lead: teammates, and bots
     (Copilot, CodeRabbit) whose comment a human agreed with or a commit fixed;
   - **an lpk run's findings**: what the reviewers, prover and verifiers confirmed
     (`<bundle>/review.json`, with what they dropped), and what the self-checks caught after the build. Each was born in the build and caught late;
     the rule should have caught it as the line was written;
   - **CI failures** on the PR (`gh pr checks`, `gh run view --log-failed`): a check that went red
     after the push names a command `lpk verify` should have run; write it into
     `~/.local/share/lpk/profiles/<repo>.md` as well as any rule;
   - **fix commits after review**: `git log <first review time>..<merge>` on the PR branch; the
     diff of each shows the defect and its fix exactly;
   - **reverts and hotfixes on main** (`git log --grep='^Revert\|hotfix\|fix' main`, with the PR
     each one fixes): a defect that reached users weighs most;
   - **the owner's corrections**: what they said was wrong, in their words. During an lpk run every
     message they sent is kept in `<git common dir>/lpk/prompts.jsonl` (`git rev-parse
     --git-common-dir`; one JSON object per line with `at` and `prompt`), and `lpk run end` names
     the file; read it before the run's marker directory is reused by the next run.
   For the tech lead's comments: `lpk reviews fetch --reviewer <login> --repo <checkout>` stores every
   comment of theirs, inline and review bodies, in `~/.local/share/lpk/reviews/<owner>__<repo>.jsonl`
   (one JSON object per line with `pr`, `path`, `line`, `hunk`, `body`, `url`). Without a checkout,
   use `gh pr view <pr> --json reviews,comments,title,url` and `gh api
   repos/<o>/<r>/pulls/<n>/comments --paginate`. Keep the reviewer's own words; note the file and
   line each comment is on.
2. Keep the defects. From review comments, those that would block a merge in the reviewer's own
   words ("blocking", "must fix", "changes requested", or a clear defect they asked to fix); drop
   nits, questions, praise and process remarks. From the other sources, every real defect; drop a
   flaky test or an outage that no line of code caused.
3. For each kept defect, read `lpk rules --all` and decide:
   - **covered**: a rule names this class, and its `when` trigger would load it on that diff
     (check the trigger against the commented line). Nothing to add.
   - **trigger gap**: a rule names the class but its trigger would not have loaded it, or a
     literal `find` pattern would have caught it. Propose a block under the same id with only
     the extra line, e.g. `### fail-closed` then ``- when: added `lockClient\.`` ``: lpk adds its
     triggers and patterns to the catalog rule of that id.
   - **new class**: no rule names it. Propose a rule in the catalog format: `### id: title`, then
     `blocks`, `when` (`always`, `removed`, ``added `regex` `` or ``path `regex` ``, the regex in
     backticks), optional ``find: `regex` ``, `rule` (what must hold, general enough to apply in other
     code), `check` (what to open or run, ending with the reproduction a finding needs).
   - **repo-only**: true only for this repo (its vocabulary, its layout). It goes in that repo's
     rules file, never in `all.md`.
4. Decide where each one goes: `all.md` when the rule holds in any codebase, the repo's file when
   it names this repo's vocabulary or layout. Drop one only when it duplicates a rule after all.
5. Append each rule or line to `~/.local/share/lpk/rules/all.md` or
   `~/.local/share/lpk/rules/<repo>.md` (the folder name of the repo's main checkout, also
   when you work in a worktree of it). `lpk rules` loads both
   from then on. Prove each one loads: `lpk rules --all` shows the new rule, or `extended by:` and
   the new trigger under the existing one, and lists nothing for that file under "patterns
   skipped". Run it with `--repo <the local checkout of that repo>` for a repo-only rule, since
   `<repo>.md` is chosen by that repo's name. Then show the trigger matches the commented
   line: `node -e 'console.log(/<regex>/i.test(process.argv[1]))' '<the line>'` prints true.

A defect no rule on lines can catch (a step done out of order, a check skipped, a wait that cost
an hour, a question the owner had to ask twice) is a lesson about the process: propose it in the
report as a change to the lpk skill or an agent, quoting the evidence. It is never saved as a
notes file, which nothing reads.

Never edit the plugin's own catalog here: a rule that belongs in it for everyone is a change to
the lpk repo, delivered like any other change. Report to the owner in Vietnamese: how many
comments were read, how many were already covered, each rule saved (its id, the file, the PR and
the comment it came from), and what was dropped and why, so the owner can delete a rule they
disagree with.
