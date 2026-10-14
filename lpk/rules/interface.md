# Interface rules

What makes a screen read as overwhelming or machine-generated to the person who uses it. Built
from an owner who rejected two dense, generated-looking UIs, and from the published catalogues of
generated-UI tells (https://www.impeccable.style/slop and similar lists). The `find` patterns are
the tells a diff can show literally; each is a place to look, not a verdict. A line that keeps one
says why in the design (a real warning stripe, a real numbered sequence).

### ui-one-question: each screen answers one question, and the rest waits behind a click
- blocks: medium
- when: path `\.(tsx|jsx|vue|svelte|html|dart|swift|kt)$`
- rule: A screen answers the one question its user brings to it (what needs me, is it on track, what went wrong) at a glance. Each fact shows once, and the accent colour marks only what needs the user. Metadata (counts, costs, ids, times) sits beside an item at most once and otherwise on hover or in details. Copy is short, plain and in sentence case, and never explains the process.
- check: screenshot each changed screen at a laptop width and a narrow one, in light and dark; name the screen's question, count the visible text pieces outside the content itself, and list each fact shown twice and each piece that could wait behind a click. Repro: the screenshot with the duplicated or surplus pieces named.

### ui-generated-tells: no pattern every generator emits
- blocks: medium
- when: path `\.(tsx|jsx|vue|svelte|html|css|scss|less|dart|swift|kt)$`
- find: `\bborder-[lrse]-(?:[2-9]|\[\d+px\])` in path `\.(tsx|jsx|vue|svelte|html)$`
- find: `border-(left|right|inline-start)(-width)?\s*:\s*[2-9]px`
- find: `\buppercase\b|text-transform\s*:\s*uppercase`
- find: `\banimate-(pulse|ping|bounce)\b|@keyframes\s+[\w-]*(pulse|blink|glow)`
- find: `\bline-through\b`
- find: `\bbg-clip-text\b|background-clip\s*:\s*text`
- find: `\brounded-(2xl|3xl|\[(1[7-9]|[2-9]\d)px\])`
- find: `\b(from|via|to)-(purple|violet|fuchsia|indigo)-\d{3}\b`
- find: `\bbackdrop-blur|backdrop-filter\s*:\s*blur`
- find: `\bshadow-\[0_0_\d{2,}px|box-shadow\s*:\s*0\s+0\s+\d{2,}px`
- find: `—` in path `\.(tsx|jsx|vue|svelte|html)$`
- rule: No side-stripe accent borders, uppercase or tracked eyebrow labels, landing-page hero headlines or hero metric rows on working screens, nested cards, icon tiles above headings, a hairline border plus a wide shadow on one element, card radii above 16px, purple or cyan gradients, glows, gradient text or glassmorphism used as decoration, pulsing or blinking on what is not changing, bounce easing, strike-through as a state, "·" chains of three or more facts, truncated sentences the user must read, or em dashes in UI copy. Hierarchy comes from size, weight and spacing; three sizes and two weights per screen.
- check: for each candidate, say what it communicates that plainer type or spacing would not. Repro: the screenshot of the screen with the tell.

### ui-motion: motion shows real change, quickly
- blocks: low
- when: added `\b(animate|transition|motion\.|keyframes|spring|AnimatePresence)\b`
- rule: Animation marks a real change (an item arrives, a card resolves, a panel opens), takes 150-220ms for most changes, settles without overshoot, animates transform and opacity rather than layout, and is off under prefers-reduced-motion.
- check: trigger the change with reduced motion on and off, and record a performance trace while it runs. Repro: the trace with the long frames or the motion that runs on nothing.
