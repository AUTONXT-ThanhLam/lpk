# motion: tokens, recipes and the cost of moving

Extends section 6 of `SKILL.md`; `apple.md` section 4 holds the gesture-surface table. The values are
Emil Kowalski's, from `skills/animate/RECIPES.md`, `skills/review-animations/STANDARDS.md` and
`skills/emil-design-eng` in the pinned clone; read them there and quote nothing from here as a replacement for them. The
app's own system wins where it speaks: extend its tokens, never add a parallel scale.

## 1. First decide whether it moves at all

| How often a person meets it | Decision |
|---|---|
| Hundreds of times a day, or started from the keyboard (shortcut, palette toggle, arrow keys in a list) | No animation. It appears and disappears in the same frame |
| Dozens of times a day (hover, list navigation, menu open) | Near imperceptible: fast and subtle, or nothing |
| Occasional (dialog, drawer, toast, popover on a detail) | The recipes below |
| Rare or first time (onboarding, success, celebration) | The delight budget lives here |

- Tab switches and in-app route changes are hundreds a day: they do not animate. A panel swap on a
  frequent surface is an opacity change at 150 ms, or nothing.
- A screen with no motion on a gated change is correct, not a finding. Zero lines of code is a
  result: animating what should not animate is the worse failure.
- Every motion that survives names its purpose from this list only: feedback to an action, spatial
  consistency (where it came from or went), a state change, softening a jarring jump, explaining
  how something works (marketing and onboarding), or delight (rare tier only). Data a person reads
  or acts on does not move for style.
- The designer's report names the few motions it kept, each with purpose and frequency tier, and
  two to five candidates it rejected with the reason (frequency, no purpose, too slow, the data
  must stay still). When unsure, delete the motion.

## 2. Tokens and the tool ladder

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

- `--ease-out` for anything entering or exiting, and the default. `--ease-in-out` for a thing that
  moves while staying on screen (a tab indicator, a morph). `--ease-drawer` for a drawer or sheet.
  Hover and colour changes use the built-in `ease`; constant motion (a marquee, a progress fill)
  is `linear`. Built-in `ease-out` is too weak and `ease-in` is never used: it delays the moment
  the person is watching. Take a curve that is not here from a curve library, never hand-roll one.
- Walk down the ladder and stop at the first rung that fits:
  1. CSS transition: hover, press, colour, a state you toggle with a class or attribute.
  2. `@starting-style`: an entrance on mount with no JavaScript.
  3. CSS animation: a predetermined, one-shot motion that must stay smooth while the page is busy.
  4. WAAPI, `element.animate()`: JavaScript control with CSS performance and no dependency.
  5. `motion`: springs, layout animation, exit animation of an unmounted component, gesture values.
  When the app already ships a library for it (Base UI, Radix, Sonner, Vaul), its mounting and
  its own values win.
- Scale starts at 0.95 (tooltip 0.97, dialog 0.96) with opacity 0, never `scale(0)`. Translate in
  percent of the element's own size, not px.
- Name the properties in `transition`; never `transition: all`.
- Anything re-triggerable mid-flight (toasts arriving, a menu toggled twice, a tooltip hopping
  along a toolbar) uses a transition, which retargets from where it is. A keyframe restarts.
- Exit the way it entered: a toast that came in from the bottom leaves through the bottom, a panel
  from the right leaves to the right.
- Reduced motion and hover gating ship with the animation, in section 8.

## 3. Origin and press

- `transform-origin` comes from the trigger. The library supplies it as a variable: `--transform-origin`
  in Base UI, `--radix-popover-content-transform-origin`, `--radix-dropdown-menu-content-transform-origin`,
  `--radix-tooltip-content-transform-origin` and the like in Radix. The two are equal choices; use the
  one the app already ships. A dialog is exempt and stays at `center`.
- Press: `transform: scale(0.97)` on `:active` with a 160 ms `--ease-out` transition (100 to 160 ms).
  `scale()` carries the label and icons, which is what reads as a physical press. `:active` is a real
  press on touch, so it needs no hover gate; any `:hover` styling does (section 8). `.pressable` and
`.btn` in `assets/apple.css` do this.

## 4. Overlay recipes

Each recipe is one rule for both directions: the open state is the resting rule, `data-starting-style`
and `data-ending-style` (Base UI) or `@starting-style` (no library) carry the hidden state. The values
are Emil's recipes; a surface opened from the keyboard skips them (section 1).

| Surface | Origin | Hidden state | Time and curve |
|---|---|---|---|
| Popover | trigger | opacity 0, `scale(0.95)` | 200 ms `--ease-out` |
| Menu, dropdown, select | trigger | opacity 0, `scale(0.95)` | 150 ms `--ease-out` (his range is 150 to 250) |
| Tooltip | trigger | opacity 0, `scale(0.97)` | 125 ms `--ease-out`; `data-instant` is 0 ms |
| Dialog | centre | opacity 0, `scale(0.96)`; backdrop opacity only | 250 ms `--ease-out` |
| Drawer, sheet | its edge | `translateY(100%)` (`translateX` from a side) | 500 ms `--ease-drawer` |
| Toast | its edge | opacity 0, `translateY(100%)` | 400 ms `ease` |
| Accordion | top | height 0, opacity 0 | 200 ms `--ease-out` |
| Side panel | its edge | `translateX(100%)` | 500 ms `--ease-drawer`, a drag takes over |

Popover, menu and select:

```css
.popover {
  transform-origin: var(--transform-origin);
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}

.popover[data-starting-style],
.popover[data-ending-style] {
  opacity: 0;
  transform: scale(0.95);
}
```

Tooltip: the delay before the first one prevents accidental opening, and after one is open its
neighbours open at once with no animation, which makes a toolbar feel faster. Radix: `delayDuration`
500 and `skipDelayDuration` 300 on the provider; Base UI marks the neighbour `data-instant`. The
popover rule holds with 125 ms and `scale(0.97)`, plus:

```css
.tooltip[data-instant] {
  transition-duration: 0ms;
}
```

Dialog: the popover rule with `transform-origin: center`, 250 ms and `scale(0.96)`. The backdrop
fades opacity alone over the same 250 ms, so both read as one surface.

Drawer, sheet and side panel. Vaul hides a drawer at `translateY(100%)` before animating it in; a side
panel is the same on the x axis and leaves by the edge it entered. When it can be dragged, the drag sets
`transform` on the element directly and a spring settles it (section 6).

```css
.drawer {
  transform: translateY(0);
  transition: transform 500ms var(--ease-drawer);
}

.drawer[data-starting-style],
.drawer[data-ending-style] {
  transform: translateY(100%);
}
```

Toast. `ease`, slightly slower than the UI budget: Sonner reads as elegant partly because its motion is
tuned to its character. It enters at `translateY(100%)` and leaves the same way. When toasts stack and
the list reflows, opacity works against the height change: no formula, tune it, look again the next day.
Where `@starting-style` is missing, set a `data-mounted` attribute in an effect and switch on it.

```css
.toast {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 400ms ease,
    transform 400ms ease;

  @starting-style {
    opacity: 0;
    transform: translateY(100%);
  }
}
```

The leaving toast takes the same hidden state through your removal attribute.

Accordion. One of the few motions that costs layout every frame, so it stays short. Animate to a
measured height, not to `auto`: Radix supplies `--radix-accordion-content-height`, Base UI
`--accordion-panel-height`.

```css
.accordion-content {
  overflow: hidden;
  height: var(--accordion-panel-height);
  transition: height 200ms var(--ease-out), opacity 200ms var(--ease-out);
}

.accordion-content[data-starting-style],
.accordion-content[data-ending-style] {
  height: 0;
  opacity: 0;
}
```

No library: `assets/apple.css` carries the same hidden states as `@starting-style` helpers
(`enter-pop`, `enter-menu`, `enter-tooltip`, `enter-dialog`, `enter-toast`, `enter-drawer`,
`enter-panel`). On a native `[popover]` or `dialog`, add `display` and `overlay` to the transition
with `allow-discrete` so `display` waits for the exit.

## 5. Crossfades, stagger and hold to confirm

- A crossfade that still shows two overlapping states after easing and time are tuned gets a seam
  mask: `filter: blur(2px)` with opacity 0.7 for 200 ms while it changes, so the eye reads one thing
  changing. Blur stays under 20 px; it is expensive, Safari most of all. Tune easing and time first.
- A glass surface arriving animates its blur radius and its scale together, so it reads as a material
  arriving, not an opacity fade. Keep the radius under 20 px.
- Stagger a group entrance only for a list or grid seen occasionally, never one scrolled past all
  day, and never as a block on interaction. At most 30 ms between items, or 300 ms for the whole
  group: past that, fade the group as one. A one-shot keyframe is right here, since the group cannot
  be re-triggered mid-flight.

```css
.stagger > * {
  opacity: 0;
  transform: translateY(8px);
  animation: rise 300ms var(--ease-out) forwards;
  animation-delay: calc(min(var(--i, 0), 10) * 30ms);
}

@keyframes rise { to { opacity: 1; transform: translateY(0); } }
```

- Asymmetric timing where the person is deciding: a hold-to-confirm fill is `clip-path: inset(0 100% 0 0)`
  that goes to `inset(0 0 0 0)` over 2 s `linear` while pressed (progress does not ease) and snaps back
  in 200 ms `--ease-out` on release, with the button at `scale(0.97)`.
- A tab indicator that must change colour with its tab: duplicate the tab list, style the copy as the
  active state, clip it to the active tab and animate `clip-path` over 250 ms `--ease-in-out`. Text
  and background change together because one element is revealed.
- A scroll reveal is for a marketing surface only, fired once with `clip-path` over 600 ms
  `--ease-in-out`; functional UI someone visits daily does not get one.

## 6. Springs and gestures

- A spring is for drag with momentum, an element that should feel alive, a gesture the person can
  interrupt or reverse. It carries velocity through an interruption; a keyframe restarts from zero.
- Write it as `{ type: "spring", duration, bounce }`. `bounce: 0` is the default for UI that was not
  thrown: `{ duration: 0.4, bounce: 0 }` (critically damped, Apple's response 0.3 to 0.4). Bounce
  0.1 to 0.3 only when the gesture carried momentum, a release or a flick, and in a playful product:
  `{ duration: 0.5, bounce: 0.2 }` is Emil's value. A menu or dialog that merely faded in never bounces.
- Drag sets `transform` on the dragged element directly, with pointer capture, ignoring a second touch,
  damping past an edge and the grab offset kept. Dismiss when distance over elapsed ms passes 0.11
  (a flick is enough), not only a distance. Hand the release velocity to the spring: the projection and
  velocity handoff are in `apple-design` sections 2, 5, 6 and 9 and the gesture section of `emil-design-eng`.
- `motion` components: the `x`, `y` and `scale` shorthands run through variables and are not
  accelerated. Under load animate the full string, `transform: "translateX(100px)"`.
- `<MotionConfig reducedMotion="user">` once at the root drops transform motion and keeps opacity.
  A library that mounts the panel takes its `forceMount` prop so `AnimatePresence` can hold it
  through the exit.

## 7. What fails

- `scale(0)` start: the panel pops out of a dot. Start at 0.95.
- `transition: all`: it animates properties nobody meant.
- Animating `width`, `height`, `top`, `left`, `margin` or `padding`: layout work every frame.
  Height is tolerated for an accordion, which has no transform equivalent, and nowhere else.
- A menu, palette or tab that plays an entrance for someone who uses it constantly, or when a key
  opened it.
- A keyframe `slideIn` on a toast or tooltip that can arrive twice in a row: it snaps back to the start.
- `ease-in` on an entrance, or the built-in `ease-out` on a deliberate one.
- A transform origin at `center` on a popover tied to a trigger.
- A toast that enters from the bottom and leaves by fading in place.
- A bounce on a menu or dialog, or a UI duration past 300 ms with no reason (a drawer, sheet and
  toast are the reasons Emil gives).
- Hover motion with no `(hover: hover) and (pointer: fine)` gate.
- Reduced motion that removes the fade too. Keep the opacity.
- Judging it from the end state. Record frames with `frames.mjs` (`SKILL.md` section 7): a keyboard
  or hundreds-a-day change showing identical frames is correct. Check the origin, that backdrop and
  panel move together, and that two quick toggles do not jump (`--then`).

## 8. Reduced motion and hover

Reduced motion means fewer and gentler, not none: keep opacity and colour changes that aid
comprehension, drop transform and position movement, drop bounce.

```css
@media (prefers-reduced-motion: reduce) {
  .popover, .dialog, .drawer, .toast {
    transform: none;
    transition-property: opacity;
    transition-duration: 200ms;
  }
}
```

Hover motion sits inside `@media (hover: hover) and (pointer: fine)`: touch fires false hovers on tap.
`assets/apple.css` ships the same blocks for its own classes. For `motion`, `useReducedMotion()`
returns the flag to zero the offsets (`const closedX = reduce ? 0 : "-100%"`).

## 9. What moves cheaply

- Composite, cheap: `transform`, `opacity`, and in current Chrome and Firefox `filter`,
  `clip-path` and `background-color`. Paint, costly: `box-shadow`, `border-radius`, `color`.
  Layout, costliest: `width`, `height`, `padding`, `margin`, `top`, `left`, `border-width`. Swap a
  size change for `scale()`, a position change for `translate()`, and `display` or `visibility`
  for `opacity`.
- A shadow that changes (a lift on press, a card that rises) is `box-shadow` and repaints every
  frame. Put `filter: drop-shadow()` on the moving element instead, or keep the final shadow on a
  pseudo-element and animate its `opacity`. `drop-shadow` follows the element's alpha shape.
- `clip-path` is the property for a reveal, a hold-to-confirm fill and a before and after slider.
- The frame budget is 16.7 ms at 60 Hz and 8 ms at 120 Hz; layout on a busy page can pass 100 ms.
  Check a janky motion on a mid-range phone, because CPU throttling on a desktop does not model a
  weak GPU.
- JavaScript-driven motion runs on the main thread: a `motion` component animating `x`, `y` or
  `scale` drops frames while the page loads, hydrates or navigates. Motion that plays then is CSS
  (`@starting-style`) or a `transform` string. Vercel's dashboard tab indicator dropped frames while
  the next page loaded and was fixed by moving it to CSS; a `layoutId` indicator never animates
  during a route change or load.
- Never `setState` per frame. Write `ref.current.style.transform` or a motion value. A custom
  property set on a parent restyles every descendant on each change: set `transform` on the moving
  element instead when a drag slows as the list grows.
- `will-change` goes on one element after a 1 px shift or measured drops, never on `*` or a large
  container.
- When a motion janks, check in this order: the animated properties, a busy main thread, a React
  re-render per frame, growth with content, an animated custom property, a blur above 20 px,
  `will-change` last. Confirm in the browser's Performance and Animations panels. Report each as
  element, `file:line`, cause, before, after and how it was verified.
