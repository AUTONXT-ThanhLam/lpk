import { C, esc, iconShape, textWidth } from "./style.mjs";
import { Model } from "./model.mjs";
import { key as drawKey } from "./legend.mjs";
import { P, block, callout, facesOf, labelFacts, stencil } from "./iso.mjs";

const S = 28, GAP = 7, H = 24, EDGE = 22, STEM = 34;
const PLAIN = { top: "#ffffff", s1: "#ececf0", s2: "#dcdce1", line: "#9a9aa2" };

/**
 * A field of cubes, as a slide draws a fleet or a portfolio: `size: [cols, rows]`, `groups` colour
 * some cubes by accent (their `cells` as [col, row], or a `count` spread over the free cells the
 * same way every time), `labels` hang a callout over the cube at `at`. The key names the groups.
 */
export default async function cubes(spec) {
  const [cols, rows] = spec.size ?? [];
  if (!(Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols * rows <= 2500))
    throw new Error(`a cube field needs "size": [cols, rows], whole numbers with cols x rows at most 2500, got ${JSON.stringify(spec.size)}`);
  const inField = ([c, r]) => Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < cols && r < rows;
  const owner = new Map(), key = (c, r) => `${c},${r}`;
  const groups = spec.groups ?? [];
  for (const g of groups) {
    facesOf(g);
    for (const at of g.cells ?? []) {
      if (!inField(at)) throw new Error(`group "${g.title}": cell ${JSON.stringify(at)} is outside the ${cols} x ${rows} field`);
      const k = key(...at);
      if (owner.has(k)) throw new Error(`cell ${JSON.stringify(at)} is in both "${owner.get(k).title}" and "${g.title}"`);
      owner.set(k, g);
    }
  }
  // A count takes free cells in a fixed scattered order, so the same spec draws the same field.
  const free = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!owner.has(key(c, r))) free.push([c, r]);
  free.sort((a, b) => hash(a) - hash(b));
  for (const g of groups) if (g.count) {
    if (!Number.isInteger(g.count) || g.count < 0) throw new Error(`group "${g.title}": count must be a whole number`);
    if (g.count > free.length) throw new Error(`group "${g.title}" wants ${g.count} cubes but only ${free.length} cells are free`);
    for (const at of free.splice(0, g.count)) owner.set(key(...at), g);
  }
  for (const l of spec.labels ?? []) if (!Array.isArray(l.at) || !inField(l.at))
    throw new Error(`label "${l.title}": at ${JSON.stringify(l.at)} is outside the ${cols} x ${rows} field`);

  const m = new Model(spec.title ?? "cubes");
  m.painter = true;
  const pos = (c, r) => ({ x: EDGE + c * (S + GAP), y: EDGE + r * (S + GAP) });
  const W = 2 * EDGE + cols * (S + GAP) - GAP, D = 2 * EDGE + rows * (S + GAP) - GAP;
  stencil(m, [{ pts: [P(10, 10, 0), P(W + 10, 10, 0), P(W + 10, D + 10, 0), P(10, D + 10, 0)], fill: "#e4e4e8" }], { extra: "opacity=55;" });
  block(m, { x: 0, y: 0, w: W, d: D, z: 0, t: 10 }, { top: "#fbfbfc", s1: "#efeff2", s2: "#e2e2e6", line: "#2b2b2f", sw: 1.2 });
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  cells.sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0]);
  for (const [c, r] of cells) {
    const g = owner.get(key(c, r));
    block(m, { ...pos(c, r), w: S, d: S, z: 10, t: H }, g ? facesOf(g) : PLAIN);
  }
  for (const g of groups) if (g.tone && g.tone !== "neutral") m.tones.add(g.tone);

  for (const l of spec.labels ?? []) {
    const { x, y } = pos(...l.at), g = owner.get(key(...l.at)), f = g ? facesOf(g) : { line: C.line };
    // Above, the stem rises from the cube's top; below, it hangs from its front corner on the plate.
    const below = l.below ?? false, top = below ? P(x + S, y + S, 10) : P(x + S / 2, y + S / 2, 10 + H);
    const room = l.icon ? "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" : "";
    callout(m, top, `${room}${esc(l.title ?? "")}`, `${l.icon ? "xxxx" : ""}${l.title ?? ""}`, f, below, STEM);
    if (l.icon) {
      const w = textWidth(`xxxx${l.title ?? ""}`, 13) + 30;
      iconAt(m, l.icon, [top[0] - w / 2 + 22, below ? top[1] + 25 + STEM : top[1] - 25 - STEM], f.line);
    }
  }
  m.facts.push(...labelFacts(m));
  // The key is part of the picture, so it comes along when the field is a board panel.
  const keyRows = spec.key ?? groups.filter((g) => g.accent || (g.tone && g.tone !== "neutral")).map((g) => ({ label: g.title, accent: g.accent ?? g.tone }));
  drawKey(m, { key: keyRows, keyTitle: spec.keyTitle });
  m.keyDone = true;
  return m;
}

/** An upright Lucide icon at a screen point, for a callout. */
function iconAt(m, name, [px, py], color) {
  const shape = iconShape(name);
  if (!shape) throw new Error(`no icon "${name}"; search with: drawio icons <words>`);
  const body = shape.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  m.shape({ x: px - 8, y: py - 8, w: 16, h: 16, role: "deco", style: `shape=image;html=1;image=data:image/svg+xml,${Buffer.from(svg).toString("base64")};` });
}

/** A fixed scatter: the same cell always lands at the same place in the order. */
const hash = ([c, r]) => {
  let h = (c * 73856093) ^ (r * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
};
