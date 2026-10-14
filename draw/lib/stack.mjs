import { C, esc, textWidth } from "./style.mjs";
import { Model } from "./model.mjs";
import { noteEdgeTone } from "./legend.mjs";
import { P, block, cable, faceName, facesOf, flatIcon, labelFacts, stencil } from "./iso.mjs";

const T = 24, GAP = 46, LIFT = 170, PAD = 36, SPACE = 34, ITEM_W = 72;
const LAYER = { top: "#fbfbfc", s1: "#f0f0f2", s2: "#e3e3e7", line: "#2b2b2f", sw: 1.2 };
const TILE = { top: "#ffffff", s1: "#ececf0", s2: "#dedee3", line: "#8a8a92" };
const PANEL = { top: "#ffffff", s1: "#ffffff", s2: "#ffffff", line: "#7d6ff0" };

/**
 * Layers stacked in depth, as a platform slide draws them: `layers` from the bottom up, each a
 * slab named on its side; `items` stand on the top layer; `panels` float above it; `links` join
 * an item to a panel with a line straight up, blue and glowing when `main`.
 */
export default async function stack(spec) {
  const layers = spec.layers ?? [], items = spec.items ?? [], panels = spec.panels ?? [], links = spec.links ?? [];
  if (!layers.length) throw new Error("a stack needs layers: [{title}] from the bottom up");
  const ids = new Set();
  for (const x of [...items, ...panels]) {
    if (!x.id) throw new Error(`every item and panel needs an id: ${JSON.stringify(x).slice(0, 60)}`);
    if (ids.has(x.id)) throw new Error(`duplicate id "${x.id}"`);
    ids.add(x.id);
  }
  for (const l of links) for (const end of [l.from, l.to]) if (!ids.has(end)) throw new Error(`link ${l.from} -> ${l.to}: unknown id "${end}"`);
  const isPanel = new Set(panels.map((p) => p.id));
  for (const l of links) if (isPanel.has(l.from) && isPanel.has(l.to)) throw new Error(`link ${l.from} -> ${l.to}: a link joins an item to a panel or to another item, not two panels`);

  // Items in rows along y, each as long as its longest name, so a line rising from one passes
  // only items behind it; the plate is as deep as the longest row.
  const len = Math.max(150, ...[...items, ...panels].map((x) => textWidth(x.title ?? "", 13, { bold: true }) + (x.icon ? 34 : 0) + 30));
  const per = Math.max(1, Math.min(5, Math.ceil(items.length / 2))), rows = Math.ceil(items.length / per) || 1;
  const at = items.map((_, i) => ({ x: PAD + Math.floor(i / per) * (ITEM_W + SPACE), y: PAD + (i % per) * (len + SPACE), w: ITEM_W, d: len }));
  const names = layers.map((l) => textWidth(`→ ${l.title ?? ""}${l.sub ? `  ${l.sub}` : ""}`, 15, { bold: true }) + 12);
  const W = rows * ITEM_W + (rows - 1) * SPACE + 2 * PAD;
  const D = Math.max(Math.min(per, items.length || 1) * (len + SPACE) - SPACE + 2 * PAD, panels.length * (len + SPACE) + PAD, ...names.map((w) => w + 40));
  const top = (layers.length - 1) * (T + GAP);
  const m = new Model(spec.title ?? "stack");
  m.painter = true;
  const facts = [];

  layers.forEach((l, k) => {
    const z = k * (T + GAP), f = facesOf(l, LAYER);
    if (l.tone && l.tone !== "neutral") m.tones.add(l.tone);
    stencil(m, [{ pts: [P(8, 8, z), P(W + 8, 8, z), P(W + 8, D + 8, z), P(8, D + 8, z)], fill: "#e4e4e8" }], { extra: "opacity=55;" });
    block(m, { x: 0, y: 0, w: W, d: D, z, t: T }, { ...f, line: LAYER.line, sw: 1.2 });
    if (k === layers.length - 1) {
      const grid = [];
      for (let u = 20; u < W; u += 20) grid.push({ pts: [P(u, 0, z + T), P(u, D, z + T)], stroke: "#e6e6ea", sw: 0.6, open: true });
      for (let u = 20; u < D; u += 20) grid.push({ pts: [P(0, u, z + T), P(W, u, z + T)], stroke: "#e6e6ea", sw: 0.6, open: true });
      stencil(m, grid);
    }
    const w = names[k], [px, py] = P(W, D - w / 2 - 14, z + T / 2);
    const cell = m.shape({ x: px - w / 2, y: py - 11, w, h: 22, role: "iso-name",
      value: `→ ${esc(l.title ?? "")}${l.sub ? `&nbsp;&nbsp;<span style="color:${C.soft};font-weight:400">${esc(l.sub)}</span>` : ""}`,
      style: `text;html=1;whiteSpace=nowrap;align=center;verticalAlign=middle;fontSize=15;fontStyle=1;fontColor=${C.ink};rotation=-30;` });
    cell.rot = -30;
  });

  // A panel floats over the items it links to and covers the foot of each link, so a link is a
  // plain vertical line from the back of its item; a panel that would cover another floats higher.
  const zTop = top + T, part = {};
  items.forEach((x, i) => { part[x.id] = { ...at[i], z: zTop, t: 8 }; });
  const foot = (p) => [p.x + p.w / 2, p.y + 14];
  let free = PAD;
  const placed = [];
  for (const x of panels) {
    const feet = links.filter((l) => l.to === x.id || l.from === x.id).map((l) => part[l.to === x.id ? l.from : l.to]).filter((p) => p && p.t).map(foot);
    const xs = feet.map((f) => f[0]), ys = feet.map((f) => f[1]);
    const w = Math.max(ITEM_W + 24, feet.length ? Math.max(...xs) - Math.min(...xs) + 60 : 0), d = Math.max(len, feet.length ? Math.max(...ys) - Math.min(...ys) + 60 : 0);
    const cx = feet.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : W / 2, cy = feet.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : free + d / 2;
    const b = { x: cx - w / 2, y: cy - d / 2, w, d, z: zTop + LIFT, t: 0 };
    while (placed.some((o) => o.z === b.z && o.x < b.x + b.w && b.x < o.x + o.w && o.y < b.y + b.d && b.y < o.y + o.d)) b.z += 80;
    placed.push(b); part[x.id] = b; free = Math.max(free, b.y + b.d + SPACE);
  }
  const draw = (x, b, plain) => {
    const f = facesOf(x, plain);
    if (x.tone && x.tone !== "neutral") m.tones.add(x.tone);
    block(m, b, f);
    if (x.icon) flatIcon(m, x.icon, [b.x + b.w / 2, b.y + b.d - 18, b.z + b.t], 22, plain === TILE && !x.accent && !x.tone ? C.ink : f.line, "y");
    const room = x.icon ? 32 : 0;
    facts.push(faceName(m, esc(x.title ?? ""), x.title ?? "", [b.x + b.w / 2, b.y + (b.d - room) / 2, b.z + b.t], "y", b.d - room - 14, b.w - 8, { color: f.text ?? C.ink, who: plain === PANEL ? "its panel" : "its tile" }));
  };
  // Back to front: each item, then the lines rising from it (they pass in front of items behind).
  // A line to a higher panel is cut at each lower panel's height and each piece drawn after the
  // panels below it, so it vanishes under a panel it passes and shows again above it.
  const depth = (p) => p.x + p.w / 2 + p.y + p.d / 2, levels = [...new Set(placed.map((b) => b.z))].sort((a, b) => a - b);
  const later = new Map(levels.map((z) => [z, []]));
  for (const x of [...items].sort((a, b) => depth(part[a.id]) - depth(part[b.id]))) {
    draw(x, part[x.id], TILE);
    for (const l of links.filter((l) => l.from === x.id || (l.to === x.id && !part[l.from].t))) {
      const other = part[l.from === x.id ? l.to : l.from], c = foot(part[x.id]), opt = { main: Boolean(l.main), dashed: Boolean(l.dashed), arrow: Boolean(other.t) };
      noteEdgeTone(m, l.main ? "main" : "grey");
      if (other.t) { cable(m, [[...c, zTop + 8], [...foot(other), zTop + 8]], opt); continue; }
      const cuts = [zTop + 8, ...levels.filter((z) => z < other.z), other.z];
      cable(m, [[...c, cuts[0]], [...c, cuts[1]]], opt);
      for (let i = 1; i < cuts.length - 1; i++) later.get(cuts[i]).push(() => cable(m, [[...c, cuts[i]], [...c, cuts[i + 1]]], opt));
    }
  }
  for (const z of levels) {
    for (const x of panels.filter((x) => part[x.id].z === z).sort((a, b) => depth(part[a.id]) - depth(part[b.id]))) draw(x, part[x.id], PANEL);
    for (const f of later.get(z)) f();
  }
  for (const f of facts) if (f) m.facts.push(f);
  m.facts.push(...labelFacts(m));
  return m;
}
