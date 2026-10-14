# lpk: rules for working on this repo

Before writing any line of code, test or prose, answer three questions, each with evidence:

1. **Is it correct?** Name the command whose output shows it.
2. **Is it needed?** Name who meets the problem and what they get without the line.
3. **Is it reasonable?** Does the design end, or will every fix draw the next finding?

A line that fails one of them is not written.

## What the code does, and what it never does

- `lpk/lib` computes exact facts from git and files. Meaning belongs to the agent, in
  prose: what a word says, what a shell string does, what a user intended.
- Never build a check that must decide an open-ended set (any shell command, any input a
  tool may write, any wording). Narrow the input, refuse it with a usage error, or print
  the fact and let the agent decide.
- Stabilise before expanding: a new command or rule waits until what exists works for a
  user.

## Tests

- A test protects something a user meets, not an edge catalogue.
- Prose is proven by facts a program decides (a file, a path, a command or a tool list it
  names exists) and by review. No test pins the wording of prose.

## Findings

- Fix a finding only when a user will meet it.
- Two fixes on one premise, or true findings on the last fix's own lines, mean the design
  is wrong: shrink or revert it. A third patch is never tried; what remains is handed back.

## Running lpk here

- Every run, status and proof uses this repo's CLI, `node lpk/bin/lpk`, never the
  installed `lpk` on PATH, which is an older version.
- No review ids, round numbers or triage mechanics in committed files, test names
  included.
- Files stay at 300 lines or fewer, and files in `lpk/lib` at 200 or fewer.
