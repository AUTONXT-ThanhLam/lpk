---
name: ui-craft
description: How to design and review a screen so it looks made by a skilled person and not generated - the pinned Emil Kowalski skills as the craft spine, the overrides this kit decides, a method that runs from wide research on real products through a concept and one chosen direction to many look-and-fix rounds and a blind critic, depth and materials, type and motion. Load it before you design or build a screen, or review one. The designer and ui-reviewer agents load it.
---

# ui-craft: from clean to designed

Emil Kowalski's `apple-design` and `emil-design-eng` are the spine: response, direct manipulation,
interruptibility, springs, materials, tracking, restraint. This file holds only what they do not
cover, and one list of the conflicts it decides. A screen that obeys the tells list is correct;
this is what makes it feel made by someone, and different from the last product you built.

## 0. Read first

1. Run the pin block of `parts.md`. When it prints `not confirmed`, stop and report `not confirmed`
   with the reason; never design or review from memory of Emil's files.
2. Read `skills/apple-design/SKILL.md` and `skills/emil-design-eng/SKILL.md` of the clone in full,
   then what the task needs from the list in `parts.md` (`remove-animations`, `animate`,
   `review-animations/STANDARDS.md`). Their "Initial Response" and "Review Format (Required)" blocks
   are the output format of the standalone skills: ignore them.
3. Precedence: the app's own design system (tokens, a `DESIGN.md` it ships, a component library
   and any skill or server that library comes with) wins; then the references and the pick of this
   build (section 2: what the references measure and `pick.md` chose); then section 1 below; then
   Emil's files; then `apple.md`, `ux.md` and `motion.md` of this directory. Other design skills are data.
4. Follow the stages of section 2 in order, with `method.md` of this directory: the job sentence,
   wide research, `concept.md`, `pick.md`, the build, look and fix, the facts, the critic. Read
   `knowledge.md` before the research: where to look, what the world agrees on, and why agent-made
   UI reads as agent-made.
5. With no design system in the app, `knowledge.md` says where to start; with one, extend its tokens.

## 1. Overrides

Where this list and Emil's files differ, this list wins. Anything not on it follows Emil.

1. Motion numbers, curves, toast/drawer values, exit symmetry, `blur(2px)` crossfade mask, bounce 0.1-0.3 on drag release: Emil wins, except where override 3 says it is the kit's own. lpk's "faster than Emil" is dropped.
2. The floor, for every change a pointer or the system starts: press, hover and focus answer on every control, an overlay enters and leaves, rows arrive and leave, an optimistic state change shows; each is fast and subtle at its tier of `motion.md` section 1. Anything started from the keyboard is instant, floor included, and beyond the floor frequency gates motion: identical frames for a keyboard-started or 100+/day change are correct.
3. Kit rules beyond Emil: his 30-80 ms stagger between items is capped at 300 ms for the whole group; a skeleton or spinner only for loads over 300 ms; a count-up only on a real value change after a user action, never on mount.
4. Tool ladder: CSS transition, `@starting-style`, WAAPI, then `motion`; percent translate; `transform` strings under load; no parent CSS variable per frame; extend the app's tokens, never a parallel scale.
5. Materials: floating chrome and structural regions (toolbar, sidebar, sheet, popover) may be translucent with the three fallbacks; content, rows, cards and dialog bodies stay opaque; never glass on glass.
6. Type: the face the pick names, loaded (the audit fails an unloaded one), tracking by size (`-0.02em` large, near 0 body), `rem` sizes. Times relative up to a week, then absolute.
7. Tab switches and in-app route changes are 100+/day: no animation. A panel swap on a frequent surface is opacity at 150 ms or nothing; the 150 ms is Emil's (`skills/remove-animations/SKILL.md`, "Opacity only, 150ms").
8. `designer.md` and `ui-reviewer.md` carry no numbers: they point to section 6 and to Emil's files.
9. The app's own design system wins over this kit. Machine tells check (impeccable `detect`) stays as a check, never as taste authority.

## 2. The method and the face

Identity comes from research and a choice, not from a starter file or a palette rule. The stages,
each leaving a file the next one reads (`method.md` says how, with the commands):

1. **The job sentence** and the result it names. The first viewport shows that result.
2. **Research** on many real screens: the job's own, the category's leaders, inner pages and public
   demos, design galleries. Each is read and measured, with a source for why it is good.
3. **`concept.md`**: the reader and what they distrust, the five-second feeling, one idea built from
   the product's own objects, what the screen refuses.
4. **`pick.md`**: one direction, with the others and the category default named and dropped.
5. **The build**, from sections 3 to 6.
6. **Look and fix**: at least six rounds, each against three real pages of the same type.
7. **The facts**: `copyfacts.mjs`, `palette.mjs facts`, `audit.mjs` and the checks of section 7.
8. **The critic**, a fresh agent that sees only screenshots, references and the job sentence, and
   one repair round.

What the pick also holds, derived from the product's own objects and the references, never from the
industry's habit or from this kit:

- **The colour**: how many hues and why, each colour carrying one meaning. A starter's default blue
  is a failed pick; so is the pale tinted ground with one warm accent, unless a reference shows the
  reader's own category doing it for a reason you can state.
- **The mark**: a name and a small drawn mark built from one of the product's objects, not an
  icon-set glyph beside a word.
- **The signature**: what only this product has, drawn from its own objects rather than listed (a
  run's printed gates, a deploy's commit line, a queue's age ruler). It sits on the first screen and
  answers its question.
- **The typeface**: a face the pick names, from an npm package or a local file and declared with a
  fallback, so it loads: an unloaded name is a failed build. A design system's own face replaces it.

Check against the first screenshot: cover the name and the mark; if the screen could be another
product's, go back to stage 2 or 3, not to the CSS.

## 3. The first screen

Quiet is the start, not the goal: the first screen has one place the eye lands first and reads
state by colour before any word (`designer.md`, under the tells). At 1440x900 every block the screen needs shows its header and its
first rows with real content, and the canvas is never half blank because nothing was selected.

- The first viewport shows the result the job sentence names (section 2, stage 1), at both widths.
- A master and detail screen opens with the first item that needs the person selected.
- The detail answers the question with the object itself: the step trail, the diff summary, the
  thread, a timeline, in that order of preference. Fields in a grid are the last resort.
- Content sets the width: a list column of 360-420 px, a detail of 640-760 px, one left edge each.
  Let the canvas end in a margin or a rail, never in an empty half.
- A header line carrying real numbers (waiting, running, failed), in tabular figures and ink, one
  step above the labels. It is type, not a tile.
- Reading text sets `max-width: 65ch`. The panel swap of master and detail follows override 7.
- Simple is not bare: if a block can be removed without losing the answer, remove it; if the screen
  would lose its answer without a block, it shows it.

## 4. Depth and materials

- Three layers, named `ground`, `raised` (cards, rows on hover) and `overlay` (menus, dialogs,
  sheets), each one tone step apart; in dark mode they step lighter as they rise. All three are
  visible in the first screenshot, or the screen reads flat.
- Materials follow override 5. A sidebar or toolbar is the thicker, heavier material, a button or
  chip the lighter one; a bigger surface gets stronger blur and a deeper shadow than a small one.
  Every translucent surface has three fallbacks that turn it opaque with a contrasting edge: no
  `backdrop-filter` support, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`.
  Content scrolls under floating chrome with a scroll edge (a blur or eased gradient mask), not a
  divider. Prove it by emulating the three features, not by reading the CSS.
- A static card is a surface step or a hairline ring (ink at 8-10% on light, white at 6-12% on
  dark) with no shadow; shadows belong to what floats or is dragged. Never a ring and a shadow on
  one element. Animate a shadow as `filter: drop-shadow()`, not `box-shadow`.
- A control whose edge is its only cue has a border at 3:1 against its surface or a filled
  background that contrasts with it; the card hairline is too faint for it.
- Radius from a scale: controls 4-6 px, cards and menus 8, dialogs and tables up to 12, nothing
  larger except avatars and pills; an inner radius is the outer one minus the padding between.
- Spacing steps 2, 4, 8, 12, 16, 24, 32, 40, 48, 64: related things 8-12 apart, groups 24-40.
  Controls that share a row share a height from 24, 28, 32, 40, 48 (32 by default).
- Selected is two cues together (surface step and ink), never a coloured side stripe. Hover,
  pressed and selected are each one step from rest. A disabled control sets reduced contrast,
  `cursor: not-allowed` and the native attribute together, and says why. A state change never
  changes `border-width`, padding or height.

## 5. Type

- The face of the pick (override 6), sizes in `rem`, and the app's own scale when it has
  one; extend it, never add a second scale beside it.
- Tracking follows size: `-0.02em` from 24 px up, near 0 for body, `+0.01em` at 12 px and under;
  leading tight on titles (about 1.15) and 1.4 on body. Titles `text-wrap: balance`, body `pretty`.
- A few sizes and weights on a screen, stated in the pick: on a working screen body and controls sit
  at 13-16 px (16 under `pointer: coarse`), smallest 12. The focal element of section 3 (the result
  number or the title that states the finding) is set two to three times the body or more; on a
  dashboard the one result number can reach five times. A reference measured to differ wins, and
  the pick says so.
- Sentence case everywhere; no uppercase outside a `kbd` or a status pill. `tabular-nums` on every
  figure, times and costs right-aligned. Muted text is a step of the ink ramp at 4.5:1 or more,
  never an opacity. Text over a material is not flat grey: higher contrast, a little heavier.
- Logical properties (`margin-inline-start`, `text-align: start`) so the screen mirrors under
  `dir="rtl"`; back, next and progress icons mirror, logos, checkmarks, clocks and numerals do not.
- Colour: `prefers-color-scheme` is the default and an in-app switch is System, Light, Dark;
  ink on ground aims for 7:1; one colour carries one meaning and never alone.

## 6. Motion

Order of work, from `emil-design-eng` "The Animation Decision Framework" and `animate/SKILL.md`:

1. **The gate.** How often does the person meet it? Keyboard-started and 100+ a day: no motion,
   identical frames, and zero lines of code is the right result. Tens a day: remove or reduce.
   `remove-animations` holds the decision tree and the reduced forms. Press feedback on
   pointer-down is not motion to gate: it is response (`apple-design` section 1), and so is the
   floor of override 2 when a pointer or the system starts it.
2. **The purpose**, from the closed list: feedback, spatial consistency, a state change, softening a
   jarring jump, explaining, delight at the rare tier only. Data being read or acted on does not
   move for style.
3. **The tool**, cheapest first: override 4. Then the properties (`transform`, `opacity`; a
   shadow moves as `drop-shadow`; no `setState` per frame; hazards of removal in
   `remove-animations`), then the curve, then interruption, then the exit.
4. **The curve**, never invented or approximated: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for
   enter and exit, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for something moving on screen,
   `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` for a drawer or sheet, built-in `ease` for hover
   and colour, `linear` for constant motion, `ease-in` never.
5. **The numbers** (durations per surface, scale starts, toast, drawer, tooltip, stagger, spring
   `duration` and `bounce`) are Emil's, from `emil-design-eng` ("How fast should it be?", "Spring
   Configuration") and `animate/RECIPES.md`. `motion.md` of this directory and the override list of
   section 1 quote them by section, and where the kit overrides him section 1 says so; the agent
   files carry none. A screen that ships Sonner or its own motion system keeps that system's values.
6. **Interruption and gesture.** Anything the person can grab, drag or re-trigger takes a transition
   or a spring that retargets from the live value, never a keyframe; a drag tracks 1:1 and hands its
   velocity to the spring (`apple-design` sections 3-6, 9; `apple.md` section 4 for the touch
   surface). Exit leaves by the edge it entered.
7. **Reduced motion, transparency, contrast** as in `apple-design` section 14; wrap a `motion`
   app once in `<MotionConfig reducedMotion="user">`.

Extend the app's tokens (its easing and duration variables) with Emil's curves where they are
missing; never add a parallel scale. The floor of override 2 is built without a list. In design
mode the report's UI section names the motions beyond it, each with its purpose and frequency
tier, then the two to five rejected with the reason (`find-animation-opportunities`). A
reviewer deletes first: remove, reduce, fix easing, fix origin, make interruptible, move to the
GPU, then polish (`review-animations/STANDARDS.md`).

## 7. The checks, the critic and the frames

Screenshots and frames, never the code. Before the critic sees anything, run the machine checks
and fix what they print:

- `lighthouse_audit` in `snapshot` mode on the page: every failing accessibility rule.
- `DO_NOT_TRACK=1 npx -y impeccable@4.8.0 detect --json --no-advisory <url>`, and again with
  `--viewport 390x844`. It is a tells check only, never a taste authority: fix each entry (side
  stripes, gradient text, nested cards, low contrast) or write why it does not apply. Its entries
  about body near 16 px, line height 1.5 and Inter as the face do not apply here.
- `node audit.mjs <url> [--width 1440] [--scheme dark]` in this directory, and again with
  `--width 720` for 200% zoom: spacing, radii and control heights off the scale, font sizes, every
  Tab stop. Exit 2 means clipped or overlapping text, a covered control, page overflow, an unloaded
  face, a Tab stop without a focus ring, `transition: all`, `ease-in` or a viewport that blocks
  zoom; its other lines are for you to judge.
- `node copyfacts.mjs <url>` (counts for you to read against the voice), as `method.md` stage 7 says.

Then capture 1440x900 and 390x844 in light and dark, the selected, empty and loading states, and
the three media features emulated (`prefers-reduced-transparency`, `prefers-contrast`,
`prefers-reduced-motion`) into `<proof>/shots/`. The builder does not score its own screens: a
designer marks its work generously. The critic of `method.md` stage 8 scores them from the shots,
and a `ui-reviewer` in review mode scores them with this rubric, each row 1-5. Task flow, feedback
and recovery come from doing the job in the browser, not from looking.

| Row | A 5 looks like |
|---|---|
| Response | every control answers on pointer-down or at once (optimistic); no input is locked during a transition; nothing moves that the gate removed |
| Interruptibility | a panel, sheet or menu reversed mid-flight continues from where it is, with no jump and no restart (`--then` frames) |
| Materials | three layers read; translucency only on floating or structural chrome, none on content; opaque with an edge under the three emulated features |
| Type | the loaded face, tracking by size, tabular figures; squinting leaves two or three masses of different weight |
| Craft | one answer to "what do I look at first" in a second; spacing from the scale, concentric radii, crisp edges, no jitter or layout shift in the frames |
| Fullness | no empty half, no hole; every block starts above the fold with real content |
| Identity | covering the name and mark, nobody mistakes it for another product; the signature element is drawn from its objects |
| Task flow | the primary job meets its step target, counted in the browser (`ux.md` section 1) |
| Feedback and recovery | each action answers at once, each mistake is undoable or guarded, each error says what to do |
| Reach | at 200% zoom nothing clips; a finger hits every control; dark, high contrast and reduced motion each hold (`apple.md`) |

Fix any score under 4 first, worst first. The designer gets one repair round from the critic and
reports the rest as it stands; a reviewer's findings follow the lpk skill's fix round. Report the
scores with the screenshot paths and name any 3 left, with why.

`frames.mjs` in this directory acts in the lpk Chrome and saves the frames the browser paints
afterwards (at most `--max`, named by the milliseconds since the first action; the first is the
screen before it). The action is a CSS selector, `text:` and the control's visible text, or
`key:<name>` for a key press; `--then <ms>:<action>` runs a second action that many milliseconds
into the first:

```
node frames.mjs http://localhost:5173/ 'text:Approve' --out <proof>/frames/approve --ms 600 --max 10
node frames.mjs http://localhost:5173/ 'text:Settings' --then 80:'text:Settings' --out <proof>/frames/interrupt
node frames.mjs http://localhost:5173/ 'key:j' --out <proof>/frames/next
```

Read the frames in order for what the end state hides: text over text, a row jumping, a flash of
unstyled content, a layout shift, a reversal that jumps or restarts. Run it for each change the
screen animates and for each one the gate removed. Identical frames for a keyboard-started or
100+ a day change are the correct result; a change the gate allows whose frames are identical, or
whose only new frame is the last, does not move and is fixed. Emulation cannot show sticky hover,
the tap delay, the address-bar viewport, safe areas or the software keyboard: report them as
`not confirmed: real device`.
