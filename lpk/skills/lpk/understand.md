# Step 1: Understand

**Goal.** Know what the user needs, where they meet it, and what `main` does today, before any
design. Ask the owner only what changes the plan. The environment comes up while you read, so
nothing waits for an install, a database or a login later.

1. **Start the environment at once.** Start the `lpk:env` agent in the background with the repo
   path, the profile path and the surfaces you expect the change to touch. Start the repo's base
   test suite in the background too (`lpk slot -- <test command>`), so you know which tests are red
   before any change.
2. **Read the repo profile.** `~/.local/share/lpk/profiles/<repo>.md` (`<repo>` is the folder name
   of the main checkout, also from a worktree) says how to start the app, log in (by variable name
   only), run what CI runs, the tech lead's GitHub login, the checks already red on main, the
   screens a past run drove, and the repo's conventions, each with a file to copy from. It holds
   the feature map too and the lines of what was tried and ruled out. A past dead end on a
   file you touch is a constraint on the design, as a past blocker is.
3. **Read the request and the code.** Read the ticket (the tracker is read-only unless the owner
   asks), the code involved and what `main` does today. Run `git fetch`, then `lpk facts --about <file>...`:
   it prints the open PRs and the target commits HEAD lacks that touch the files you name. A fix that is
   already there ends the run as "already fixed in `<sha>`", with the evidence.
   Before you remove or loosen a guard, retry, timeout or flag, run `git log -S` on it and read
   the pull request that added it: the code is never proof of its intent, and the owner's own
   hypothesis about it is a candidate, not a premise.
4. **A bug follows `diagnose.md` in this skill's directory** before any design: a fix built on a
   guessed cause ships a second bug.
5. **Say back what you understood, and ask what only the owner knows.** Before any design, write
   in the user's terms: who uses the change and where, the before and the after, the bar
   (increment, or production when asked), the platforms and surfaces it must work on, and what is
   out of scope. Mark each line as read from a source or taken as a default. The owner's yes to
   that text is the cheapest check that the run builds what they meant; a correction costs a line
   now and a rebuild later. Ask what only the owner knows: what users should get where the
   sources leave it open, the scope, the bar and platform when the request does not say, a cost or
   time limit. Use rounds of `AskUserQuestion`, your recommended option first, each
   with a concrete before and after in the user's terms. Each round asks every question whose
   prerequisites are settled. A technical choice (a library, a mechanism, a default, a label) is
   yours: decide it from evidence and log it. Never ask what a command, the code, the ticket or a
   sensible default answers: run the probe, or decide and log the decision.
6. **Number the requirements** `R1`, `R2`… in one list, each citing its source: a quote from the
   owner's prompt, a document path and section, or `inferred`. An inferred requirement is a
   decision, logged with its reason, because the owner checks those first. The ids stay fixed for
   the run: scenarios, failure rows, tests and the report name them.

Once the owner says go, or is away, decide and log each decision. The build starts after the
design review ends and `lpk go` (`design.md` in this skill's directory says when).

**Done when** you can state, in the user's terms, who uses the change, where they meet it, the
before and the after, the bar and the platforms, and each numbered requirement with its source.
