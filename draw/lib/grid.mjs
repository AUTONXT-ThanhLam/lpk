import { Model, S } from "./model.mjs";
import { accentOf, shapeTone } from "./style.mjs";
import { drawNode, groupHeader, measure } from "./nodes.mjs";
import { wire } from "./wires.mjs";

const GAP = { top: [72, 48], inner: [56, 40] }; // [between columns, between rows]
// Boxes in one column share its width, so their edges and the arrowheads on them line up.
const STRETCH = new Set(["box", "db", "doc", "queue", "hexagon", "note", "table"]);

/**
 * Boxes placed by the author on a grid: every group and node has a `row` and `col` (from 0)
 * inside its group, or on the page when it has none, and may span with `rowspan` / `colspan`.
 * Columns and rows take the size of their largest member; a group fills its cells, so groups in
 * one row line up. Arrows are then routed around every box and group title.
 */
export default function grid(spec) {
  const groups = spec.groups ?? [], nodes = spec.nodes ?? [];
  const items = [...groups.map((g) => ({ ...g, group: true })), ...nodes];
  const headers = Object.fromEntries(groups.map((g) => [g.id, groupHeader(g)]));
  for (const x of items) if (!Number.isInteger(x.row) || !Number.isInteger(x.col)) throw new Error(`"${x.id}" needs a row and col (grid layout: every group and node is placed)`);

  // Size of each container's content, inside out.
  const size = {}, cells = {};
  const layout = (id) => {
    const kids = items.filter((x) => (x.in ?? null) === id);
    const [cg, rg] = (id ? GAP.inner : GAP.top).map((g) => Math.max(g, spec.minGap?.[id ? "inner" : "top"] ?? 0));
    const dims = kids.map((k) => ({ k, ...(k.group ? layoutGroup(k) : measure(k)) }));
    const ncol = Math.max(0, ...kids.map((k) => k.col + (k.colspan ?? 1))), nrow = Math.max(0, ...kids.map((k) => k.row + (k.rowspan ?? 1)));
    const cw = Array(ncol).fill(0), rh = Array(nrow).fill(0);
    for (const span of [false, true]) for (const d of dims) {
      const cs = d.k.colspan ?? 1, rs = d.k.rowspan ?? 1;
      if ((cs > 1 || rs > 1) !== span) continue;
      const haveW = cw.slice(d.k.col, d.k.col + cs).reduce((a, b) => a + b, 0) + (cs - 1) * cg;
      if (d.w > haveW) cw[d.k.col + cs - 1] += d.w - haveW;
      const haveH = rh.slice(d.k.row, d.k.row + rs).reduce((a, b) => a + b, 0) + (rs - 1) * rg;
      if (d.h > haveH) rh[d.k.row + rs - 1] += d.h - haveH;
    }
    const xs = cw.map((_, i) => cw.slice(0, i).reduce((a, b) => a + b + cg, 0)), ys = rh.map((_, i) => rh.slice(0, i).reduce((a, b) => a + b + rg, 0));
    // A box in a row with a group lines up with the group's first row of boxes, not the group's
    // middle, so an arrow between them runs straight.
    const mid = rh.map((_, r) => {
      const g = dims.find((d) => d.k.group && d.k.row === r && (d.k.rowspan ?? 1) === 1);
      return g ? headers[g.k.id].height + 14 + size[g.k.id].inner.firstMid : null;
    });
    for (const d of dims) {
      const cs = d.k.colspan ?? 1, rs = d.k.rowspan ?? 1;
      const cellW = xs[d.k.col + cs - 1] + cw[d.k.col + cs - 1] - xs[d.k.col], cellH = ys[d.k.row + rs - 1] + rh[d.k.row + rs - 1] - ys[d.k.row];
      cells[d.k.id] = d.k.group ? { x: xs[d.k.col], y: ys[d.k.row], w: cellW, h: rs > 1 || d.k.fill ? cellH : d.h }
        : { ...(STRETCH.has(shapeTone(d.k).shape) && d.k.stretch !== false ? { x: xs[d.k.col], w: cellW } : { x: xs[d.k.col] + (cellW - d.w) / 2, w: d.w }), y: ys[d.k.row] + nodeTop(d, cellH, rs === 1 ? mid[d.k.row] : null), h: d.h };
    }
    return { w: cw.reduce((a, b) => a + b, 0) + Math.max(0, ncol - 1) * cg, h: rh.reduce((a, b) => a + b, 0) + Math.max(0, nrow - 1) * rg, firstMid: (rh[0] ?? 0) / 2 };
  };
  const layoutGroup = (g) => {
    const inner = layout(g.id), h = headers[g.id];
    size[g.id] = { w: Math.max(inner.w + 40, h.width), h: inner.h + h.height + 14 + 22, inner };
    return size[g.id];
  };
  layout(null);

  const m = new Model(spec.title ?? "diagram");
  const abs = {};
  const place = (id, ox, oy, parent) => {
    for (const x of items.filter((i) => (i.in ?? null) === id)) {
      const c = cells[x.id], box = { x: ox + c.x, y: oy + c.y, w: c.w, h: c.h };
      abs[x.id] = box;
      if (x.group) {
        const s = m.shape({ id: x.id, parent, ...box, value: headers[x.id].value, style: S.group(x.tone, accentOf(x)), role: "group" });
        if (x.tone && x.tone !== "neutral") m.tones.add(x.tone);
        s.header = headers[x.id].height;
        s.headerW = headers[x.id].width;
        const inner = size[x.id].inner;
        place(x.id, box.x + (box.w - inner.w) / 2, box.y + headers[x.id].height + 14, x.id);
      } else drawNode(m, x, box, parent);
    }
  };
  place(null, 20, 20, null);

  const obstacles = [
    ...nodes.map((n) => ({ id: n.id, ...abs[n.id] })),
    ...groups.map((g) => ({ id: `${g.id}:title`, x: abs[g.id].x, y: abs[g.id].y, w: Math.min(abs[g.id].w, headers[g.id].width), h: headers[g.id].height, pad: 2 })),
  ];
  wire(m, abs, spec.edges ?? [], { obstacles, groupIds: new Set(groups.map((g) => g.id)), corners: new Set(nodes.filter((n) => n.kind === "decision").map((n) => n.id)) });
  return m;
}

function nodeTop(d, cellH, mid) {
  if (d.k.align === "top") return 0;
  if (mid !== null && mid - d.h / 2 >= 0 && mid + d.h / 2 <= cellH) return mid - d.h / 2;
  return (cellH - d.h) / 2;
}
