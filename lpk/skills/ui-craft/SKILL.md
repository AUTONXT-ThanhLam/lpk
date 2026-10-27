---
name: ui-craft
description: What makes a working screen look designed and easy to use instead of merely clean - benchmarks from high-end SaaS, the face of the product, depth, a loaded typeface, motion recipes, the UX of the job, and a scored look-and-fix loop. Load it before you design or build a screen, or review one, next to design-taste-frontend. The designer and ui-reviewer agents load it.
---

# ui-craft: from clean to designed

Removing the generated-UI tells makes a screen correct. It does not make it good: a screen built
from restraint rules alone comes out quiet, flat, set in the system font, with half the canvas
empty and nothing moving, and a person judging by feel calls it ugly. The tells list says what to
leave out. This file says what to put in. Each section ends in something a screenshot shows.

## 0. Study the best before you decide

The bar is the products of large, well-run companies: the best SaaS products (Linear, Vercel,
Stripe, Notion, Figma, Attio, Clerk) and the design systems of enterprise software (GitHub Primer,
Atlassian, IBM Carbon, Microsoft Fluent). The owner may have no words for it: you carry the
judgement. Calm, precise, dense where the work needs it, one restrained accent; never luxury,
editorial or showy. Read `benchmarks.md` and `ux.md` in this skill's directory. Then open two live pages from
`benchmarks.md` that sit closest to the screen's kind in the lpk Chrome, screenshot each product
screen into the proof directory, and write three moves you take from them (a type setting, a row
anatomy, a motion, a keyboard behaviour), each with the measured value.

## 1. Decide the face before any code

Write these five lines into your notes (the proof directory) and check each against the first screenshot.

1. **The question** the screen answers, in the words of the trade.
2. **The ground**: one neutral ramp tinted toward the product's world (a warm paper, a cool slate, an
   ink), never pure grey, never `#fff` on `#000`. Eight steps from ground to ink, named by job
   (`ground`, `raised`, `line`, `muted`, `ink`).
3. **The one hue**, used on the main data and on what needs the person, at 5% of the pixels or less.
   Pick it from the product, not from the default blue: write its name and its value.
4. **The typeface, really loaded**: install it (`@fontsource-variable/<name>` or the app's own) and
   import it. A system stack or an unloaded name is a failed build. Choose a body face and, when the
   screen has display-size figures or titles, a second one; the taste skill's `type.md` lists pairs.
5. **The thing only this product has**: a mark and name in the shell, and one element built from its
   own objects (a run's step trail, a deploy's commit, a queue's age), drawn rather than listed.

## 2. Fill the first screen

Quiet is the start, not the goal. At 1440x900 every block the screen needs shows its header and its
first rows, and the right half is never blank because nothing was selected.

- A master and detail screen opens with the first item that needs the person selected.
- The detail answers the question with the object itself: the run's step trail, the diff summary,
  the thread, a timeline, in that order of preference. Fields in a grid are the last resort.
- Content sets the width: a list column of 360-420 px, a detail of 640-760 px, one left edge each.
  Let the canvas end in a margin or a rail, never in an empty half.
- A header line that carries real numbers (waiting, running, failed) with the number in tabular
  figures and ink, sized one step above the labels. It is type, not a tile.

## 3. Depth without decoration

- Three layers, named: `ground`, `raised` (cards, rows on hover), `overlay` (menus, dialogs). Each is
  one tone step apart; dark mode steps go lighter as they rise.
- A static card is a surface step or a hairline ring (ink at 8-10% on light, white at 6-12% on
  dark) and carries no shadow. Shadows belong to layers that float: menus, dialogs, popovers and
  what is being dragged (`0 8px 24px rgb(0 0 0 / .08)`). Never a ring and a shadow on one element.
- A control (input, select, checkbox, segmented control) whose edge is its only cue has a border at
  3:1 against its surface (about ink at 50%) or a filled background that contrasts with it. The
  card hairline above is too faint for it (WCAG 1.4.11).
- Radius from a scale: controls 4-6 px, cards and menus 8, dialogs and tables up to 12; nothing
  larger except avatars and status pills. The smaller one sits inside the larger.
- Spacing steps of 2, 4, 8, 12, 16, 24, 32, 40, 48, 64: every padding and gap is one of them.
  Related things 8-12 apart, groups 24-40, sections of an app screen 24-48.
- Controls that share a row share a height from 24, 28, 32, 40, 48 px (32 is the default).
- Selected means two things at once (surface step and ink), never a coloured side stripe. Hover,
  pressed and selected are each one tone step from the resting state.

## 4. Type that carries the hierarchy

- Three sizes and two weights (450 and 600) on a screen. Body and controls 13-14 px with a line
  height near 1.4 (Carbon, Atlassian, Fluent and Primer all set 14/20); the smallest text 12 px;
  section headings 14-16 px at 600; a page title 20-28 px. Display sizes above 32 px are for brand
  and marketing pages. Titles get `letter-spacing: -0.01em` and `text-wrap: balance`; body
  `text-wrap: pretty`.
- Sentence case everywhere, buttons and column headers included; no uppercase outside a `kbd` or a
  status pill.
- `font-variant-numeric: tabular-nums` on every figure, times and costs right-aligned.
- Muted text is a step of the ink ramp (at least 4.5:1), never an opacity.

## 5. Motion that explains

Use the `motion` package (`import { motion, AnimatePresence, MotionConfig } from "motion/react"`)
on app screens; GSAP is for public pages. Wrap the app once in `<MotionConfig reducedMotion="user">`
so every transform respects the setting, and under reduced motion keep opacity and spinners and
drop translation and scale.
One entrance per view, none on rows of a long list. These are the recipes; use the ones the screen's
real changes need and no others.

```tsx
const ease = [0.22, 1, 0.36, 1] as const

<motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }} />

<motion.span aria-hidden initial={false} animate={{ opacity: selected ? 1 : 0 }} transition={{ duration: 0.15 }} className="absolute inset-0 rounded-[10px] bg-raised" />

<AnimatePresence mode="popLayout" initial={false}>
  <motion.section key={run.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }} />
</AnimatePresence>

```

- **List change** (an item arrives, resolves, is removed): `layout` on the items inside
  `AnimatePresence`, the resolved item fading and collapsing its height, the ones below sliding up.
- **Selection**: each row owns its highlight and crossfades it in 150 ms. A shared `layoutId`
  highlight glides only between rows of the same height; when a row can expand (a question, a
  form) the sheet resizes over the text of its neighbours.
- **Panel swap**: crossfade with an 8 px shift in the direction of travel, 180 ms.
- **Hover and press**: `transition-colors` at 150 ms or less behind `@media (hover: hover)`, one
  small response for every control. How often it happens sets the duration: motion a person
  triggers dozens of times a day (row hover, menu open, tab switch, selection) stays at 150 ms or
  less; the 180-240 ms recipes are for occasional changes.
- **Status change**: the dot or label crossfades colour in 200 ms; a running item has a spinner
  that turns, nothing pulses.
- **Figures that change after load**: roll or crossfade the digit, 300 ms, never on first paint.
- **Loading to content**: skeleton blocks of the final shape, then a 200 ms opacity swap with no
  layout shift.
- **Where**: transform and opacity only, 120-240 ms, `ease` above or a spring with damping that
  settles without overshoot. An exit is faster than its entrance. One focal motion at a time. No
  bounce, no stagger above eight items, no looping decoration, and error text is never animated.

## 6. The look-and-fix loop

Screenshots only, never the code. Before you score, run the three machine checks and fix what they
print: `lighthouse_audit` in `snapshot` mode on the page (every failing accessibility rule);
`DO_NOT_TRACK=1 npx -y impeccable@4.7.0 detect --json <url>` (exit 2 lists generated-UI tells such
as side stripes, gradient text, nested cards and low contrast: fix each, or write why it does not
apply; its entries about body text near 16 px, line height 1.5 and Inter or Geist as the face do not
apply on a working screen, where enterprise systems set 14 px on 20 px and a tool may use Inter); and `node audit.mjs <url> [--width 1440] [--scheme dark]` in this skill's directory, which
reads the live page and prints spacing, radii and control heights off the scale, the font sizes in
use, and every Tab stop (exit 2 on clipped text, a control covered by another element, overlapping
text, page overflow, a face that did not load, or a Tab stop with no focus ring). Short uppercase labels and the rest of the tells list in the agent file
still run by eye. After the first build, capture 1440x900 and 390x844 in light and
dark, and the selected, empty and loading states. Score each 1-5 and write the scores down. The last three come from doing the job in the browser, with the count of `ux.md` section 1, not from looking:

| Dimension | A 5 looks like |
|---|---|
| Focal point | one answer to "what do I look at first" within a second |
| Hierarchy | squinting leaves two or three masses of different weight |
| Identity | covering the name, nobody mistakes it for another product |
| Fullness | no empty half, no hole; every block starts above the fold |
| Depth and finish | layers read, spacing has rhythm, edges are crisp, type is the loaded face |
| Motion | each real change moves; nothing moves that did not change |
| Task flow | the primary job meets its step target, counted in the browser (`ux.md`) |
| Feedback and recovery | each action answers at once, each mistake is undoable or guarded, each error says what to do |
| Clarity | labels, buttons and messages need no explanation, and the keyboard reaches everything |

Any score under 4 is fixed first, worst first, then recaptured. Stop at three rounds or when every
score is 4 or more, and report the final scores with the screenshot paths. A 3 you left is named in the
report with why.

Motion is scored from frames, never from the code or the end state. `frames.mjs` in this skill's
directory clicks one control in the lpk Chrome and saves the frames the browser paints in the next
600 ms (at most 10, named by the milliseconds since the click; the first is the screen before it):

```
node frames.mjs http://localhost:5173/ 'text:Approve' --out <proof>/frames/approve --ms 600 --max 10
```

The selector is CSS, or `text:` and the control's visible text. Read the frames in order and look
for what the end state hides: text over text, a row jumping instead of gliding, a flash of unstyled
content, a layout shift, a change that happens in one frame. Run it for each change the screen
animates (select, approve, remove, open a panel, switch tabs), fix what it shows, and run it again.
A change whose frames after the click are all identical, or whose only new frame is the last, does not move.
