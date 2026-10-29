# refs: from the job to a plan, and a critic who has not seen either

`SKILL.md` section 2 names the stages; this file is how each is done. Each stage writes a file the
next one reads, in the proof directory the lead names (`<proof>` below; a directory under the
system temp directory when there is none). Design mode runs stages 1 to 3, build mode stages 4 to 5,
and the lead runs stage 6 with a fresh agent.

## 1. The job sentence

One sentence with a verb and the person's own words: "Time this V60 brew and tell me when to pour."
Then the **result it names**: the one fact or object that finishes the sentence ("the countdown to
the next pour"). The first viewport at 1440x900 and at 390x844 shows that result without a click or
a scroll. A screen that opens on a heading, a list of options or a tile row first fails here, before
any colour is chosen. Save both lines as the head of `<proof>/DESIGN.md`.

## 2. Three references, two sources

Pick three products that do the same job (a brew timer, not "a SaaS dashboard"), from at least two
of these sources. A reference of the right job in an ugly or dated style still teaches the job.

- **Store listings**: `curl -s "https://itunes.apple.com/search?term=<job words>&entity=software&limit=8"`
  returns `trackName`, `screenshotUrls`, `averageUserRating` and `userRatingCount`; prefer the
  well-rated ones. Apple's own apps (Weather, Clock, Notes, Reminders, Wallet) are always eligible.
- **Pattern and shot libraries that need no login**: `styles.refero.design`, `component.gallery`,
  `recent.design`, the product's own marketing page. Mobbin and Refero search ask for a login: skip
  them and say so.
- **Live pages** of competitors in the lpk Chrome (`new_page`, `take_screenshot`).

A source that does not answer is `refs not confirmed: <source>`: name it and use another; with fewer
than two sources working, stop and report it. Never write a reference you did not open.

For each reference save its screenshots as `<proof>/refs/<n>-<name>.png` (download a store image
with `curl -sL -o`, so the critic can be given the file), run `node sample.mjs <image> --top 12` in this directory, and write four
lines: the colours the measurement shows (ground, ink, the one accent and its share), the type size
and weight of the key figure, how the first screen shows the job's result, and the one thing you
will not copy. What is taken is a measurement or a structure, never "the vibe".

## 3. `DESIGN.md`, the plan

Written before the first component, under `<proof>`, never over a `DESIGN.md` the app already
has. Colours are generated from the references, not picked by eye:

```
node palette.mjs make --accent '#<the reference accent you take>' [--neutral-hue <deg>]
node palette.mjs facts '<ground>' '<ink>' '<muted ink>' '<accent text>'
```

`make` prints a 12-step neutral ramp per scheme (one tinted family, so the ground, raised, overlay,
ring and ink steps agree, tinted with the accent's hue unless `--neutral-hue` says otherwise) and
an accent set generated from the hue of `--accent` (or `--hue`) alone: its lightness and chroma
are the kit's, not the reference's. To keep the reference's exact accent, write that colour in
`DESIGN.md` yourself and check it with `facts`. The accent text colour passes AA on its own tints;
`facts` prints each
colour's OKLCH and the WCAG and APCA contrast of each later colour on the first. Contrast under AA
for body text, or a neutral ramp of two hues, is fixed here.

```
---
name: <Product>
colors:
  ground: "#..."       # reference 1
  raised: "#..."       # the same ramp, one step up
  ink: "#..."
  ink-muted: "#..."
  accent: "#..."       # reference 2
  accent-text: "#..."
  dark-ground: "#..."  # the dark scheme follows in the same list
typography:
  body: { fontFamily: Inter, fontSize: 14px, fontWeight: 450 }
  figure: { fontFamily: Inter, fontSize: 56px, fontWeight: 600 }
rounded:
  md: 8px
spacing:
  md: 12px
---

# <Product>

Job: <the sentence>. Result shown first: <the fact>.

## References
1. <name>, <source and url>: took <measured thing>; not copying <thing>.
2. ...  3. ...

## Voice
Verbs on buttons, three words at most, in sentence case; an error says what happened and what to
do next; the seed data is the kind a real user keeps (real names, plausible times, one awkward
long value); no exclamation marks or em dashes.

## Signature
The one element only this product has, drawn from its own objects, and the first screen it sits on.

## Motion
The few motions it earns, each with purpose and frequency tier, then the ones rejected.
```

The front matter is the Google `DESIGN.md` format, so one file is both the plan and the input of
the checks. `primary` is not required here: name the accent `accent`.

A colour with no reference beside it is a colour with no reason: remove it or find the reference.
Run `DO_NOT_TRACK=1 npx -y @google/design.md@latest lint <proof>/DESIGN.md` and fix each error and
each warning other than `missing-primary` and `missing-sections`; when the network does not answer,
say `design.md lint not run`. `export --format css-vars <proof>/DESIGN.md` prints the plan's colours,
radii and spacing as custom properties to start the app's token sheet from.

## 4. Build

Sections 3 to 6 of `SKILL.md` apply. The tokens come from the front matter of `DESIGN.md` and nowhere else,
and the seed data and every string follow `## Voice`.

## 5. Facts, then screenshots for the critic

Run, on the built page, each at 1440 and 390 wide and in both schemes where the app has both:

- `node copyfacts.mjs <url>`: prints counts of em dashes, exclamation marks, title case, long and
  generic button labels and hype words. It never fails: read the count and the samples against
  `## Voice` and fix what you would not have written.
- `node audit.mjs <url>` and the other checks of `SKILL.md` section 7.

Then capture the screenshots the critic will see, named `<state>-<width>-<scheme>.png`, into
`<proof>/shots/`. The critic never sees your notes: what the screenshot does not show does not
exist.

## 6. The critic, and one repair round

The lead starts a fresh `lpk:ui-reviewer` in critic mode and gives it only: `<proof>/shots/`,
`<proof>/refs/`, and the job sentence with its result line. Not `DESIGN.md`, not the code, not
this file. It scores five rows and names at most three problems, each as a screenshot and what to
change (`agents/ui-reviewer.md`). Two builds of one brief are compared pairwise: the screenshot
sets are shown as X and Y, the critic runs twice with the labels swapped, and the verdict stands
only when both orders agree.

The designer then gets the problems as its contract: one repair round, one commit. A second round
is not run; what remains is reported with the critic's words. A problem the designer disagrees
with is `contested:` with the screenshot that shows why, never silently skipped.
