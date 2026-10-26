# benchmarks: what the best SaaS products measure

Measured on the public pages of eleven products at 1440x900 in the lpk Chrome (October 2026).
Marketing pages show product UI built by the same teams, so these are the choices they stand
behind. Use them as defaults when the app's own design system is silent; where it speaks, it wins.
Anything you rely on and did not read here, open the live page and measure it with `get_css_styles`.

## Defaults the best share (four sites or more)

- **Neutral primary button.** Near-white or near-black fill, label in the opposite ink. The accent
  hue is kept for focus rings, status dots, chips, links and the one main data element (Linear,
  Vercel, Raycast, Figma, Clerk, Attio, Resend). Stripe, Mercury and Notion are the exceptions
  that colour the primary button.
- **Tight, light display type.** Hero sizes 48-64 px with negative tracking (-0.02em to -0.06em),
  weight 300-600, rarely 700. Titles inside the app are 13-22 px, weight 500-600.
- **Hover is a colour change.** Background or text colour only, no lift, no shadow change,
  0.15-0.2 s on most (Linear 0.16 s, Vercel 0.15 s, Raycast 0.2 s, Notion 0.2 s, Figma 0.18 s),
  0.3 s at the slow end (Stripe, Mercury, Attio). Easing is an ease-out curve.
- **Hairlines, not shadows.** Cards separate by a 1 px ring (dark: white at 6-12%, light: ink at
  8-16%). Real shadows appear only on layers that float (menu, dialog, panel).
- **Compact rows.** In-product lists are 35-45 px tall with 13-14 px text: identity on the left,
  meta and time right-aligned (Linear 40 px, Raycast 40, Attio 35, Mercury 44, Stripe 45).
- **Status is a mark plus a word.** A ring or dot icon, or a pale pill with a leading dot (Linear
  status rings, Notion dot pills with counts, Attio pills, Stripe icon and label).
- **Keyboard hints live in the UI.** Small `kbd` badges (11 px, weight 600, radius 4) beside actions
  and search: "Cmd K", "/", "Enter" (Raycast, Attio, Stripe, Arc).
- **Generous space between sections.** 96 px or more between page sections; app headers 64-78 px.
- **Real data in the picture.** Every site shows the real product with believable content, never
  abstract art.
- **Plain copy.** Statements in sentence case, no exclamation marks.

## Pick the closest reference for the screen

| Screen kind | Open these (public pages) | What to take |
|---|---|---|
| Lists, issues, queues, run history | linear.app (any section with the app window), linear.app/changelog | 40 px rows: ID muted, status ring, title, labels and date at the right; group headers with a count |
| Command palette, search, launcher | raycast.com | 40 px rows, selected row at white 10%, a preview pane, a footer with the action and its `kbd` badge |
| Dashboards, finance, tables of money | stripe.com, mercury.com | figures as light, large type; amounts right-aligned with small cents; one strip for what needs attention |
| Data tables and filters | attio.com (product windows and /changelog) | sidebar rows 14 px, table rows 35 px, pills for categories, "Sorted by" and filter chips in the header bar |
| Docs, changelog, text-heavy | stripe.com changelog (docs.stripe.com/changelog), clerk.com/changelog | 45 px rows on hairlines, a date rail with a dot, tag pills |
| Auth, onboarding, forms | clerk.com (the sign-up widget), resend.com | 34-48 px inputs, provider buttons with a "last used" hint, code with a copy icon |
| Friendly workspace, databases | notion.com, figma.com | pastel status pills with counts, view tabs, property panels, live cursors |
| Marketing and brand pages | vercel.com, linear.app, arc.net | large light type, one product shot, 128 px or more between sections |

## Where they differ: choose one on purpose

- **Temperature.** Pure neutral (Vercel, Figma), near-black with a cool cast (Linear rgb(8,9,10),
  Raycast rgb(7,8,10)), navy ink (Stripe rgb(6,27,49), Mercury rgb(23,23,33)), cool grey (Attio,
  Clerk), white with blue (Notion). Tint the whole neutral ramp the same way.
- **Density.** Dense and keyboard-first (Linear, Raycast, 13 px and 40 px rows) for people who live
  in the tool all day; medium (Attio, Stripe, 14 px) for daily tools; airy (Notion, Mercury) for
  people who come now and then.
- **Radius.** 4-8 px reads precise (Stripe, Clerk, Raycast); 10-16 px reads friendly (Attio,
  Notion, Mercury); full pills are for the primary call to action and status chips only.
- **Colour modes.** Only Vercel follows the OS setting. If the app has both modes, derive dark from
  the same ramp (Linear: page rgb(8,9,10), raised rgb(16,17,18), ring white at 8%).
- **Type.** An Inter-family face for tools (Linear, Raycast, Attio); a brand sans for products that
  sell trust or craft (Stripe, Mercury, Figma). Never the system stack.
