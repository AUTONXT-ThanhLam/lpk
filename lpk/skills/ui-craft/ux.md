# ux: the job, not the screen

A screen can look like Linear and still be hard to use. The people this serves do not read
design vocabulary and will not tell you what is wrong: they stop using it. Judge each screen as a
job done, then as a picture. Everything below is checked in the running app, by doing the job.

## 1. Write the job and count it

Before the first component write, in the notes: **who** (role, how often they come), **the job**
in one sentence with a verb ("decide on the run that is waiting"), and **the count**: clicks and
keystrokes from opening the app to done.

- The most frequent job takes 0-1 steps from the first screen; any other job 3 or fewer.
- After the build, do the job in the browser and count again. A count above the target is a defect,
  fixed by removing a step, not by explaining it.
- The first minute delivers value: a new person sees something real or one clear action, never a
  tour, a carousel or an empty frame with a heading.

## 2. Say what is happening, fast

- Every control answers within 100 ms: a pressed state, or the result at once (optimistic) with the
  true result following. Under a second shows nothing extra.
- Work over a second shows progress where the person is looking (in the button, in the row), never
  a screen-wide blocker: a skeleton of the final shape for a page or region, an inline indicator
  for one control. Work over ten seconds shows percent done, says what it is doing, can be
  cancelled and lets the person leave.
- Never fake progress. A figure that is stale says when it was last updated.

## 3. Make mistakes cheap

- A reversible action does it and offers Undo in a toast that stays long enough to read and
  reach, pauses on hover and focus, is reachable by keyboard and is announced (`role="status"`).
  Asking "are you sure?" is for what cannot be undone, and its button names the consequence
  ("Delete 3 runs"). A modal is for lost work, an irreversible action, missing required
  information or a wizard; a field error fixable in place or a piece of news never opens one.
- Typed input survives an error, a reload of the panel and a failed save.
- An error says what happened, what the person can do next and keeps their data; the retry is
  one click. "Something went wrong" is a defect.

## 4. Empty, first-run and zero

- An empty state holds one sentence about what will live here and the one action that fills it
  (or a way to see sample data). No illustration is needed; a clear sentence and a button is enough.
- Onboarding is a short checklist of at most five real steps with progress, shown where the work
  happens, dismissible, and gone when done.

## 5. Forms

- Labels sit above the field and never inside it. Placeholders show an example, never the label.
- Validate on blur with a specific message and an icon beside the field ("Use 8 or more
  characters"), never in a tooltip alone, never a disabled submit button that gives no reason.
  Enter submits. The first field has focus. Something entered earlier in the flow is shown, not
  asked again.
- One Save per form, labelled with a verb. Toggles and single selects save at once; text fields
  and checkbox groups save on the button; one form never mixes the two. In a dialog the buttons
  sit bottom-right, Cancel left of the action.
- Defaults are chosen so the common case needs no typing. Related fields are grouped, optional ones
  folded. Saving shows saved, saving or failed in one fixed place.

## 6. Keyboard and orientation

- Every list moves with the arrow keys; focus is always visible and returns to the trigger when a
  menu, dialog or sheet closes; Esc closes the top layer.
- An app with more than five destinations or actions has a command palette on Ctrl/Cmd+K, and
  shortcuts appear as `kbd` hints in menus and tooltips.
- The URL holds the selected item, tab and filters, so refresh, back and a shared link land in the
  same place. The person can always tell where they are and what changed since they last looked.

## 7. Scanning and copy

- Lists show one primary line and one secondary fact; status is an icon or dot plus a word, never
  colour alone. Times are relative with the exact time on hover. Figures are tabular and aligned.
- Long text is truncated with the full text on hover or in the detail, never cut in the middle of a
  sentence the person must read.
- Copy is specific and in the person's words: "3 runs failed" not "Some issues"; buttons are verbs
  ("Approve", "Send invite"); no jargon the person did not use first.

## 8. Use proven parts for the hard primitives

Hand-built dialogs, menus, comboboxes and tables break on focus, keyboard and edge cases. Take
them from the app's own kit, or the shadcn registry (`npx shadcn@latest add <name>`): dialog,
sheet, popover, dropdown menu, select and combobox, tabs, tooltip, toast (`sonner`), command
palette (`cmdk`), data table (TanStack Table), calendar (`react-day-picker`). Style them with the
app's tokens; do not rewrite their behaviour.

## 9. Tables, dashboards and messages

- A table: rows hover even when they are not clickable; the sort arrow shows on the sorted column
  and on hover elsewhere; the header stays when it scrolls and a sticky header never covers the
  focused row; a column title is one or two words; empty cells stay empty; rows select with a
  checkbox, which shows a batch bar and disables row actions; more than five toolbar actions go in
  an overflow menu; a row menu with fewer than three items is inline buttons. The loading skeleton
  has the real column widths and row height.
- A dashboard answers one question per page. Show the few figures that matter and put logs and
  detail one click away. Bars, lines and scatter carry quantity; pie and donut only when one slice
  dominates; bars sorted by value; colour never encodes magnitude alone. One status vocabulary,
  defined once and reused. Live data can be paused (WCAG 2.2.2).
- A message sits at the scope it concerns: a banner for a page or section, an inline message by
  the action or field. At most two lines, and an error always says the next step. A success that
  is visible in place needs no message.
- A tooltip never repeats its label, never holds what the task needs, and opens on keyboard focus.
  Navigation labels are keywords, an icon always comes with its label, and the main navigation and
  the primary action are always visible, never behind hover. Disclosure goes two levels deep at
  most, and the trigger says what is behind it.
- Targets are at least 24x24 px (WCAG 2.5.8).

## 10. Worst-case data

Before the browser gate, render every field, list and figure of the screen with these values at
1440 and 390 wide, and fix what breaks (text over text, a row growing past its neighbours, a figure
that shifts the layout, a control pushed out of reach).

- Names and labels: one character; 60 characters with no space; an unbroken email or URL; accents,
  Vietnamese, CJK or emoji; the initials of a one-word name.
- Counts: 0, 1, 2 (plural forms), twelve tags that need a "+8", a thousand rows, 999,999 and a
  figure in the billions.
- Missing and odd: `null`, an empty string, `NaN`, a date in the past, today and the future.
- Changing: a live figure without `tabular-nums`; every status on screen at once; the current
  person inside their own list; partial data, some fields in and some out.
- The page itself: 320 px wide, 2560 px wide, zoom at 200%, right to left, and an action that
  exists only on hover when the screen is touched.
