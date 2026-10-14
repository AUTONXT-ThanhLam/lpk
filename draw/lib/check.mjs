/**
 * Geometric facts about a laid-out diagram that a reader would trip on: boxes overlapping, an
 * arrow running through a box it does not connect, a label sitting on a box or on another label,
 * crossing arrows, and the overall size. Each fact names the shapes; the author decides.
 */
const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
const overlap = (a, b, pad = 0) => a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h;

export function segHitsBox([x1, y1], [x2, y2], b, pad = 3) {
  const r = { x: b.x + pad, y: b.y + pad, w: b.w - 2 * pad, h: b.h - 2 * pad };
  if (r.w <= 0 || r.h <= 0) return false;
  if (y1 === y2) return y1 > r.y && y1 < r.y + r.h && Math.max(x1, x2) > r.x && Math.min(x1, x2) < r.x + r.w;
  if (x1 === x2) return x1 > r.x && x1 < r.x + r.w && Math.max(y1, y2) > r.y && Math.min(y1, y2) < r.y + r.h;
  // a diagonal: sample it
  for (let t = 0; t <= 1; t += 0.02) {
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
}

export function segsCross([a1, b1], [a2, b2]) {
  const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(a2, b2, a1), d2 = d(a2, b2, b1), d3 = d(a1, b1, a2), d4 = d(a1, b1, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function check(model, { maxWidth = 1600 } = {}) {
  const facts = [...(model.facts ?? [])];
  const m = { ...model, byId: (id) => model.byId(id), bounds: () => model.bounds(), edges: model.edges.filter((e) => e.role === "edge" && e.source) };
  const name = (s) => (!s ? "the joined arrow" : s.value ? String(s.value).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : s.id);
  const solid = m.shapes.filter((s) => s.role === "node" || s.role === "group");
  const ancestors = (id) => { const out = []; let s = m.byId(id); while (s?.parent) { out.push(s.parent); s = m.byId(s.parent); } return out; };

  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if ((b.role === "group" && inside(a, b)) || (a.role === "group" && inside(b, a))) continue;
    if (overlap(a, b, 1)) facts.push(`overlap: "${name(a)}" and "${name(b)}"`);
  }
  for (const e of m.edges) {
    const allowed = new Set([e.source, e.target, ...ancestors(e.source), ...ancestors(e.target)]);
    for (const s of solid) {
      if (allowed.has(s.id)) continue;
      // An arrow may run inside a group that holds one of its ends' groups, never through a box.
      if (s.role === "group" && e.points.every(([x, y]) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)) continue;
      const segs = e.points.slice(1).map((p, k) => [e.points[k], p]);
      if (s.role === "node" && segs.some(([p, q]) => segHitsBox(p, q, s))) facts.push(`arrow through box: ${name(m.byId(e.source))} -> ${name(m.byId(e.target))} crosses "${name(s)}"`);
    }
  }
  for (const g of solid.filter((s) => s.header)) {
    const head = { x: g.x + 8, y: g.y + 4, w: Math.min(g.w, g.headerW ?? g.w) - 16, h: g.header - 6 };
    for (const e of m.edges) {
      const segs = e.points.slice(1).map((p, k) => [e.points[k], p]);
      if (segs.some(([p, q]) => segHitsBox(p, q, head, 0))) facts.push(`arrow over group title: ${name(m.byId(e.source))} -> ${name(m.byId(e.target))} crosses the title of "${name(g)}"`);
    }
  }
  const labels = m.shapes.filter((s) => s.role === "label");
  for (const l of labels) {
    for (const s of m.shapes.filter((x) => x.role === "node" || x.role === "chip" || x.role === "text")) if (overlap(l, s, 1)) facts.push(`label on box: "${name(l)}" on "${name(s)}"`);
    for (const o of labels) if (o !== l && o.id < l.id && overlap(l, o, 1)) facts.push(`labels overlap: "${name(l)}" and "${name(o)}"`);
  }
  let crossings = 0;
  const segsOf = (e) => e.points.slice(1).map((p, k) => [e.points[k], p]);
  for (let i = 0; i < m.edges.length; i++) for (let j = i + 1; j < m.edges.length; j++) {
    for (const s1 of segsOf(m.edges[i])) for (const s2 of segsOf(m.edges[j])) if (segsCross(s1, s2)) crossings++;
  }
  const b = m.bounds();
  // The counts the reading rules are about; whether they fit the message is the author's call.
  const tones = [...new Set([...(model.tones ?? []), ...(model.lineTones ?? [])])].filter((t) => !["grey", "neutral", "main", "blue"].includes(t));
  const boxes = solid.filter((s) => s.role === "node").length;
  const counts = !boxes && !m.edges.length ? "" : `${boxes} boxes, ${tones.length} tone${tones.length === 1 ? "" : "s"} beside grey and the main path${tones.length ? ` (${tones.join(", ")})` : ""}`;
  const out = { size: `${Math.round(b.w)} x ${Math.round(b.h)} px`, crossings, facts, counts };
  if (crossings) facts.push(`${crossings} arrow crossing${crossings === 1 ? "" : "s"}: move a box, put an arrow's ends in one row or pin a side until none cross`);
  if (b.w > maxWidth) facts.push(`wider than ${maxWidth} px: a page shrinks it until 12 px text reads at ${((12 * maxWidth) / b.w).toFixed(1)} px; split it, or use fewer columns (an auto graph: "direction": "DOWN")`);
  return out;
}

/** How many times the arrow `pts` crosses the others in `all`. */
export function crossingsOf(pts, all) {
  let n = 0;
  const segs = (p) => p.slice(1).map((q, k) => [p[k], q]);
  for (const other of all) if (other !== pts) for (const a of segs(pts)) for (const b of segs(other)) if (segsCross(a, b)) n++;
  return n;
}
