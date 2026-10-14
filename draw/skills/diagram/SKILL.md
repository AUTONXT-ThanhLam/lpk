---
name: diagram
description: Draw a technical picture, or several on one board, as an editable draw.io file plus a PNG in one signature style (white cards on a soft canvas, Inter type, icons, a glowing blue main path, colour for meaning and soft accents for grouping) - architecture, isometric architecture, platform stack, cube field, deployment, C4, flowchart, event flow, sequence, state machine, ERD, swimlane, org chart, decision tree, mind map, comparison table, RACI, heatmap, 2x2 quadrant, timeline, or a bar, stacked, line, waterfall, donut or scatter chart. Use whenever a plan, design page, wiki, ticket, PR or explanation needs a diagram or chart, including a chart from numbers the user gives; prefer it over an HTML page when the picture goes into a document.
---

# Diagrams in draw.io

A picture earns its place when a reader can say its message after one look. You write
what the picture holds as JSON; `drawio render` lays it out, draws it in the house style,
exports the PNG and prints the geometric facts that would trip a reader.

## 1. Decide the message first

Write one sentence the picture must make obvious, for the reader you have (a tech lead
with two minutes, a new teammate). That sentence becomes the caption. Then pick the
picture by the question the reader asks, and start from its example in
`${CLAUDE_PLUGIN_ROOT}/skills/diagram/examples/`:

| The reader asks | Picture | `type` | Example |
|---|---|---|---|
| What are the parts and how does data move? | architecture | `graph`, placed | `architecture.json` |
| What does the agent do, which tools and models? | AI agent, RAG, tool use | `graph`, placed | `agent.json` |
| Where does it run? | deployment, infra, network zones | `graph`, placed | `deployment.json` |
| What talks to our system from outside? | C4 context | `graph`, placed | `c4-context.json` |
| Who publishes what, who listens? | event flow with a queue | `graph`, placed | `event-flow.json` |
| What sits on top of what? | layered stack | `graph`, placed | `layers.json` |
| What is the system made of, as a 3D picture for a deck? | isometric architecture | `graph`, placed, `"view": "iso"` | `iso-architecture.json` |
| Which layers carry which products? | platform stack, layers in depth | `stack` | `stack.json` |
| How many of the fleet are in each state? | cube field, one cube per thing | `cubes` | `cubes.json` |
| What are the steps and the branches? | flowchart | `graph`, auto | `flowchart.json` |
| What states can it be in, what moves it? | state machine | `graph`, placed | `state.json` |
| What is stored, how does it relate? | ERD, class diagram | `graph`, auto, `table` nodes | `erd.json` |
| Who calls whom, in what order? | sequence | `sequence` | `sequence.json` |
| Which role does which step? | swimlane, user journey | `swimlane` | `swimlane.json` |
| Who reports to whom, what breaks into what? | org chart, work breakdown | `tree` | `tree.json` |
| Which way do I go? | decision tree | `tree`, `arrows` | `decision.json` |
| What does this topic touch? | mind map | `tree`, `RIGHT` | `mindmap.json` |
| Which option wins? | comparison table | `matrix` | `matrix.json` |
| Who is responsible? | RACI | `matrix` | `raci.json` |
| Where is the load or the risk? | heatmap | `matrix`, `heat` | `heatmap.json` |
| What first, what never? | 2x2 quadrant | `quadrant` | `quadrant.json` |
| What happens when, what waits on what? | timeline, roadmap | `timeline` | `timeline.json` |
| Better or worse, by how much? | bar, hbar, line | `chart` | `chart.json` |
| What is it made of? | stacked bar, donut | `chart` | `stacked.json`, `donut.json` |
| How did we get from A to B? | waterfall | `chart` | `waterfall.json` |
| Do two measures move together? | scatter | `chart` | `scatter.json` |
| The whole story on one page | several pictures in panels | `board` | `board.json` |

One message per picture. More than about 12 boxes means two pictures; when the reader
needs them side by side, put them on one `board`.

### Draw for the reader, not for the author

A reader who was not in the work must get the picture without help:

- **The title is the message**, a full sentence ("Every save becomes a version you can roll
  back to"), not a topic ("Versioning").
- **The reader's words, in the reader's language.** Name a box by what it does for them
  ("Saves the agent"), not by a class, table or service name; code names go in `sections`
  chips, under a plain title. A product a technical reader looks for is part of the name
  ("Postgres chunk store", "Redis sessions"), not small type under it. If the reader reads Vietnamese, write the labels in Vietnamese,
  and rename every legend entry too, the main path included: `"legend": {"main": "luồng chính"}`.
- **5 to 9 boxes.** Leave out every box the message does not need; merge the rest. A
  picture that needs a guide to read is two pictures.
- **One way to read it:** left to right or top to bottom, the main path in blue, starting
  where the reader's story starts (a user, a request, a trigger) and ending where they get
  the result (the answer back in the chat, the deploy live), not at an inner step.
- **Nothing unexplained:** no abbreviation the reader would not know, no colour without a
  legend entry, no arrow whose meaning the two box names do not already say unless it has
  a short verb label ("reads", "writes", "on failure").
- **Every word answers the question it raises.** Read each title, line and label and ask
  what the reader would ask next; if the picture does not answer it, the text is not done.
  "Service" or "Process" says nothing: say what it does. "Fast" says nothing: give the
  number and its unit ("p95 under 200 ms"). A `desc` says what the box does or why it is
  there, a group `note` the one rule that holds inside it, a warn box what the risk is.

## 2. Tones carry meaning, accents decorate

Start grey. Every box, group and arrow is neutral until it means something, and then it
takes the colour of that meaning, the same meaning in the same colour on every picture:

| `tone` | Colour | Means |
|---|---|---|
| `neutral` | grey | exists, unchanged (the default) |
| `new` | blue | what this change adds or the option you recommend |
| `warn` | orange | needs care: a gate, a risk, a manual step, a cost |
| `bad` | red | removed, failing, the thing to stop |
| `ok` | green | works today, a check that passes |
| `external` | umber brown, dashed | outside our system: a vendor, another team, the cloud |
| `muted` | grey, dashed | out of scope, optional |

- An **accent** (`accent`: `blue`, `lavender`, `sage`, `sand`, `coral`, `slate`) is a soft
  tint that groups things that belong together (all containers lavender, all sensors sage)
  without claiming they are new or risky. Accents go on groups, nodes, matrix columns, chart
  series, board panels, stack layers and items, and cube groups. Name what each accent
  stands for in a `key` card: `"key": [{"label": "Sensor", "accent": "sage"}]`, titled by
  `keyTitle`. A tone wins over an accent on the same thing.
- Use at most two tones beside grey and the blue main path. When everything is
  coloured, nothing stands out.
- Blue on arrows (`main: true`) marks the one path the reader should follow; draw one.
- A legend for every colour used is added under the picture. When your meaning is
  narrower, rename it: `"legend": {"new": "added by KD-12"}`; `"legend": false` hides it.
- Charts follow the same rule: the series you are talking about in blue, the rest grey
  (`tone` on a series: `blue`, `grey`, `orange`, `ink`, `green`, `red`). In a waterfall,
  green is the good direction (`better`: `up` or `down`). In a heatmap, darker blue means more.

## 3. Write the spec

Keep the spec next to the output, so the picture can be redrawn. Every type takes `title`
(the message, in ink) and `sub` (a short aside beside it, in light grey) for the band on top.

**`graph`**: `groups` `{id, title, sub, note, icon, tone, in}`; `nodes` `{id, title, desc,
icon, kind, tone, in, agent, sections, fields}`; `edges` `{from, to, label, main, tone, dashed,
both, fromSide, toSide}`.

- **Placed** (architecture, deployment, C4, event flow, layers): give every group and node
  a `row` and `col` (from 0) inside its group, or on the page when it has none, with
  `rowspan` / `colspan` to span. Sketch it the way the flow reads: what feeds a part sits
  left of it, what reads from it sits right or below, a store sits under its writer. Put
  the two ends of a long arrow in one row to keep it straight. `fromSide` / `toSide`
  (`left`, `right`, `top`, `bottom`) pin a side when the router picks a poor one.
- **Auto** (no `row` / `col`; flowchart, ERD, a small state machine): ELK lays it out,
  `direction` `RIGHT` or `DOWN`. A `decision` is entered from the side facing the flow and
  left forward by its first outgoing edge, then to either side, so list the main branch first.
  Arrows into an `end` join into one before it. A state machine starts at a `start` dot and
  ends at an `end` dot for each final state, so the reader sees where it can stop.
- A **group** is a real boundary: a service, a repo, a team, a trust zone. `note` is the
  one rule that holds inside it, in orange. Groups nest with `in`.
- **kind** is the shape: `box`, `db`, `queue`, `doc`, `cloud`, `hexagon`, `circle` (a
  person, drawn as an oval), `decision`, `note`, `start`, `end`, `table`. **tone** is the meaning (section 2).
- **title** at most 4 words; **desc** at most two short lines (`\n` breaks a line). Code
  names go in `sections` as chips, which are measured and drawn in monospace.
- **Isometric** (`"view": "iso"` on a placed or auto graph): the plan is laid out as usual,
  then turned so the flow's start faces the reader and drawn in 3D. A top-level group is a
  slab, named on its side (`title`, `sub`); a node in it is a tile with its name lying on its
  top; a node in no group is a block on the ground; `"float": true` lifts a node to a panel
  above. Arrows run on the surfaces and climb a slab's side, so keep blocks around the slab
  on the sides that face the reader (the flow's start, and below). Tile names lie along the
  tile's long edge: keep them short, or render reports the one that does not fit.
- **sections** list code names as chips under a box: `[{label, tone, chips: [..]}]`.
  **fields** on a `table`: `{name, type, key, new}`.
- Label an arrow only when the two box names do not already say what flows.
- **icons**: give every group and every box an icon; a reader finds a part by its icon
  before reading its name. Find names with `node "${CLAUDE_PLUGIN_ROOT}/bin/drawio" icons
  <words>` and leave one out only when nothing fits. When a box is a named product (Postgres,
  Redis, Kafka, GitHub, Jira, Docker, Kubernetes, Claude, Gemini), give it the brand's logo,
  `logo:<slug>` from the same search (`logo:postgresql`, `logo:anthropic`); it is drawn in
  the brand's colour, so the reader knows the product before reading. When the search finds
  no logo (AWS, Azure, Microsoft, OpenAI, Slack, Pinecone are not in the set), use a plain
  icon and write the name in the title. Mark every AI agent `"agent": true`: its box shows a
  robot beside its own icon, so the reader tells agents from plain services at a glance.
  Common ideas: an AI agent `bot`, a model or reasoning step `brain`, a tool `wrench`,
  a prompt `message-square`, memory `database`, a person `user`, a team `users`.

**`sequence`**: `participants` (nodes), `steps` `{from, to, label, main, reply, async}` or
`{note, over: [ids]}`, each with an optional `id`; `frames` `{kind: alt|opt|loop, label, from,
to}` name their first and last step by its `id` (a step number from 1 also works, but shifts when
a step is added). Two branches of one choice are one `alt` with `else` `{at, label}`, the first
step of the other branch: `{"kind": "alt", "label": "token valid", "from": "check", "to": "deny", "else": {"at": "deny", "label": "token invalid"}}`.
A frame whose steps lie inside another's is drawn inside it, so a `loop` can hold an `alt`.

**`swimlane`**: `lanes` `{id, title, icon, tone}`, `steps` (nodes with `lane`), `edges`. Each
step goes one column after the latest step with an arrow into it; set `at` (the column from 0)
only to move one, or on one step of a loop.

**`tree`**: `root` is a node with `children`; a child's `via` labels the line from its
parent, `main` draws it blue. `direction` `DOWN` (default) or `RIGHT` for a mind map;
`arrows: true` for a decision tree.

**`matrix`**: `columns`, `rows` (strings or `{title, icon, tone}`), `cells` row by row:
`true` draws a green check, `false` a red cross, `null` a dash, a word or number as text,
`{text, tone}` colours one cell. A toned column marks the recommended option. `heat: true`
shades number cells; `unit` follows each number.

**`quadrant`**: `x` and `y` `{title, low, high}`, `quadrants` (top-left, top-right,
bottom-left, bottom-right), `highlight` (the quadrant index to tint) in `highlightTone`
(`new` for the one to pick, `warn` or `bad` for the risks to act on first), `items` `{title, x,
y, icon, tone}` with x and y from 0 to 1.

**`timeline`**: `lanes` `{id, title}`, `tasks` `{title, lane, start, end, tone}`, `milestones`
`{title, at}`. Give real dates (`"2026-10-13"`; `end` is the last day of the task) and `locale`
(`"vi"`) for the axis; `unit: "Week"` makes a column a week. Without dates, numbers count units
from 0 with `end` exclusive, and `unit` names them.

**`chart`**: `chart` `bar` | `hbar` (long names) | `line` | `waterfall` | `donut` |
`scatter`; `categories`, `series` `{name, values, tone}`, optional `unit`, `prefix`,
`title`. `stacked: true` stacks a bar or hbar. A waterfall takes one series, the start
then each change, and `total` names the end bar. A donut takes one series and `center`
names its total. A scatter takes `points` `{x, y, label, tone}` and `x` / `y` `{title, unit}`.
A bar chart widens until every printed value fits beside its neighbours; when render says it
is wider than a page, give it fewer series or categories, or make it an `hbar`.

**`stack`**: `layers` `{title, sub, accent, tone}` from the bottom up, each a slab named on
its side; `items` `{id, title, icon, accent, tone}` stand on the top layer; `panels` (same
fields) float above it; `links` `{from, to, main, dashed}` join an item to a panel with a
vertical line, so a panel floats over the items it links to. Put items that link to one panel
next to each other in the list, so the panel stays small.

**`cubes`**: `size` `[cols, rows]` (at most 2500 cubes), `groups` `{title, accent, tone}`
with `cells` `[[col, row], ...]` or a `count` (spread over the free cells, the same way every
render), `labels` `{title, icon, at: [col, row], below}` hang a callout over a cube. The key
card names the groups; `keyTitle` titles it.

**`board`**: `title`, `panels`, each a spec of any other type plus `title`, `icon`, `sub`,
`row`, `col` and optional `colspan`. Panels in a column share its width, in a row its
height. A panel can be isometric (`stack`, `cubes`, an iso `graph`). One legend covers the whole board, so a colour must mean the same in every panel.

## 4. Render, then fix every fact

```
node "${CLAUDE_PLUGIN_ROOT}/bin/drawio" render <spec.json> [-o <out.drawio>]
```

It writes `<name>.drawio` and `<name>.png` and prints the size, the number of crossing
arrows and each fact: boxes overlapping, an arrow through a box or over a group title, a
label on a box or another label, a task name that does not fit, an arrow with no route, a
picture too wide for a page. Fix each one in the spec and render again, until it prints none.

Then open the PNG with the Read tool and read it as a stranger would, at the width the page
shows it. Write down, before looking at the spec again, the one sentence the picture says.
If it is not the message, or you had to know the work to get it, redraw: fewer boxes,
plainer words, one path. Also check that the main path is the blue one, that every colour
means what the legend says, that every word is readable, and that every word, legend
included, is in the language the request was written in: the render names each built-in
English word it drew and the key that replaces it. It also prints the box count,
and the tones beside grey and the blue path (at most two). Each legend entry must be a meaning from the colour table
("added by this change", "a risk to act on"), not a description of the box ("splits the
work"); a colour that only describes is grey. On a board, read every panel against the one
legend: a colour that means two things is two mistakes. Last, every AI agent has `"agent":
true`, every named product whose logo the search finds has it, and every dashed arrow says
in its label what dashed means there ("async", "nightly"). Change the spec, not the file.

When it is off: move a box to another row or column, put a long arrow's ends in one row,
drop labels that repeat box names, pin a side, or split the picture. In auto layout,
reorder `nodes` and `edges` (order is kept where it can be) or switch `direction`;
`layout` passes ELK layered options for the rare case.

## 5. Hand it over

Give the reader the PNG to look at and the `.drawio` to keep: in Confluence the owner
inserts it with the draw.io macro (Import) so the team can edit it later; in a PR or
ticket the PNG goes inline and the `.drawio` beside it. The spec JSON stays with the
work, so the next change redraws the picture instead of patching it.
