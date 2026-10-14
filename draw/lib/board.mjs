import { C, SMALL, accentOf, esc, iconImg, textWidth } from "./style.mjs";
import { Model } from "./model.mjs";
import { key } from "./legend.mjs";
import { build } from "./types.mjs";

const GAP = 32, PAD = 20, HEAD = 44;

/**
 * Several pictures on one canvas, each in a titled panel: an architecture beside the table it
 * writes, a flow above the chart that measures it. `panels` are specs of any other type with
 * a `row` and `col` (from 0) and optional `colspan`; panels in a column share its width, in a
 * row its height. One legend under the board covers every colour any panel uses.
 */
export default async function board(spec) {
  const panels = spec.panels ?? [];
  if (!panels.length) throw new Error("a board needs panels");
  const built = [];
  for (const [k, p] of panels.entries()) {
    if (p.type === "board") throw new Error("a board panel cannot be another board");
    if (!Number.isInteger(p.row) || !Number.isInteger(p.col)) throw new Error(`panel ${k + 1} ("${p.title ?? ""}") needs a row and col`);
    let m;
    try { m = await build({ ...p, title: undefined }); key(m, p); } catch (e) { throw new Error(`panel ${k + 1} ("${p.title ?? ""}"): ${e.message}`); }
    const b = m.bounds();
    const headW = textWidth(p.title ?? "", 15, { bold: true }) + (p.icon ? 22 : 0) + (p.sub ? textWidth(p.sub, SMALL) + 12 : 0) + 2 * PAD + 30;
    built.push({ p, m, b, w: Math.max(b.w + 2 * PAD, headW), h: b.h + HEAD + PAD });
  }
  // Column widths and row heights from the panels that do not span; spanning panels widen the last column they cover.
  const ncol = Math.max(...panels.map((p) => p.col + (p.colspan ?? 1))), nrow = Math.max(...panels.map((p) => p.row + 1));
  const cw = Array(ncol).fill(0), rh = Array(nrow).fill(0);
  for (const span of [false, true]) for (const x of built) {
    const cs = x.p.colspan ?? 1;
    if ((cs > 1) !== span) continue;
    const have = cw.slice(x.p.col, x.p.col + cs).reduce((a, c) => a + c, 0) + (cs - 1) * GAP;
    if (x.w > have) cw[x.p.col + cs - 1] += x.w - have;
    rh[x.p.row] = Math.max(rh[x.p.row], x.h);
  }
  const colX = cw.map((_, c) => 20 + cw.slice(0, c).reduce((a, w) => a + w + GAP, 0));
  let y = 20;
  const out = new Model(spec.title ?? "board");
  // Panels keep their own painting order (an isometric panel paints back to front).
  out.painter = true;
  const rowY = rh.map((_, r) => y + rh.slice(0, r).reduce((a, h) => a + h + GAP, 0));

  built.forEach(({ p, m, b }, k) => {
    const cs = p.colspan ?? 1, w = colX[p.col + cs - 1] + cw[p.col + cs - 1] - colX[p.col], h = rh[p.row];
    const fx = colX[p.col], fy = rowY[p.row];
    const a = accentOf(p);
    const icon = p.icon ? `${iconImg(p.icon, a ? a.line : C.ink)}&nbsp;` : "";
    const sub = p.sub ? `&nbsp;&nbsp;<font style="font-size:${SMALL}px" color="${C.soft}">${esc(p.sub)}</font>` : "";
    // A panel is a white sheet with a soft shadow, tinted from the top when it has an accent.
    const fill = a ? `fillColor=${a.fill};gradientColor=#ffffff;gradientDirection=south;` : "fillColor=#ffffff;";
    const frame = out.shape({ x: fx, y: fy, w, h, role: "group", value: `${icon}<span style="font-size:15px;font-weight:600">${esc(p.title ?? "")}</span>${sub}`,
      style: `rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;${fill}strokeColor=none;shadow=1;verticalAlign=top;align=left;spacingLeft=${PAD - 4};spacingTop=10;fontSize=14;fontColor=${C.ink};` });
    // The panel's picture starts under its title, as text on a page does; its ids stay apart from the other panels'.
    // Its glows come along as cells of their own, so the copied arrows do not glow a second time.
    const dx = fx + PAD - b.x, dy = fy + HEAD - b.y;
    const id = (s) => (s ? `p${k + 1}-${s}` : s);
    for (const c of m.ordered()) {
      if (c.points) out.edges.push({ ...c, glow: false, id: id(c.id), source: id(c.source), target: id(c.target), points: c.points.map(([px, py]) => [px + dx, py + dy]), k: out.k++ });
      else out.shapes.push({ ...c, id: id(c.id), parent: c.parent ? id(c.parent) : frame.id, x: c.x + dx, y: c.y + dy, k: out.k++ });
    }
    for (const t of m.tones) out.tones.add(t);
    for (const t of m.lineTones) out.lineTones.add(t);
    for (const d of m.defaults) out.defaults.add(d);
    for (const f of m.facts) out.facts.push(`panel ${k + 1}: ${f}`);
  });
  return out;
}
