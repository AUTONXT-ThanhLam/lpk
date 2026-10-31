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
- **The bar is the best-made screen of this page type, from any category.** The references a build
  is laid next to are the ones a buyer of high-end software would pay for: Linear, Attio, Stripe,
  Datadog, Ramp, Resend. Each spends colour on state, puts one element first and shows its people
  and objects as themselves. A plain screen of the reader's own category is not the bar.
- **Public working screens.** Plausible's public dashboard, GitHub's own lists and diffs, Grafana
  Play, Cal.com booking pages. A team had to make these work with real data, so they carry the long
  text, the states and the density a concept shot hides; read them for that, not for the look.
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

Read from shipped screens of Linear (Insights, filters), Attio (deals, companies), Datadog (On-Call
pages), Ramp (spend briefing), Stripe (payments, billing) and Resend (metrics), the screens a buyer
of high-end software holds up as the bar. Sizes are about, read from screenshots.

- **One thing is first, and it is big.** A sentence that states the finding as the section title
  ("$884K spent this week, averaging $126K per day", Ramp), one number set far above everything
  else ("58m", Linear Insights), or a filled band that holds the actions (Datadog's next steps).
  The title or number is two to three times the body size; nothing else competes with it.
- **Colour is spent generously on categories and states, one meaning per hue.** Attio gives each
  deal type its own soft-tinted pill with dark text of the same hue (green recurring, blue
  one-time, pink exclusive, purple referral); Datadog fills a red HIGH and an amber LOW chip on
  every row; Stripe and Resend colour each series. With the words covered, the rows still sort by
  colour. Chrome (nav, headers, borders) stays neutral, so the data carries all the colour.
- **Entities appear as themselves.** A company row starts with its logo, a person with an avatar,
  a service or a field with its icon (Attio, Datadog, Linear's filter pills). A list of names in
  plain text is the generated look.
- **Type is real-sized and rows breathe.** Row text about 14-15 px, rows about 40-48 px, column
  headers with an icon each (Attio). Small grey type is for one meta line, not for the content.
- **Titles say what happened.** "Firing for 23 min", "$884K spent this week": the heading carries
  the fact, so the person reads one line and knows.
- **The data closes.** A sum or count row under a table (Attio "2,813 count", "$83,560,165 sum"),
  a chart that marks its key moments (Ramp), a total that equals its parts.
- **Status also has a shape** (a glyph, a dot, a filled chip), never colour alone.
- **Metadata goes to a rail or behind a click,** and settings are a two-column form: label and help
  left, the control right.
- **States are designed:** empty, loading, error, long text, many rows, each with a look.
- **Narrow width is rebuilt, not shrunk:** one column, the first thing still first, the primary
  action in reach.

## 4. Where good pages differ on purpose

Density runs from 28px rows to a near-black page with 40px thin headings: the dense ones are read
all day, the open ones once. Dark or light, serif or grotesque, one tray or three cards: each is
chosen for the reader and the product, so a choice needs its reason in `pick.md`, and the same
choice twice in a row needs a better one.

## 5. Why agent-built UI reads as generated

These twelve are what a pale-tinted, one-accent, shadcn-dashboard build shows next to real pages.
Each is a finding when you see it in your own screens.

1. One accent on a pale tinted ground, with the same card on it.
2. Components drawn by hand (a select, an input, a stepper, toasts) in place of the system's.
3. Low density: a list with no header, columns or sort, a dead right column, a card holding one
   number and nothing else. A real row carries many facts: a GitHub issue row shows title, labels, number, author,
   date and comments.
4. No architecture: no navigation, no nouns of the product, no breadcrumbs, no saved views.
5. Placeholder copy: "Trending up this month", "Steady performance increase". Real products name
   the person's own objects and the next action.
6. A row of equal KPI cards (big number, small label, trend footer) above an area chart above a
   table, where no tile is the answer and every tile weighs the same. Datadog's tiles pass: each
   number is a result, set far above the rest and filled with its state.
7. Missing states: empty, loading, error, partial, long text, many rows.
8. Decoration standing in for product: a terminal dump, serif display type or a hero with no
   product in it, where the references show the product at once.
9. Even rhythm: every section with the same padding, card and heading size. Real pages vary scale.
10. Fake or generic data: round numbers, repeated names, identical rows.
11. Mobile as an afterthought: a bar over the form, a small link as the only secondary action.
12. Every screen decided from memory with no real reference beside it, so the model's average wins.
13. Restraint with nothing in its place. tasteskill (github.com/leonxlnx/taste-skill) recorded its
    own clean, quiet app screens losing blind to richer ones, for these reasons: a thin first
    screen, no product name or mark, one grey for a good and a bad change, no control for the job,
    and a screen any product could own. Take a tell away and put the product in its place: its
    people, its objects, its numbers and the one thing to do next.

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
