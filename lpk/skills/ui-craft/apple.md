# apple: what Apple's craft asks of a web screen

These are rules, not references: the designer builds to them, and the ui-reviewer records a
screen that breaks one as a finding. Where a rule says "aim for" or "may", that wording is the rule. Extends `SKILL.md`; the app's own design
system and `SKILL.md` win a conflict, and a choice that departs from this file is written in the
report as `shortcut:` with why. The sources are
Apple's Human Interface Guidelines (developer.apple.com/design/human-interface-guidelines, the page
named in each heading) and Emil Kowalski's `emil-design-eng` skill (MIT, pinned in `parts.md`). Both
are paraphrased here. A rule that exists only because of an Apple platform (SF fonts, Dynamic Type
styles, size classes, safe areas, sheet detents, haptics, pointer effects, clear glass, title-case
buttons) is not in this file, and the designer does not import it.

## 1. The eight questions (`design-principles`)

Ask them of every screen before the face is decided, and of the first screenshot after:

1. **Purpose.** Does it do the few things that matter, and do them well, instead of everything?
2. **Agency.** Does it take the person straight to the task, with every guided flow skippable and
   reachable later?
3. **Forgiveness.** Is every action undoable, or guarded just before it is destructive? Interrupt
   only when someone is about to make a big mistake.
4. **Familiarity.** Do things that look the same behave the same, in the same place on every screen,
   with the platform's own controls where they exist?
5. **Flexibility.** Does it work with a keyboard, a finger, a screen reader, 200% text, high
   contrast and reduced motion, with the same actions at 390 px as at 1440?
6. **Simplicity.** Is only what is necessary there, with hierarchy that says where the person is and
   what comes next? Simple is not bare: `SKILL.md` section 2 still fills the first screen.
7. **Craft.** Nothing that makes the person wait for no reason, no jitter, no misaligned icon, no
   layout that breaks at another size.
8. **Delight.** Name the feeling the screen should leave; it comes from the whole, never from
   decoration. A one-shot moment for a rare success is allowed; a loop never is.

## 2. Hierarchy, layout and type (`layout`, `typography`)

- The most important content sits top and leading. Related things share space; groups are
  separated by space, then a hairline, then a surface step, in that order of preference.
- Progressive disclosure: the primary things show, secondary detail is one low-effort step away.
- Type sizes are in `rem` so the browser's text size reaches them. At 200% zoom (`audit.mjs
  --width 720` on a 1440 design) nothing is clipped or overlapping, horizontally adjacent items stack
  and rows grow. The scale of `SKILL.md` section 4 is the macOS scale (13/16 body, 12 smallest), so it
  fits a desktop tool; a touch-first app raises body to 16.
- Weights under 400 are out. Few typefaces: the loaded face is the first in the stack and `system-ui`
  is only the last fallback, shown until the face loads.
- Use logical properties (`margin-inline-start`, `inset-inline-end`, `text-align: start`) so the
  screen mirrors under `dir="rtl"`; direction-bearing icons (back, next, progress) mirror, logos,
  photos, checkmarks, clocks and numerals do not.

## 3. Colour and mode (`color`, `dark-mode`)

- The system's mode is the default: `prefers-color-scheme`. An in-app switch is System, Light, Dark
  with System selected; never a switch alone.
- Dark is dimmer, not inverted: the base is darker, the raised layer lighter. Soften white images.
- Ink on ground aims for 7:1; no text under 4.5:1 unless it is 24 px regular or 18.66 px bold (3:1),
  which is WCAG's measure and not Apple's point table. Supply the `prefers-contrast: more` variant of
  each token, even if only the hairlines and muted ink step up.
- One colour carries one meaning, and colour is never the only channel (text, an icon or a shape
  says it too).

## 4. Materials (`materials`, Liquid Glass overviews)

Apple's rule: the translucent layer is for controls and navigation floating above content, used
sparingly, never on the content itself, never glass on glass. On the web:

- The default layer is opaque (`SKILL.md` section 3). A sticky header or floating toolbar over
  scrolling content may blur what is behind it (`backdrop-filter: blur(12px) saturate(1.2)` on a
  token colour at 70-80% opacity), because the content moving under it is the reason.
- Its fallback is the opaque token colour, set when `@supports (backdrop-filter: blur(1px))` fails
  or under `prefers-reduced-transparency: reduce` and `prefers-contrast: more`.
- Never on a card, row, panel, dialog body or anything holding text over varied content. No glow, no
  tint, no specular highlight, no gradient edge.
- Concentric radii: an inner radius is the outer radius minus the padding between them.

## 5. Controls and input (`accessibility`, `buttons`, `pointing-devices`)

- Pointer targets are at least 24 px (WCAG 2.5.8) and 32 by default. Under `@media (pointer: coarse)`
  the hit area is 44 px, grown with padding or a pseudo-element so the drawn control keeps its size,
  and 12 px apart (24 px for bare icons).
- Every custom button has a pressed state and a visible keyboard focus.
- One prominent button per region marks the likely action, by style and not by size; a destructive
  action never wears it. Button labels are verbs; "OK" is only for information; cancel says Cancel.
- Hover animates only under `@media (hover: hover) and (pointer: fine)`, because a finger fires hover
  on tap and a hybrid laptop reports a mouse. Hover has a purpose; a row does not scale or lift.
- Frequent actions use the simplest gesture and have a plain alternative to any complex one. Never
  override a system shortcut.
- A time-boxed element (a toast) never holds an error or anything the person must act on; an error
  stays until dismissed or fixed.

## 6. Patterns (`feedback`, `alerts`, `modality`, `popovers`, `menus`, `progress-indicators`, `onboarding`, `undo-and-redo`, `writing`)

- **Feedback** is as loud as it matters: status inline by the item, a dialog only for data loss or a
  critical, actionable fact. Confirm only what is significant or irreversible, and name the
  consequence ("Delete 3 runs"). A command that cannot run says why.
- **Dialog**: at most one, a title that says what happened or what will, at most two lines, at most
  three buttons, the default last or trailing, Esc closes. Never for information alone, never at
  load, never for an action that can be undone instead.
- **Modal and sheet**: only when focus on a scoped task has a clear benefit; short, titled with the
  task, one way out that is obvious, a confirmation before closing loses work, one open at a time.
  Done pairs with Cancel or Back, never all three.
- **Popover**: a few related things, one at a time, no popover from a popover, no warning inside one.
  On a narrow viewport it becomes a bottom sheet.
- **Menu**: verb labels, important items first, groups by separator, an ellipsis when more input is
  needed, a disabled item stays visible, icons on all items of a group or none, submenus one level
  and about five items.
- **Progress**: show something at once; determinate when the size is known, paced evenly; never
  switch a spinner to a bar; describe the task ("Importing 4 files"), not "Loading"; Cancel where
  safe, and a confirmation when cancelling loses progress.
- **Onboarding**: teach by doing, tips in context, skippable and findable later, setup postponed
  with sensible defaults, permissions asked at the moment of need with the reason.
- **Undo** names its result ("Undo move") and shows it; batch revert where people change many things.
- **Empty state**: one clear next step as a button or link. **Error**: next to the problem, no blame,
  no "oops", no "Error" title, and the fix ("Use at least 8 characters").
- **Settings**: defaults that serve most people, few options, nothing that can be detected, nothing
  that duplicates the system's setting, task options inside the task.
- **Copy**: "you", never "the user"; define a technical term once; no idiom or joke.

## 7. Motion (`motion` page, Emil Kowalski)

Apple gives no durations; the numbers come from `SKILL.md` section 5 and `motion.md`. The rules both
sources add:

- Decide first whether it moves (`motion.md` section 1): frequent and keyboard-started actions do not.
- Easing: entering and exiting use ease-out, a thing moving on screen uses ease-in-out
  (`cubic-bezier(0.77, 0, 0.175, 1)`), hover and colour use `ease`, constant motion is linear, and
  ease-in is never used on UI. A drawer or sheet uses 240 ms in and 150 ms out on
  `cubic-bezier(0.32, 0.72, 0, 1)`.
- Press is `scale(0.97)` in 100-160 ms; entry never starts at `scale(0)`. Asymmetric time is a
  feature: slow where the person decides (a hold-to-delete fills over 2 s, linear), fast where the
  system answers (200 ms on release).
- A spring is for a gesture the person can interrupt, with its velocity carried over; on a working
  screen it is `bounce: 0`. Bounce appears only on a drag release in a playful product.
- Dragging dismisses by velocity, not distance alone: a release faster than about 0.11 px per ms
  dismisses; at a boundary it resists instead of stopping; pointer capture holds the drag; extra
  touches mid-drag are ignored.
- Transform and opacity only. Animations that start while the page loads are CSS transitions with
  `@starting-style`, because JS animation drops frames then; `motion` is for layout and gesture.
- Under `prefers-reduced-motion: reduce` motion becomes fewer and gentler, not none: opacity and
  colour stay; translation, scale, zoom, depth and parallax become a fade; springs lose their
  bounce; auto-playing and repeating motion stops. Avoid animating into or out of a blur; if a
  crossfade needs one after easing and time are tuned, it is `blur(2px)` at most and absent here.
- Review in slow motion: `frames.mjs`, then the same run at 2-5x slower in the browser's animation
  panel, then again the next day with fresh eyes.
