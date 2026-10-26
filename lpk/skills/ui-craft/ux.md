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
  true result following.
- Work over a second shows progress where the person is looking (in the button, in the row), never
  a screen-wide blocker. Work over ten seconds says what it is doing and lets the person leave.
- Never fake progress. A figure that is stale says when it was last updated.

## 3. Make mistakes cheap

- A reversible action does it and offers Undo in a toast for 6-8 seconds. Asking "are you sure?"
  is for what cannot be undone, and its button names the consequence ("Delete 3 runs").
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
- Validate on blur with a specific message beside the field ("Use 8 or more characters"), never a
  disabled submit button that gives no reason. Enter submits. The first field has focus.
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

## 9. How it is scored

The last three rows of the loop table in section 6 of `SKILL.md` (task flow, feedback and
recovery, clarity) are scored from doing the job in the browser with the count of section 1.
