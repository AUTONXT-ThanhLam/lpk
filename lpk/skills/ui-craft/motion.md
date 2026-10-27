# motion: overlay recipes

Extends section 5 of `SKILL.md`. Read it when the screen has a popover, menu, dialog, toast or
tooltip. The app's own system wins where it speaks.

## 1. First decide whether it moves at all

| How often a person meets it | Decision |
|---|---|
| Hundreds of times a day, or started from the keyboard (shortcut, palette toggle, arrow keys in a list) | Does not animate. It appears and disappears in the same frame |
| Dozens of times a day (row hover, menu open, tab switch, selection) | 150 ms or less, opacity and a small scale only |
| Occasional (dialog, toast, popover on a detail) | The recipes below |

- A menu that animates on every open is a delay for someone who opens it forty times a day: a key
  press opens it with no motion, a pointer click keeps it short.
- Never animate error text, a focus ring, or a list the person scrolls past.

## 2. Values every recipe shares

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (the `ease` of `SKILL.md`), fast at the start. Never
  `ease-in` on an entrance.
- Scale starts at 0.95 (tooltip 0.97, dialog 0.96) with opacity 0, never at `scale(0)`.
- Enter 120-200 ms; exit about 60% of the enter, since the person has already moved on.
- Only `transform` and `opacity` move, each named in `transition`.
- `transform-origin` comes from the trigger. A panel placed above its trigger grows from its
  bottom edge, below from its top, to the left from its right, to the right from its left, and
  an end-aligned panel grows from the matching corner. The library supplies it as a variable
  (`--radix-popover-content-transform-origin`, `--transform-origin` in Base UI). A dialog stays
  at `center`.
- Anything re-triggerable mid-flight (toasts arriving, a menu toggled twice, a tooltip hopping
  along a toolbar) uses a transition, which retargets from where it is; a keyframe restarts.

| Surface | Origin | Scale | Enter | Exit |
|---|---|---|---|---|
| Popover | trigger | 0.95 | 160 ms | 100 ms |
| Menu, dropdown | trigger | 0.95 | 120 ms | 80 ms |
| Dialog | centre | 0.96, backdrop opacity only | 180 ms | 120 ms |
| Toast | its edge | none, 12 px slide | 200 ms | 150 ms |
| Tooltip | trigger | 0.97 | 120 ms | 80 ms |

## 3. With the `motion` package

One block covers popover, menu and tooltip: set `scale` and the timings per the table. A library
that mounts the panel needs its `forceMount` prop so `AnimatePresence` can hold it through the exit.

```tsx
import { motion, AnimatePresence, MotionConfig } from "motion/react"

const ease = [0.22, 1, 0.36, 1] as const

<AnimatePresence>
  {open && (
    <motion.div
      style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.16, ease } }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1, ease } }}
    />
  )}
</AnimatePresence>
```

```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease } }}
  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12, ease } }}
  style={{ transformOrigin: "center" }}
/>

<motion.li
  layout
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease } }}
  exit={{ opacity: 0, transition: { duration: 0.15, ease } }}
/>
```

- The first of these two is a dialog's content; its backdrop is a sibling fading opacity alone
  over the same time. The `li` is a toast in a stack: `layout` slides the others when one leaves.
- Radix `TooltipProvider` holds the delay: `delayDuration={500}` before the first tooltip and
  `skipDelayDuration={300}` so the next one along a toolbar opens at once, with `duration: 0`.
- Reduced motion: `<MotionConfig reducedMotion="user">` once at the root drops `scale` and `y`
  and keeps `opacity`.

## 4. With CSS transitions and `@starting-style`

`@starting-style` gives the entrance its first frame, and `allow-discrete` lets `display` wait
for the exit, with no JavaScript.

```css
.popover {
  transform-origin: var(--origin, top left);
  opacity: 0;
  transform: scale(0.95);
  transition:
    opacity 100ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 100ms cubic-bezier(0.22, 1, 0.36, 1),
    display 100ms allow-discrete,
    overlay 100ms allow-discrete;
}

.popover:popover-open {
  opacity: 1;
  transform: none;
  transition-duration: 160ms;
}

@starting-style {
  .popover:popover-open {
    opacity: 0;
    transform: scale(0.95);
  }
}
```

- The base rule is the exit (shorter), the open rule the enter (longer). A menu and a tooltip
  reuse it with the table's values. A dialog is the same on `dialog[open]` with
  `transform-origin: center`, and its `::backdrop` fades opacity only.
- A toast mounts from its edge: `opacity: 0; transform: translateY(12px)` inside
  `@starting-style`, with a 200 ms transition on `opacity` and `transform`.
- Where Base UI owns mounting, the same rules attach to its `[data-starting-style]` and
  `[data-ending-style]` attributes.

```css
@media (prefers-reduced-motion: reduce) {
  .popover,
  .popover:popover-open {
    transform: none;
  }
}
```

## 5. What fails

- `scale(0)` start: the panel pops out of a dot. Start at 0.95.
- `transition: all`: it animates properties nobody meant.
- Animating `width`, `height`, `top`, `left`, `margin` or `padding` of a panel: layout work every
  frame. The collapsing height of a list item is the one exception.
- A menu or palette that plays an entrance on every open for someone who opens it constantly,
  or when a key opened it.
- A keyframe `slideIn` on a toast or tooltip that can arrive twice in a row snaps back to the
  start. Use a transition.
- An exit as long as the entrance, or an entrance on `ease-in`: the screen feels late.
- A stagger on menu items, or a bouncing spring on a menu or dialog.
- Reduced motion that removes the fade too. Keep the opacity.
- Judging it from the end state. Record frames with `frames.mjs` (`SKILL.md` section 6) and check
  the origin, that backdrop and panel move together, and that two quick toggles do not jump.
