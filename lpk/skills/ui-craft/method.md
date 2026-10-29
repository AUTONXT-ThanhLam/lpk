# method: from the job to a screen a person would not call generated

`SKILL.md` section 2 names the stages; this file is how each is done. Each stage leaves a file the
next one reads, in the proof directory the lead names (`<proof>` below; a directory under the system
temp directory when there is none): `research/` (notes, `concept.md`, `pick.md`, `rounds.md`),
`refs/` (the reference screenshots) and `shots/` (the build's screenshots). Design mode runs stages
1 to 4, build mode stages 5 to 7, and the lead runs stage 8 with a fresh agent.

No palette, type pairing, accent count, layout or mood is handed down here. Each follows from the
references and the reader of this product, and the pick says why. A build that looks like your last
one, or like the default of its category, needs a reason in `pick.md` or it is the rut.

## 1. The job sentence

One sentence with a verb and the person's own words: "Time this V60 brew and tell me when to pour."
Then the **result it names**: the one fact or object that finishes the sentence. The first viewport
at 1440x900 and at 390x844 shows that result without a click or a scroll.

## 2. Research: many real screens, not three homepages

Open real pages in the lpk Chrome (`new_page`, a fresh isolated context, closed when you are done)
and save screenshots as `<proof>/refs/<n>-<product>-<page type>.png`. `knowledge.md` says where to
look and what the world already agrees on; this stage is yours to do at the depth the job needs.

- Look at the screen's own job and at the leaders of the category, and beyond a home page: the
  page types your screen is made of (pricing, docs, a list, a detail, settings, an empty or error
  state, a dashboard, a changelog), public demos, and design galleries.
- A product team's own live page, a public demo or a shipped screenshot outranks a concept shot,
  which no team had to make work. Say which kind each reference is.
- Read each one. Measure what you can (`sample.mjs <image>` for colours, `get_css_styles` for type
  sizes, row heights and spacing) and write why it is good with a source beside it: an award, a
  juror or a critic with its URL where one exists, never your taste alone. What you take from a
  reference is a measurement or a structure, never "the vibe".
- A page that needs a sign-in is skipped and listed as skipped; never write a reference you did not
  open.

## 3. `concept.md`

- The reader: who meets this, what they already believe, what they distrust.
- What they should feel in five seconds.
- One idea that belongs to this product, built from its own real objects (what it makes, what it
  prints, what it checks), shown rather than asserted.
- What the screen refuses: the invented numbers, logos, quotes, decoration and template parts you
  will not use, and why.

## 4. `pick.md`

Choose one direction and write why. Name the directions you considered and dropped, including the
default of the category, and say what each would have cost this reader. Several directions are
offered only when the owner asked for a choice, as full-size screens that differ on one named axis.

## 5. Build

Build from the pick with the app's own design system when it has one, else from `knowledge.md`'s
starting from nothing. Real content and real objects; typefaces from an npm package or a local file,
never a CDN, so they render; motion earned by `SKILL.md` section 6. Facts about the product come
from the product's own files and output, and every claim is checked against its source before the
build is reported.

## 6. Look and fix

After each build step, take screenshots at 1440x900 and 390x844 (both colour schemes when the app
has both), lay them next to three real pages of the same type from `refs/`, and fix everything a
person would call plain, cheap, crowded, misaligned, generic or template-like. At least six rounds
for a page or a set of screens (fewer is a `shortcut:` in the report); each is a line in
`research/rounds.md`: what you saw, what you changed. Spend your effort on the looking: a round that
changes nothing means you did not look hard enough.

## 7. Facts, then screenshots for the critic

Run, on the built page, each at 1440 and 390 and in both schemes where the app has both:

- `node copyfacts.mjs <url>`: counts of em dashes, exclamation marks, title case, long and generic
  button labels and hype words. It never fails: read the counts against the voice you chose and fix
  what you would not have written.
- `node palette.mjs facts <ground> <text>...` for every text and state colour: body text and every
  meaningful state reach 4.5:1.
- `node audit.mjs <url>` and the other checks of `SKILL.md` section 7.
- No horizontal scroll at 390, keyboard alone, reduced motion, and, for a static page, no script.

Then capture the screenshots the critic will see, named `<state>-<width>-<scheme>.png`, into
`<proof>/shots/`. The critic never sees your notes: what a screenshot does not show does not exist.

## 8. The critic, and one repair round

The lead starts a fresh `lpk:ui-reviewer` in critic mode and gives it only `<proof>/shots/`,
`<proof>/refs/`, and the job sentence with its result line. Not `research/`, not the code, not this
file. It scores five rows and names at most three problems, each as a screenshot and what to change
(`agents/ui-reviewer.md`). Two builds of one brief are compared pairwise: the screenshot sets are
shown as X and Y, the critic runs twice with the labels swapped, and the verdict stands only when
both orders agree.

The designer then gets the problems as its contract: one repair round, one commit. A second round
is not run; what remains is reported with the critic's words. A problem the designer disagrees with
is `contested:` with the screenshot that shows why, never silently skipped.
