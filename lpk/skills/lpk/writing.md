# Writing for the people and agents who read lpk's text

Read this before you write a Design Brief, a finding, a commit message, a PR body or the report.
Three readers meet this text: the owner, who reads English as a second language; the tech lead;
and agents, who act on each word. Each rule carries its reason, because a reader who knows why
handles the case the rule did not name.

1. Keep sentences short: about 20 words for an instruction and 25 for a description. A long
   sentence hides its second idea.
2. Write one instruction per sentence, and number the steps. A reader does the first instruction
   in a sentence and loses the second.
3. Put one fact on each line of a list or a table. A reader scans the start of each line.
4. Use the active voice and name the actor: "the verifier dropped it", not "it was dropped". The
   reader needs to know who did it, and who will do it next.
5. Use one word for one thing, and use its real name: the symbol, the file, the command. Two names
   make a reader look for two things.
6. Keep the articles, the subjects and the verbs. Fragments and arrows save words and cost the
   reader a guess.
7. Give the reason with each rule, choice and decision, in one clause.
8. Tag each claim with how you know it: `[ran]` with the command and its real output, `[read]`
   with `file:line`, or `[inferred]`. In a Vietnamese report the tags are `[đã chạy]`, `[đọc code]`
   and `[suy luận]`. An untagged claim reads as a guess.

In Vietnamese, keep the same principles without the word count: each Vietnamese word is one
syllable, so an English count does not apply. Code, paths, commands, identifiers and quoted output
stay exactly as they are, in every language.
