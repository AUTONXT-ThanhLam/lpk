# apple: patterns, controls and the phone

What `apple-design` and `emil-design-eng` do not say, from Apple's Human Interface Guidelines
(developer.apple.com/design/human-interface-guidelines, the page named in each heading) translated
to the web. The designer builds to it and the ui-reviewer records a screen that breaks one as a
finding; "aim for" and "may" are the rule. The app's own design system and `SKILL.md` win a
conflict; a departure goes in the report as `shortcut:` with why. A rule that exists only because
of an Apple platform (SF fonts, Dynamic Type styles, size classes, sheet detents, haptics, pointer
effects, clear glass, title-case buttons) is not here and is not imported. Materials, type,
motion, springs and reduced motion are in Emil's files and `SKILL.md`.

## 1. Layout and reach (`layout`, `inclusion`)

- The most important content sits top and leading. Groups are separated by space first, then a
  hairline, then a surface step. The primary things show; secondary detail is one low-effort step
  away. Every guided flow is skippable and reachable later.
- The same actions exist at 390 px as at 1440, with a keyboard, a finger and a screen reader. At 200%
  zoom (`audit.mjs --width 720` on a 1440 design) nothing is clipped or overlapping, horizontally
  adjacent items stack and rows grow. A touch-first app raises body text to 16 px.
- Things that look the same behave the same and sit in the same place on every screen, with the
  platform's own control where one exists. Supply a `prefers-contrast: more` variant of each token,
  even if only the hairlines and the muted ink step up.
- Name the feeling the screen should leave (calm, certain, quick); it comes from the whole, never
  from decoration. A one-shot moment for a rare success is allowed; a loop never is.

## 2. Controls and input (`accessibility`, `buttons`, `pointing-devices`)

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

## 3. Patterns (`feedback`, `alerts`, `modality`, `popovers`, `menus`, `progress-indicators`, `onboarding`, `undo-and-redo`, `writing`)

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

## 4. The phone (`mobile-native`, read from the clone)

Emulation in the lpk Chrome does not reproduce sticky hover, the tap delay, the address-bar
viewport, safe areas or the software keyboard: a phone screen is reported `not confirmed: real
device` unless one was used. The floor, before the first component:

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover,
  interactive-widget=resizes-content">`, one `theme-color` per `prefers-color-scheme`, and
  `<meta name="color-scheme" content="light dark">`. Never `user-scalable=no` or `maximum-scale=1`
  (`audit.mjs` fails it).
- `html { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%;
  overscroll-behavior: none; }`; `contain` on inner scrollers; `touch-action: manipulation` on
  controls; `env(safe-area-inset-*, 0px)` only with `viewport-fit=cover`.
- Controls (button, tab, chip, drag handle) set `user-select: none`, `-webkit-user-select: none`
  and `-webkit-touch-callout: none`; never on `body`, because content stays selectable.
- Inputs are 16 px or larger under `@media (pointer: coarse)`; `inputmode`, `enterkeyhint`,
  `autocapitalize` and `autocorrect` match the field.
- Feedback starts on `pointerdown` or `:active`; hover is gated as in section 2; detect touch with
  `(hover)` and `(pointer)`, never the user agent.
- An app shell is `100dvh`, a hero `100svh`, never `lvh`.

Each gesture surface names which axes the element owns; the value is what the browser may still do:

| Surface | `touch-action` |
|---|---|
| Horizontal carousel or swipe row (JS drag) | `pan-y` |
| Native scroll carousel | none needed: `scroll-snap-type: x mandatory` on the track, `scroll-snap-align: start` on slides |
| Vertical sheet handle | `pan-x` |
| Custom drag, slider, drag-to-dismiss sheet | `none`, only on the element that handles every axis |
| Everything else | `manipulation` |

The drag itself (pointer capture, grab offset, release velocity into a spring, projection to a snap
point, rubber-banding, the 0.11 dismiss rule) is `apple-design` sections 2, 5, 6 and 9 and
`emil-design-eng` "Gesture and Drag Interactions": use them, do not rewrite them. Test on a real
phone: an older one, the keyboard open, landscape, the installed PWA.
