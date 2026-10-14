import { C, EDGE, TONES, esc, textWidth } from "./style.mjs";
import { Model } from "./model.mjs";
import { check } from "./check.mjs";
import { noteEdgeTone } from "./legend.mjs";
import graph from "./graph.mjs";
import { P, block, cable, faceName, facesOf, flatIcon, hull, inPoly, labelFacts, labelsOverlap, linePill, stencil } from "./iso.mjs";

const SLAB = 26, TILE = 8, DEVICE = 18, FLOAT = 170;
const TILE_FACES = { top: "#ffffff", s1: "#ececf0", s2: "#dedee3", line: "#8a8a92" };
const SLAB_FACES = { top: "#fbfbfc", s1: "#f0f0f2", s2: "#e3e3e7", line: "#2b2b2f", sw: 1.2 };

/**
 * A graph seen from above at an angle (`"view": "iso"`): it is laid out flat as usual, then
 * turned so the start of the flow faces the viewer and raised. A top-level group is a slab, a
 * node in it a tile on the slab, a node in no group a block on the ground, a `float` node a
 * panel above. Arrows run on the surfaces, down a slab's side to the ground and up again.
 */
export default async function isograph(spec) {
  const groups = spec.groups ?? [], nodes = spec.nodes ?? [], edges = spec.edges ?? [];
  // Blocks on the ground and panels keep their own size; tiles fill their column, so they line up.
  // Parts are deeper than flat boxes, so arrows meeting one side keep apart once it is turned.
  // A placed plan leaves room between two parts on one level for the widest label joining them.
  const lvl = (id) => { const n = nodes.find((x) => x.id === id); return !n || n.float ? null : n.in ? "inner" : "top"; };
  const room = (k) => Math.max(0, ...edges.filter((e) => e.label && lvl(e.from) === k && lvl(e.to) === k).map((e) => textWidth(e.label, 11) + 66));
  const minGap = { inner: room("inner"), top: room("top") };
  const plan = await graph({ ...spec, view: undefined, title: undefined, minGap, nodes: nodes.map((n) => ({ ...n, minHeight: n.float ? 44 : 78, ...(n.in && !n.float ? {} : { stretch: false }) })) });
  const m = new Model(spec.title ?? "diagram");
  m.painter = true;
  m.facts.push(...check(plan).facts.filter((f) => !f.startsWith("wider than")));
  const placed = [...groups, ...nodes].some((x) => "row" in x || "col" in x);
  const down = !placed && spec.direction === "DOWN";
  const B = plan.bounds();
  // Turned a quarter: the flow's start (left, or top going down) comes to the front-left face.
  const map = ([px, py]) => (down ? [B.y + B.h - py, px - B.x] : [py - B.y, B.x + B.w - px]);
  const boxOf = (id) => {
    const s = plan.byId(id), [a, b] = [map([s.x, s.y]), map([s.x + s.w, s.y + s.h])];
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), d: Math.abs(a[1] - b[1]) };
  };
  const byId = Object.fromEntries([...groups, ...nodes].map((x) => [x.id, x]));
  const topOf = (id) => { let x = byId[id]; while (x?.in) x = byId[x.in]; return x && x.id !== id ? x.id : null; };

  const slabs = groups.filter((g) => !g.in).map((g) => ({ g, ...boxOf(g.id) }));
  const slabOf = Object.fromEntries(slabs.map((s) => [s.g.id, s]));
  for (const g of groups) if (g.tone && g.tone !== "neutral") m.tones.add(g.tone);
  const part = {};
  for (const n of nodes) {
    const b = boxOf(n.id), top = topOf(n.id);
    if (n.tone && n.tone !== "neutral") m.tones.add(n.tone);
    part[n.id] = n.float ? { n, ...b, z: (top ? SLAB : 0) + FLOAT, t: 0, kind: "float" }
      : top ? { n, ...b, z: SLAB, t: TILE, kind: "tile", slab: top } : { n, ...b, z: 0, t: DEVICE, kind: "device" };
  }
  for (const e of edges) if ([part[e.from], part[e.to]].some((p) => p?.kind === "float") && ![part[e.from], part[e.to]].some((p) => p && p.kind !== "float"))
    throw new Error(`edge ${e.from} -> ${e.to}: a floating panel joins a part on a slab or the ground, not a group or another panel`);
  // A panel hovers over the part it joins, its front edge right above a point on that part's
  // top clear of the name, so the link is a short vertical line ending on the panel's edge.
  const foot = (p) => (p.d >= p.w ? [p.x + p.w - 12, p.y + 14] : [p.x + 14, p.y + 12]);
  for (const f of Object.values(part).filter((p) => p.kind === "float")) {
    const e = edges.find((e) => (e.from === f.n.id || e.to === f.n.id) && part[e.from === f.n.id ? e.to : e.from]?.kind !== "float");
    if (!e) continue;
    const o = part[e.from === f.n.id ? e.to : e.from], [fx, fy] = foot(o);
    Object.assign(f, { x: fx - f.w / 2, y: fy - f.d, z: o.z + o.t + FLOAT - SLAB });
  }
  const surface = (x, y) => (slabs.some((s) => inside(s, x, y)) ? SLAB : 0);

  // Each arrow in plan, matched to its spec edge, raised onto the surfaces it crosses.
  const used = new Set();
  const routes = plan.edges.filter((e) => e.role === "edge").map((pe) => {
    const k = edges.findIndex((e, i) => !used.has(i) && e.from === pe.source && (pe.target === null || e.to === pe.target));
    used.add(k);
    const e = edges[k], a = part[e.from], b = part[e.to];
    let pts;
    const back = [];
    if (a?.kind === "float" || b?.kind === "float") {
      // To a panel above: straight up from the other part's top to the panel's front edge.
      const [f, o] = a.kind === "float" ? [a, b] : [b, a], at = foot(o);
      pts = [[...at, o.z + o.t], [...at, f.z]];
      if (f === a) pts.reverse();
    } else {
      const blocks = Object.values(part).filter((p) => p.kind === "device");
      const flat = onFloor(onFloor(pe.points.map(map), slabs, blocks).reverse(), slabs, blocks).reverse();
      pts = [];
      flat.forEach(([x, y], i) => {
        if (i) {
          const [px, py] = flat[i - 1];
          for (const s of slabs) if (inside(s, px, py) !== inside(s, x, y)) {
            // Where it crosses a slab's edge it climbs or drops that side; a back side is hidden.
            const at = edgeCross(s, [px, py], [x, y], inside);
            if (at[0] <= s.x + 1 || at[1] <= s.y + 1) back.push(pts.length);
            const [z1, z2] = inside(s, px, py) ? [SLAB, 0] : [0, SLAB];
            pts.push([...at, z1], [...at, z2]);
          }
        }
        pts.push([x, y, surface(x, y)]);
      });
      // An end on a side the reader cannot see stops where the line meets the part's outline,
      // as an arrow meets a box on a flat picture; on a side they see it plugs into the foot.
      if (b) pts = clip(pts, b);
      if (a) { const n = pts.length; pts = clip(pts.reverse(), a).reverse(); back.forEach((v, i) => { back[i] = v - (n - pts.length); }); }
    }
    const tone = e.tone ?? (e.main ? "main" : "grey");
    noteEdgeTone(m, tone);
    return { e, pts, tone, pieces: pieces(pts, back, slabs) };
  });
  const all = routes.flatMap((r) => r.pieces.map((q) => ({ ...q, r })));
  const drawCable = (q) => cable(m, q.pts, { main: q.r.tone === "main", color: EDGE[q.r.tone] ?? C.line,
    dashed: Boolean(q.r.e.dashed), arrow: q.last, both: Boolean(q.r.e.both) && q.first });

  // Back to front: arrow pieces hidden behind a slab, then slabs and ground blocks by depth,
  // each slab with its tiles and the pieces on its top, then pieces on the ground, panels, names.
  for (const q of all.filter((q) => q.behind)) drawCable(q);
  const depth = (b) => b.x + b.w / 2 + b.y + b.d / 2;
  const names = [];
  const solids = [...slabs.map((s) => ({ ...s, slab: true })), ...Object.values(part).filter((p) => p.kind === "device")].sort((a, b) => depth(a) - depth(b));
  for (const s of solids) {
    if (!s.slab) { drawPart(m, s, names); continue; }
    const f = facesOf(s.g, SLAB_FACES);
    shadow(m, s);
    block(m, { ...s, z: 0, t: SLAB }, { ...f, line: SLAB_FACES.line, sw: 1.2 });
    const grid = [];
    for (let k = 20; k < s.w; k += 20) grid.push({ pts: [P(s.x + k, s.y, SLAB), P(s.x + k, s.y + s.d, SLAB)], stroke: "#e6e6ea", sw: 0.6, open: true });
    for (let k = 20; k < s.d; k += 20) grid.push({ pts: [P(s.x, s.y + k, SLAB), P(s.x + s.w, s.y + k, SLAB)], stroke: "#e6e6ea", sw: 0.6, open: true });
    if (grid.length) stencil(m, grid);
    for (const g of groups.filter((x) => x.in && topOf(x.id) === s.g.id)) region(m, g, boxOf(g.id), names);
    for (const q of all.filter((q) => q.slab?.g === s.g)) drawCable(q);
    for (const p of Object.values(part).filter((p) => p.slab === s.g.id && p.kind === "tile").sort((a, b) => depth(a) - depth(b))) drawPart(m, p, names);
  }
  for (const q of all.filter((q) => q.ground && !q.behind)) drawCable(q);
  for (const p of Object.values(part).filter((p) => p.kind === "float").sort((a, b) => depth(a) - depth(b))) drawPart(m, p, names);
  for (const q of all.filter((q) => q.up)) drawCable(q);
  const hulls = Object.values(part).map(hull);
  for (const r of routes.filter((r) => r.e.label)) {
    const segs = r.pieces.filter((q) => !q.behind).flatMap((q) => q.pts.slice(1).map((b, k) => [P(...q.pts[k]), P(...b)]));
    linePill(m, segs, r.e.label, r.tone === "main" || r.tone === "grey" ? C.grey : TONES[r.tone]?.text ?? EDGE[r.tone] ?? C.grey, hulls);
  }
  // Slab names last, so each finds a side clear of the arrows and labels already drawn.
  for (const s of slabs) slabTitle(m, s, names);
  for (const f of names) if (f) m.facts.push(f);
  m.facts.push(...labelFacts(m));
  return m;
}

/**
 * An arrow cut where it climbs onto a slab: a piece on a slab's top paints with that slab, a
 * piece on the ground with its climbs paints before the slabs when a climb is on a hidden side,
 * else after them; a piece rising to a panel paints after the panels below it.
 */
function pieces(pts, back, slabs) {
  if (pts.some((p) => p[2] > SLAB)) return [{ pts, up: true, first: true, last: true }];
  const cut = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, r] = [pts[i - 1], pts[i], pts[i + 1]];
    const climb = (u, v) => u[0] === v[0] && u[1] === v[1] && u[2] !== v[2];
    if (q[2] === SLAB && (climb(p, q) || climb(q, r))) cut.push(i);
  }
  cut.push(pts.length - 1);
  const out = [];
  for (let k = 0; k + 1 < cut.length; k++) {
    const [i, j] = [cut[k], cut[k + 1]], seg = pts.slice(i, j + 1);
    const top = seg.every((p) => p[2] === SLAB);
    const mid = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2];
    const slab = top ? slabs.find((s) => mid[0] >= s.x && mid[0] <= s.x + s.w && mid[1] >= s.y && mid[1] <= s.y + s.d) : null;
    out.push({ pts: seg, slab, ground: !top, behind: !top && back.some((b) => b >= i && b < j), first: i === 0, last: j === pts.length - 1 });
  }
  return out;
}

/**
 * A route that runs along a slab's side just outside it reads, once turned, as a rail drawn on
 * that side; it is moved out onto the floor, AWAY px from the side, when nothing stands there.
 * Applied to a route and to its reverse, so both ends get the same treatment.
 */
function onFloor(flat, slabs, solids) {
  const AWAY = 40, pts = flat.map((p) => [...p]);
  for (let i = 2; i + 1 < pts.length; i++) for (const s of slabs) {
    const [a, q, e, n] = [pts[i - 2], pts[i - 1], pts[i], pts[i + 1]];
    if (inside(s, ...e) || !inside(s, ...n)) continue;
    const side = [[1, e[1] - s.y - s.d, s.y + s.d + AWAY], [1, s.y - e[1], s.y - AWAY], [0, e[0] - s.x - s.w, s.x + s.w + AWAY], [0, s.x - e[0], s.x - AWAY]]
      .find(([k, g]) => g > 0 && g < AWAY && q[k] === e[k] && a[1 - k] === q[1 - k] && Math.abs(q[1 - k] - e[1 - k]) > 3 * g);
    if (!side) continue;
    const [k, , at] = side;
    // The run must not turn back on the segment that brings it, nor cross a block or a slab.
    if (Math.abs(a[k] - q[k]) < Math.abs(at - q[k]) + 8 || Math.sign(a[k] - q[k]) !== Math.sign(at - q[k])) continue;
    const lo = Math.min(q[1 - k], e[1 - k]), hi = Math.max(q[1 - k], e[1 - k]);
    const box = k ? { x: lo, y: Math.min(at, e[1]), w: hi - lo, d: Math.abs(at - e[1]) } : { x: Math.min(at, e[0]), y: lo, w: Math.abs(at - e[0]), d: hi - lo };
    if ([...solids, ...slabs.filter((o) => o !== s)].some((t) => t.x < box.x + box.w && box.x < t.x + t.w && t.y < box.y + box.d && box.y < t.y + t.d)) continue;
    q[k] = e[k] = at;
  }
  return pts;
}
const inside = (s, x, y) => x > s.x + 0.5 && x < s.x + s.w - 0.5 && y > s.y + 0.5 && y < s.y + s.d - 0.5;

/** The route cut where it first enters part p's outline on screen, when it ends on a hidden side. */
function clip(pts, p) {
  const [x, y] = pts.at(-1);
  if (p.kind === "float" || (x >= p.x + p.w - 1 || y >= p.y + p.d - 1)) return pts;
  const h = hull(p), inHull = (q) => inPoly(h, P(...q));
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let i = pts.length - 1; i > 0; i--) {
    const [a, b] = [pts[i - 1], pts[i]];
    if (inHull(a)) continue;
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (inHull(lerp(a, b, mid))) hi = mid; else lo = mid; }
    return [...pts.slice(0, i), lerp(a, b, lo)];
  }
  return pts;
}

/** The point where segment a-b crosses the border of slab s, snapped onto that border. */
function edgeCross(s, a, b, inside) {
  let [lo, hi] = [0, 1];
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const start = inside(s, ...a);
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (inside(s, ...at(mid)) === start) lo = mid; else hi = mid; }
  const [x, y] = at((lo + hi) / 2), snap = (v, e1, e2) => (Math.abs(v - e1) < 1.5 ? e1 : Math.abs(v - e2) < 1.5 ? e2 : v);
  return [snap(x, s.x, s.x + s.w), snap(y, s.y, s.y + s.d)];
}

/** A tile, ground block or panel with its icon and name on its top face. */
function drawPart(m, p, facts) {
  const n = p.n, f = facesOf(n, p.kind === "float" ? { top: "#ffffff", s1: "#ffffff", s2: "#ffffff", line: "#7d6ff0" } : TILE_FACES);
  if (p.kind === "device") shadow(m, p);
  block(m, p, f, f.dashed ? "dashed=1;" : "");
  const along = p.d >= p.w ? "y" : "x", long = Math.max(p.w, p.d), short = Math.min(p.w, p.d), z = p.z + p.t;
  const iconRoom = n.icon ? 32 : 0;
  if (n.icon) flatIcon(m, n.icon, along === "y" ? [p.x + p.w / 2, p.y + p.d - 18, z] : [p.x + 18, p.y + p.d / 2, z], 22, f.line === TILE_FACES.line ? C.ink : f.line, along);
  const c = along === "y" ? [p.x + p.w / 2, p.y + (p.d - iconRoom) / 2, z] : [p.x + iconRoom + (p.w - iconRoom) / 2, p.y + p.d / 2, z];
  const title = n.title ?? "", desc = n.desc ? `<br><span style="font-weight:400;font-size:11px;color:${f.text === C.ink ? C.grey : f.text}">${esc(n.desc)}</span>` : "";
  facts.push(faceName(m, `${esc(title)}${desc}`, title, c, along, long - iconRoom - 14, short - 8 - (n.desc ? 15 : 0), { color: f.text ?? C.ink, who: `its ${p.kind === "tile" ? "tile" : p.kind === "float" ? "panel" : "block"}` }));
}

/** A soft shadow on the ground under a slab, block or panel, offset towards the viewer. */
function shadow(m, b) {
  const o = 8, z = 0;
  stencil(m, [{ pts: [P(b.x + o, b.y + o, z), P(b.x + b.w + o, b.y + o, z), P(b.x + b.w + o, b.y + b.d + o, z), P(b.x + o, b.y + b.d + o, z)], fill: "#e4e4e8" }], { extra: "opacity=55;" });
}

/** A group inside a slab: a tinted area on the slab's top with its name along its back edge. */
function region(m, g, b, facts) {
  const f = facesOf(g, { top: "#f1f1f4", line: "#d7d7dd" });
  stencil(m, [{ pts: [P(b.x, b.y, SLAB), P(b.x + b.w, b.y, SLAB), P(b.x + b.w, b.y + b.d, SLAB), P(b.x, b.y + b.d, SLAB)], fill: f.top, stroke: f.line }], { extra: f.dashed ? "dashed=1;" : "" });
  const t = g.title ?? "";
  if (t) facts.push(faceName(m, esc(t), t, [b.x + 14, b.y + b.d / 2, SLAB], "y", b.d - 20, 30, { size: 12, color: f.text ?? C.grey, who: `the group "${t}"` }));
}

/** A slab's name on a side face the reader sees, clear of every arrow and label drawn in front of it. */
function slabTitle(m, s, facts) {
  const t = s.g.title ?? "", sub = s.g.sub ?? "";
  if (!t) return;
  const plain = sub ? `→ ${t}  ${sub}` : `→ ${t}`, w = textWidth(plain, 15, { bold: true }) + 12;
  const html = `→ ${esc(t)}${sub ? `&nbsp;&nbsp;<span style="color:${C.soft};font-weight:400">${esc(sub)}</span>` : ""}`;
  const lines = m.edges.filter((e) => e.role === "cable").flatMap((e) => e.points.slice(1).map((p, k) => [e.points[k], p]));
  // Front-left face (at the far y, text along x), then front-right face (at the far x, along y).
  for (const [along, len, at] of [["x", s.w, (u) => [s.x + u, s.y + s.d]], ["y", s.d, (u) => [s.x + s.w, s.y + s.d - u]]]) {
    for (let k = 1; k < 10; k++) {
      const u = (len * k) / 10;
      if (u - w / 2 < 8 || u + w / 2 > len - 8) continue;
      const [px, py] = P(...at(u), SLAB / 2);
      const box = { x: px - w / 2, y: py - 11, w, h: 22, rot: along === "x" ? 30 : -30 };
      if (m.shapes.some((l) => (l.role === "label" || l.role === "iso-name") && labelsOverlap(box, l))) continue;
      if (lines.some(([a, b]) => segmentHits(a, b, box))) continue;
      const cell = m.shape({ ...box, value: html, role: "iso-name",
        style: `text;html=1;whiteSpace=nowrap;align=center;verticalAlign=middle;fontSize=15;fontStyle=1;fontColor=${C.ink};rotation=${box.rot};` });
      cell.rot = box.rot;
      return;
    }
  }
  facts.push(`the name of "${t}" finds no side clear of arrows: widen the group, move what joins it, or shorten its name`);
}

/** True when segment a-b passes through the (rotated) rectangle r. */
function segmentHits(a, b, r) {
  const t = (r.rot * Math.PI) / 180, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  for (let k = 0; k <= 40; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / 40 - cx, y = a[1] + ((b[1] - a[1]) * k) / 40 - cy;
    const u = x * Math.cos(t) + y * Math.sin(t), v = -x * Math.sin(t) + y * Math.cos(t);
    if (Math.abs(u) < r.w / 2 && Math.abs(v) < r.h / 2) return true;
  }
  return false;
}
