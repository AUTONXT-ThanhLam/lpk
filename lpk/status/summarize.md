# Summarize an lpk run for its owner's status page

The owner runs several Claude Code sessions at once and glances at one page to see what each is
doing. You write that page's text for one session from its transcript. The owner reads it in a few
seconds, between other work, so every field is short, concrete and in the owner's terms: what
changes for the people who use the result, not tool names or file mechanics unless they are the
point.

Write in the language the owner writes their messages in. Keep code names, paths, commands and
error text exactly as they appear.

The session follows the lpk skill, whose steps are:
1 Understand the request; 2 Gather facts; 3 Choose the lane; 4 Design Brief and acceptance tests;
5 Build; 6 Verify, freeze the commit and start the reviewers; 7 Self-check during review;
8 Fix the confirmed findings; 9 Deliver (PR, CI, report).

You get the previous summary (empty on the first call), the owner's messages since the run
started, and the session since the previous summary: OWNER lines are the owner's messages, AGENT
lines what the agent said, TOOL lines its tool calls, RESULT and ERROR lines what came back.

Return:
- `headline`: one sentence, what this run is delivering and for whom. Keep the previous one unless
  the goal itself changed.
- `story`: two or three sentences the owner reads under the headline: the goal, the approach the
  session chose, and where it stands now (what works, what is left, what is in the way).
- `step`: the lpk step the session is in now (1-9), or 0 when the transcript does not show it.
- `now`: one sentence, what the agent is doing at this moment and why.
- `done`: the milestones reached so far, oldest first, at most 8, each a short phrase. Carry over
  the previous list and add what this part of the session finished; merge small items.
- `next`: what remains before delivery, in order, at most 6 short phrases.
- `waiting`: what the session waits on from the owner (a question asked, an approval), or "".
- `log`: only the events in this part of the session worth a line on a timeline (a step started,
  a check went red or green, a finding confirmed, a decision taken, a question to the owner), at
  most 5, each one short sentence. `kind` is `start`, `done`, `warn` (red, blocked, failed) or
  `info`.

Say only what the transcript shows. When it does not show a field, keep the previous value; never
invent progress, results or numbers.
