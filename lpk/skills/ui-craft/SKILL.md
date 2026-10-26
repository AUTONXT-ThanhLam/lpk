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

The bar is the best SaaS products (Linear, Vercel, Raycast, Stripe, Mercury, Notion, Figma, Arc,
Attio, Clerk, Resend), and the owner may have no words for it: you carry the judgement. Read
`benchmarks.md` and `ux.md` in this skill's directory. Then open two live pages from
`benchmarks.md` that sit closest to the screen's kind in the lpk Chrome, screenshot each product
screen into the proof directory, and write three moves you take from them (a type setting, a row
anatomy, a motion, a keyboard behaviour), each with the measured value. A screen designed without
having looked at the references is the average of every screen.

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
- One shadow token per layer, soft and low (`0 1px 2px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .06)`
  on `raised`), never together with a border on the same element: choose the line or the shadow.
- A 1px inner highlight (`inset 0 1px 0 rgb(255 255 255 / .06)`) on dark `raised` surfaces; a ring
  at 8-10% ink on light.
- Radius from a scale of three (6, 10, 14), the smaller one on anything nested inside the larger.
- Spacing on a 4 px base, using 8, 12, 16, 24, 40: related things 8-12 apart, groups 24-40.
- Selected means two things at once (surface step and ink), never a coloured side stripe.

## 4. Type that carries the hierarchy

- Three sizes (13, 15, 22 or 28), two weights (450 and 600). Titles get `letter-spacing: -0.01em` and
  `text-wrap: balance`; body `text-wrap: pretty`.
- `font-variant-numeric: tabular-nums` on every figure, times and costs right-aligned.
- Muted text is a step of the ink ramp (at least 4.5:1), never an opacity.

## 5. Motion that explains

Use the `motion` package (`import { motion, AnimatePresence, MotionConfig } from "motion/react"`).
Wrap the app once in `<MotionConfig reducedMotion="user">` so every transform respects the setting.
One entrance per view, none on rows of a long list. These are the recipes; use the ones the screen's
real changes need and no others.

```tsx
const ease = [0.22, 1, 0.36, 1] as const

<motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }} />

<motion.span aria-hidden initial={false} animate={{ opacity: selected ? 1 : 0 }} transition={{ duration: 0.15 }} className="absolute inset-0 rounded-[10px] bg-raised" />

<AnimatePresence mode="popLayout" initial={false}>
  <motion.section key={run.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }} />
</AnimatePresence>

<motion.button whileTap={{ scale: 0.97 }} transition={{ duration: 0.12 }} />
```

- **List change** (an item arrives, resolves, is removed): `layout` on the items inside
  `AnimatePresence`, the resolved item fading and collapsing its height, the ones below sliding up.
- **Selection**: each row owns its highlight and crossfades it in 150 ms. A shared `layoutId`
  highlight glides only between rows of the same height; when a row can expand (a question, a
  form) the sheet resizes over the text of its neighbours.
- **Panel swap**: crossfade with an 8 px shift in the direction of travel, 180 ms.
- **Press**: `scale(0.97)` in 120 ms. Hover is `transition-colors` at 150 ms behind
  `@media (hover: hover)`, one small response for every control.
- **Status change**: the dot or label crossfades colour in 200 ms; a running item has a spinner
  that turns, nothing pulses.
- **Figures that change after load**: roll or crossfade the digit, 300 ms, never on first paint.
- **Loading to content**: skeleton blocks of the final shape, then a 200 ms opacity swap with no
  layout shift.
- **Where**: transform and opacity only, 120-240 ms, `ease` above or a spring with damping that
  settles without overshoot. No bounce, no stagger above eight items, no looping decoration.

## 6. The look-and-fix loop

Screenshots only, never the code. After the first build, capture 1440x900 and 390x844 in light and
dark, and the selected, empty and loading states. Score each 1-5 and write the scores down. The last three come from doing the job in the browser, not from looking:

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
