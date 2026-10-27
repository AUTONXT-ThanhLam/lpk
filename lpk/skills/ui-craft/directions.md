# directions: a new look, chosen from three

For an app with no design system, or a screen whose owner asked for a new look. An app that has a
system keeps it, and none of this runs.

A designer left to choose reaches for the same look every time: a cool grey ground, a blue accent,
Inter or Geist, a sidebar. Ten builds of one brief then come out as ten copies. The look is
therefore dealt from `directions.json` in this directory, a library of directions taken from the
design systems of real high-end products (Linear, Stripe, Mercury, Raycast, Notion and others, from
the DESIGN.md files of `VoltAgent/awesome-design-md` at the commit the library names) and the app
styles of the taste skill. Three are dealt, sketched side by side, and a person picks by eye.

## 1. Deal three

```
node deal.mjs --count 3
```

Run it from this directory; add `--theme light` or `--theme dark` when the brief or the app fixes
the scheme. The three differ in accent and in body face and, as far as the library allows, in at
least two of scheme, density, depth and shell; none of them was dealt in the last four deals on this
machine, so the next app is dealt others. Save the output as `directions.txt` in the proof
directory. Never trade a dealt direction for one you prefer. When one cannot serve the screen (a
dense terminal for a form a person fills once a year), write why in the notes and deal one more
with `--count 1`.

## 2. Look at where each comes from

For each direction open its first `look at` page in the lpk Chrome, screenshot it as
`ref-<id>.png`, and read the source file the entry names for what the entry leaves out: button
anatomy, row height, how a selected item and a focused field look. Write one line per direction:
the two or three moves you take, with their values.

## 3. Sketch the first screen in each

Build the screen's first view at 1440x900 as one HTML file per direction, `sketch-<id>/index.html`
in the proof directory, outside the checkout. Each holds the same content: the brief's real data,
with the item that needs the person. Each takes its direction whole: the ramp, the accent where its
`use` says, the faces (`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/<package>/index.css">`),
the radius, density, depth and shell, and its move. No interaction, states or motion: a sketch
answers "is this the look", and three take about fifteen turns together. Screenshot each as
`sketch-<id>.png`.

In design mode return the three with their screenshot paths, one line each on what a person would
feel using it ("quiet and exact", "warm and roomy"), and the direction ids. The lead shows the
sketches to the owner, who picks one. When the owner is away, the lead picks the sketch that scores
highest on Focal point, Hierarchy and Identity (`SKILL.md` section 6) and logs why.

## 4. Build the one picked

`deal.mjs --show <id>` prints the picked direction again. It fills the five lines of `SKILL.md`
section 1:

- the ground is its ramp, in both schemes;
- the hue is its accent, used where its `use` says; when the product has a colour of its own world
  (the green of a forest, the orange of a kiln), that hue may take the accent's place at the same
  lightness and role, written in the notes;
- the typefaces are its faces, installed from their packages;
- radius, density, depth and shell are its own, and its move is on the first screen;
- the thing only this product has (`SKILL.md` section 1, line 5) is yours.

It is a direction, not a copy. The mark, the name, the illustrations and the copy are this
product's; nothing of the source product's logo, wordmark face, imagery or text is used. Covering
the name, nobody should take the screen for the source product either. The `look at` pages of the
picked direction are the two references of `SKILL.md` section 0.

## 5. Write it down as DESIGN.md

The slice that builds the app's shell writes `DESIGN.md` at the app's root from the picked
direction; every other slice reads it and never writes it. Its format is a YAML front matter between
`---` lines (`name`, then `colors`, `typography`, `rounded` and `spacing` maps whose values are hex
colours, `{fontFamily, fontSize}` pairs and px sizes), followed by `## Overview` and `## Colors`
sections in two or three plain sentences; the overview names the direction id. Run
`npx -y @google/design.md@0.4.0 lint DESIGN.md` until it exits 0. That proves the file is well
formed and nothing more. The app's tokens and `DESIGN.md` say the same thing, and the next screen
of this app is built from them, never dealt again.
