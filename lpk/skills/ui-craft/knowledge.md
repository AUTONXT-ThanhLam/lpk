# knowledge: where to look, what the world agrees on, and why generated UI gives itself away

Read this before the research stage of `method.md`. It is what a wide look at about a hundred real
pages and shots found; it is a starting point for your own looking, never a style to copy. Each
claim names where it came from, and what could not be had is listed at the end.

## 1. Where to look

Open real pages in the lpk Chrome, logged out, one fresh isolated context each. A page that needs a
sign-in is skipped and listed.

- **Pages of the products in your category and beside it, beyond the home page.** Pricing, docs and
  API reference, changelog, status, a list, a detail, settings, an empty state, an error page.
  Worked well: Vercel, Stripe, Linear, Cloudflare, Supabase, Sentry, Resend, Clerk, Raycast, Figma,
  Atlassian, Datadog, Snowflake, Docker, Zed, GitHub (issues, Actions runs, diff, repo home).
- **Public working screens.** Plausible's public dashboard, GitHub's own lists and diffs, Grafana
  Play, Cal.com booking pages. A team had to make these work with real data, so they carry the long
  text, the states and the density a concept shot hides.
- **Design-system sites, for the rule in a sentence.** Primer, Carbon, GOV.UK Design System: each
  states what a table, a wait or an empty state owes before it shows the example.
- **Galleries, with a lower weight.** Dribbble opens only in the browser, by reading the source of a
  shot page for the image, designer and likes; it answers an AWS challenge after a few searches and
  you do not pass it. Mark each shot as shipped, shipped-looking, an agency concept or not a screen.
  Shipped and kit-built shots spend colour on state, separate rows by rules and show a table's
  states; concept shots are drawn for the thumbnail and show the happy path only. Likes do not decide.
- **A critic's words, where they exist.** A juror, an award page, a design-system statement or a
  post that analyses the page, each with its URL. A vendor blog quoting an insider is a vendor blog.
  Without one, your notes are your own measurements and say so.

## 2. Reading a reference

What you take from a reference is a measurement or a structure: type sizes, row heights, column
widths, the one place colour is spent, what sits behind a click. Measure with `sample.mjs` on the
saved image and `get_css_styles` on the page, and write the number. A size read by eye from a
screenshot is marked "about". Note the cookie bar, the sign-in wall and the narrow width too: a page
shown to a new visitor is designed with them on.

## 3. What several good pages share

- **Hierarchy comes from type and space.** Left-aligned, tight, a few sizes. The price is the
  biggest thing after the headline; a changelog's date is its index; a list row has a 16px title and
  one grey 12px meta line. Centred lists read as a brand and scan slower.
- **Colour is spent on one meaning.** The filled button is the plan or action the page wants chosen;
  red is the failed row, green the passed one, blue the link and the hunk header. Status also has a
  shape (a glyph, a dot, a ring), never colour alone.
- **Containers are replaced by rules and space.** Plans sit in one bordered tray split by hairlines;
  rows are separated by a 1px rule; cards are rare and flat (a border, not a shadow).
- **The first screen answers the question.** A status page opens with "is anything wrong" and
  colours only the answer; a dashboard puts one chosen metric into the chart.
- **Information sits where its object is.** Prose and the code it explains share a row (Stripe
  docs); the overage price sits under the plan price (Supabase); bars sit inside table rows (Plausible);
  a control that makes the price personal sits above the price (Figma seats, a volume slider).
- **Metadata goes to a rail or behind a click.** A main column and a 280px rail of counts, labels
  and participants (GitHub); counts are numbers in pills, not lists.
- **Settings are a two-column form.** Label and one grey help line left, the control right, a rule
  between sections.
- **States are designed.** Primer's table docs list loading, empty, sort, density and pagination;
  shipped Dribbble shots show an empty table and a 380-row table.
- **The product's own voice carries the page.** Zed sets its docs in a serif and mono, PostHog turns
  the site into a desktop, GitHub's 404 stays in its joke and keeps the nav and one search box.
  Each is one idea carried through every page, and the page around it is calm.
- **Narrow width is rebuilt, not shrunk.** Pricing goes to one column and drops the code column;
  nav becomes a select; incidents become tappable cards; a sticky bottom bar appears only where the
  job is a status.

## 4. Where good pages differ on purpose

Density runs from 28px rows to a near-black page with 40px thin headings: the dense ones are read
all day, the calm ones once. Dark or light, serif or grotesque, one tray or three cards: each is
chosen for the reader and the product, so a choice needs its reason in `pick.md`, and the same
choice twice in a row needs a better one.

## 5. Why agent-built UI reads as generated

These twelve are what a pale-tinted, one-accent, shadcn-dashboard build shows next to real pages.
Each is a finding when you see it in your own screens.

1. One accent on a pale tinted ground, with the same card on it.
2. Components drawn by hand (a select, an input, a stepper, toasts) in place of the system's.
3. Low density: one big number in a card, a list with no header, columns or sort, a dead right
   column. A real row carries many facts: a GitHub issue row shows title, labels, number, author,
   date and comments.
4. No architecture: no navigation, no nouns of the product, no breadcrumbs, no saved views.
5. Placeholder copy: "Trending up this month", "Steady performance increase". Real products name
   the person's own objects and the next action.
6. A row of KPI cards (big number, small label, trend footer) above an area chart above a table.
7. Missing states: empty, loading, error, partial, long text, many rows.
8. Decoration standing in for product: a terminal dump, serif display type or a hero with no
   product in it, where the references show the product at once.
9. Even rhythm: every section with the same padding, card and heading size. Real pages vary scale.
10. Fake or generic data: round numbers, repeated names, identical rows.
11. Mobile as an afterthought: a bar over the form, a small link as the only secondary action.
12. Every screen decided from memory with no real reference beside it, so the model's average wins.

## 6. Starting from nothing

The app's own design system, its tokens and its components, come first and are extended, never
replaced. When the app has none, start from a component base whose source lives in the repo so you
edit a component instead of fighting a prop API, and set its tokens (colour, radius, type, density)
from the pick before the first screen. shadcn with its registry is the one tried: it rendered on the
first pass with both `radix-ui` and `@base-ui/react` installed, and its default look is the generated
look of section 5 until the tokens and the table density are changed. Rendered once with a changed
primary, radius 0.375rem, 13px table text, a dot and text for status and a number in place of a bar,
the researcher judged it close to GitHub's public pages; no owner has judged it by eye.

Hazards met in use:

- `npx shadcn@latest add @reui/... -y` stops on a "file already exists, overwrite?" prompt and never
  returns; `-o` finishes but replaces existing `ui/` files (7 of them in the trial).
- A data-grid example needed `type` imports to compile; the dashboard block rendered blank until
  the app was wrapped in `TooltipProvider`, and the CLI only printed a hint.
- A registry's example data can repeat a name; replace it with plausible data of your own.
- Do not copy a landing anatomy of customer logos, numbers and quotes: lpk has none, and an invented
  one is the finding of section 5, bullets 5 and 10.

## 7. What could not be had

Stripe Dashboard and the Linear app need a sign-in and were never seen; Salesforce and ServiceNow
returned Access Denied; Fluent 2 pages returned 404; PostHog dashboards and the Sentry demo needed a
sign-in. Dark mode and hover states were captured only on sites dark by default. Type sizes in the
research were read from screenshots, not from computed styles. Only a few pages had an outside
critic or award behind them (Stripe's docs, Plausible, GOV.UK). Treat every claim above as a place
to look, and check it on the page you have open.
