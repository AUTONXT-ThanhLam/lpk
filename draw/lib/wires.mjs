import { EDGE, SMALL, esc, textWidth } from "./style.mjs";
import { S, edgeTone } from "./model.mjs";
import { router } from "./route.mjs";
import { crossingsOf, segHitsBox } from "./check.mjs";
import { noteEdgeTone } from "./legend.mjs";

const EDGE_GAP = 14, PORT_GAP = 20;

/**
 * Routes the spec's arrows between boxes already placed (`abs`: id -> box) and draws them with
 * their labels. Pass 1 picks each arrow's sides on the bare layout. Ports are then set along each
 * side, busiest sides first: each arrow aims at the point it would reach running straight (or the
 * side's middle when it turns into the other box's top or bottom), and
 * arrows on one side keep their order and a 20 px gap. Pass 2 routes with those ports, and an
 * arrow that still crosses others is routed again over the rest, kept when it crosses less.
 */
/** A side spelled wrong would be ignored or crash the router: refuse it by name. */
export function checkSides(edges) {
  for (const e of edges) for (const k of ["fromSide", "toSide"]) if (e[k] !== undefined && !["top", "right", "bottom", "left"].includes(e[k])) throw new Error(`edge ${e.from} -> ${e.to}: ${k} "${e[k]}" is not one of top, right, bottom, left`);
}

export function wire(m, abs, edges, { obstacles, groupIds = new Set(), corners = new Set() }) {
  for (const e of edges) for (const end of [e.from, e.to]) if (!abs[end]) throw new Error(`edge ${e.from} -> ${e.to}: unknown id "${end}"`);
  checkSides(edges);
  const route = router(obstacles, m.bounds());
  const boxOf = (id) => ({ id, ...abs[id], pad: groupIds.has(id) ? 2 : 6 });
  const order = [...edges.keys()].sort((a, b) => Number(Boolean(edges[b].main)) - Number(Boolean(edges[a].main)));
  const sides = (e) => (e.from === e.to ? { from: e.fromSide ?? "right", to: e.toSide ?? "top" } : { from: e.fromSide, to: e.toSide });
  const first = {};
  for (const i of order) first[i] = route(boxOf(edges[i].from), boxOf(edges[i].to), { ...sides(edges[i]), alone: true });

  const pos = ports(abs, edges, first, corners);
  // The result depends on the order arrows are routed in, so try several orders and keep the
  // layout with the fewest crossings, then the fewest bends, then the shortest.
  let best = null;
  for (const tryOrder of orders(order, edges, abs)) {
    const r = attempt(tryOrder, first, pos, edges, obstacles, m.bounds(), boxOf);
    if (!best || r.score < best.score) best = r;
  }
  const routes = best.routes;
  for (const [i, r] of Object.entries(routes)) if (r && !corners.has(edges[i].from) && !corners.has(edges[i].to)) r.points = straighten(r.points, abs[edges[i].from], abs[edges[i].to]);
  fanOut(routes, edges, abs, obstacles);
  const lines = Object.values(routes).filter(Boolean).map((r) => r.points);
  const placed = [];
  // Main arrows are drawn last, so where arrows share a trunk the blue path stays on top.
  const drawOrder = [...edges.keys()].sort((a, b) => Number(Boolean(edges[a].main)) - Number(Boolean(edges[b].main)));
  drawOrder.forEach((i) => {
    const e = edges[i];
    const r = routes[i];
    if (!r) { m.facts.push(`no route found for ${e.from} -> ${e.to}: leave more room between them`); return; }
    const tone = edgeTone(e);
    noteEdgeTone(m, tone);
    m.edge({ source: e.from, target: e.to, points: r.points, style: S.edge(tone, e) });
    if (e.label) {
      const others = lines.filter((p) => p !== r.points);
      // On a shared trunk the label belongs on the branch's own part, unless that part has no free spot.
      let [box, score] = labelBox(r.own?.length > 1 ? r.own : r.points, e.label, m.shapes, placed, others);
      if (r.own && score >= 50) { const [b2, s2] = labelBox(r.points, e.label, m.shapes, placed, others); if (s2 < score) box = b2; }
      placed.push(box);
      m.shape({ ...box, value: esc(e.label), style: S.label(EDGE[tone]), role: "label" });
    }
  });
}

function attempt(order, first, pos, edges, obstacles, bounds, boxOf) {
  const route = router(obstacles, bounds);
  const routes = {};
  const opts = (i, r) => ({ from: r.from, to: r.to, fromAt: pos.get(`${i}:from`), toAt: pos.get(`${i}:to`) });
  for (const i of order) if (first[i]) routes[i] = route(boxOf(edges[i].from), boxOf(edges[i].to), opts(i, first[i]));
  const all = () => Object.values(routes).filter(Boolean).map((r) => r.points);
  for (let round = 0; round < 2; round++) {
    let better = false;
    for (const i of order) {
      const r = routes[i];
      if (!r) continue;
      const before = crossingsOf(r.points, all());
      if (!before) continue;
      route.lift(r);
      const again = route(boxOf(edges[i].from), boxOf(edges[i].to), opts(i, r));
      if (again && crossingsOf(again.points, all().filter((p) => p !== r.points)) < before) { routes[i] = again; better = true; }
      else { if (again) route.lift(again); route.drop(r); }
    }
    if (!better) break;
  }
  const pts = all();
  const crossings = pts.reduce((t, p) => t + crossingsOf(p, pts), 0) / 2;
  const bends = pts.reduce((t, p) => t + p.length - 2, 0);
  const length = pts.reduce((t, p) => t + p.slice(1).reduce((a, q, k) => a + Math.abs(q[0] - p[k][0]) + Math.abs(q[1] - p[k][1]), 0), 0);
  const missing = Object.keys(first).filter((i) => first[i] && !routes[i]).length;
  return { routes, crossings, score: missing * 1e6 + crossings * 1000 + bends * 10 + length / 8 };
}

/** Routing orders to try: main arrows first as given, then by length both ways, then shuffles with a fixed seed. */
function* orders(order, edges, abs) {
  const span = (i) => { const a = abs[edges[i].from], b = abs[edges[i].to]; return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); };
  const mainFirst = (list) => [...list].sort((a, b) => Number(Boolean(edges[b].main)) - Number(Boolean(edges[a].main)));
  yield order;
  yield mainFirst([...order].reverse());
  yield mainFirst([...order].sort((a, b) => span(a) - span(b)));
  yield mainFirst([...order].sort((a, b) => span(b) - span(a)));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 12; k++) yield mainFirst([...order].sort(() => rand() - 0.5));
}

/** Port positions (`<edge>:from|to` -> coordinate along the side), busiest sides first; `corners` are diamonds. */
function ports(abs, edges, first, corners) {
  const vertical = (side) => side === "left" || side === "right";
  const centre = (id, side) => (vertical(side) ? abs[id].y + abs[id].h / 2 : abs[id].x + abs[id].w / 2);
  const bySide = new Map();
  for (const [i, r] of Object.entries(first)) {
    if (!r) continue;
    const e = edges[i];
    for (const [end, id, other, side, otherSide] of [["from", e.from, e.to, r.from, r.to], ["to", e.to, e.from, r.to, r.from]]) {
      const key = `${id}:${side}`;
      bySide.set(key, [...(bySide.get(key) ?? []), { i, end, id, other, side, otherEnd: end === "from" ? "to" : "from", turns: vertical(side) !== vertical(otherSide) }]);
    }
  }
  const pos = new Map();
  for (const list of [...bySide.values()].sort((a, b) => b.length - a.length)) {
    const { id, side } = list[0], b = abs[id];
    // A diamond is joined at the corner in the middle of each side, never at its empty bounding box.
    if (corners.has(id)) { for (const x of list) pos.set(`${x.i}:${x.end}`, centre(id, side)); continue; }
    let [lo, hi] = vertical(side) ? [b.y + EDGE_GAP, b.y + b.h - EDGE_GAP] : [b.x + EDGE_GAP, b.x + b.w - EDGE_GAP];
    if (hi < lo) lo = hi = centre(id, side); // a start or end dot is joined at its middle
    // Facing sides aim at the other end, so the arrow runs straight; an arrow that turns once
    // (right side into a top) leaves from the middle, so the turn has room on both legs.
    const aim = (x) => (x.turns ? centre(id, side) : pos.get(`${x.i}:${x.otherEnd}`) ?? centre(x.other, side));
    const want = list.map((x) => ({ x, at: Math.min(hi, Math.max(lo, aim(x))) }));
    want.sort((a, b2) => a.at - b2.at);
    const gap = want.length > 1 ? Math.min(PORT_GAP, (hi - lo) / (want.length - 1)) : 0;
    for (let k = 1; k < want.length; k++) want[k].at = Math.max(want[k].at, want[k - 1].at + gap);
    for (let k = want.length - 1; k >= 0; k--) want[k].at = Math.min(want[k].at, k === want.length - 1 ? hi : want[k + 1].at - gap);
    for (let k = 0; k < want.length; k++) want[k].at = Math.max(want[k].at, k ? want[k - 1].at + gap : lo);
    for (const w of want) pos.set(`${w.x.i}:${w.x.end}`, w.at);
  }
  return pos;
}

/**
 * Arrows that leave one side of a box for several boxes share one trunk: they start at the
 * side's middle and split at the bend nearest the box, as a tree does, instead of each taking
 * its own channel. Kept only when no shared piece runs through another box or a group title and
 * the trunk crosses no more arrows than the branches did.
 */
function fanOut(routes, edges, abs, obstacles) {
  // Only arrows that mean the same share a trunk: plain grey ones may join the blue path, but an
  // orange cancel, a dashed call or a two-way arrow branching off it would read as part of it.
  const kind = (e) => `${e.dashed ? "dashed" : "solid"}:${e.both ? "both" : "one"}:${["main", "grey", "neutral", "blue"].includes(edgeTone(e)) ? "plain" : edgeTone(e)}`;
  const bySide = new Map();
  for (const [i, r] of Object.entries(routes)) if (r) { const key = `${edges[i].from}|${r.from}|${kind(edges[i])}`; bySide.set(key, [...(bySide.get(key) ?? []), i]); }
  for (const [key, list] of bySide) {
    const [id, side] = key.split("|"), b = abs[id], flat = side === "left" || side === "right";
    if (list.length < 2 || Object.entries(routes).some(([i, r]) => r && ((edges[i].to === id && r.to === side) || (edges[i].from === id && r.from === side && !list.includes(i))))) continue;
    // Work in (along, across): along leaves the side, across runs beside it.
    const toLA = ([x, y]) => (flat ? [x, y] : [y, x]), fromLA = ([a, c]) => (flat ? [a, c] : [c, a]);
    const out = side === "right" || side === "bottom" ? 1 : -1;
    const pts = list.map((i) => routes[i].points.map(toLA));
    // The trunk starts where a straight branch already leaves (its target port is set for it), else mid-side.
    const start = pts.find((p) => p.length === 2)?.[0] ?? toLA(flat ? [side === "right" ? b.x + b.w : b.x, b.y + b.h / 2] : [b.x + b.w / 2, side === "bottom" ? b.y + b.h : b.y]);
    const bends = pts.filter((p) => p.length >= 3 && p[0][1] === p[1][1]).map((p) => p[1][0]);
    if (!bends.length) continue;
    const last = out > 0 ? Math.min(...bends) : Math.max(...bends);
    // Split as near the box as the boxes around allow, so each branch is long enough for its label.
    const splits = [];
    for (let at = start[0] + out * 24; (last - at) * out > 0; at += out * 16) splits.push(at);
    if ((last - start[0]) * out >= 12) splits.push(last);
    splits.find(tryTrunk);
    function tryTrunk(split) {
      const next = pts.map((p) => {
        const end = p.length >= 3 && p[0][1] === p[1][1] ? p.slice(2) : [p.at(-1)];
        if (end[0] && (end[0][0] - split) * out < 0) return null;
        const q = tidy([start, [split, start[1]], [split, end[0][1]], ...end]);
        // The branch must still enter its target the way it did, not slide along the target's edge.
        const dir = (a, c) => [Math.sign(c[0] - a[0]), Math.sign(c[1] - a[1])].join();
        return dir(...q.slice(-2)) === dir(...p.slice(-2)) ? q.map(fromLA) : null;
      });
      // A label goes on the branch's own part, after the split, never on the shared trunk.
      const own = pts.map((p) => { const end = p.length >= 3 && p[0][1] === p[1][1] ? p.slice(2) : [p.at(-1)]; return tidy([[split, end[0][1]], ...end]).map(fromLA); });
      const clear = next.every((p, k) => p && p.slice(1).every((q, j) => obstacles.every((o) => o.id === id || o.id === edges[list[k]].to || !segHitsBox(p[j], q, o, 2))));
      if (!clear) return false;
      const others = Object.entries(routes).filter(([i, r]) => r && !list.includes(i)).map(([, r]) => r.points);
      const crossing = (lines) => lines.reduce((t, p) => t + crossingsOf(p, others), 0);
      if (crossing(next) > crossing(list.map((i) => routes[i].points))) return false;
      list.forEach((i, k) => Object.assign(routes[i], { points: next[k], own: own[k] }));
      return true;
    }
  }
}

/** Drops repeated points and the middle of three in a line. */
function tidy(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length >= 2) { const [a, b] = out.slice(-2); if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop(); }
    out.push(p);
  }
  return out;
}

const segBox = ([x1, y1], [x2, y2]) => ({ x: Math.min(x1, x2) - 1, y: Math.min(y1, y2) - 1, w: Math.abs(x2 - x1) + 2, h: Math.abs(y2 - y1) + 2 });

/**
 * A route of three pieces whose middle is a short step (the router works on an 8 px grid) is
 * made straight when one end can slide along its side to meet the other.
 */
function straighten(pts, from, to) {
  if (pts.length !== 4) return pts;
  const [a, b, c, d] = pts;
  const flat = a[1] === b[1] && c[1] === d[1] && b[0] === c[0], tall = a[0] === b[0] && c[0] === d[0] && b[1] === c[1];
  if (flat && Math.abs(a[1] - d[1]) < 16) {
    if (d[1] > to.y + 6 && d[1] < to.y + to.h - 6 && a[1] > to.y + 6 && a[1] < to.y + to.h - 6) return [a, [d[0], a[1]]];
    if (d[1] > from.y + 6 && d[1] < from.y + from.h - 6) return [[a[0], d[1]], d];
  }
  if (tall && Math.abs(a[0] - d[0]) < 16) {
    if (a[0] > to.x + 6 && a[0] < to.x + to.w - 6) return [a, [a[0], d[1]]];
    if (d[0] > from.x + 6 && d[0] < from.x + from.w - 6) return [[d[0], a[1]], d];
  }
  return pts;
}

/**
 * A label beside its arrow, at the free spot that touches the fewest things: candidates sit
 * above or below a horizontal piece, right or left of a vertical one, at several points along it.
 */
function labelBox(pts, text, shapes, placed, lines = []) {
  const w = textWidth(text, SMALL) + 10, h = 18;
  const hit = (r, s) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
  const onBorder = (r, g) => hit(r, g) && !(r.x > g.x && r.y > g.y && r.x + r.w < g.x + g.w && r.y + r.h < g.y + g.h);
  let best = null;
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]], len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (len < 24) continue;
    for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const cands = a[1] === b[1] ? [{ x: x - w / 2, y: y - h - 2 }, { x: x - w / 2, y: y + 2 }] : [{ x: x + 4, y: y - h / 2 }, { x: x - w - 4, y: y - h / 2 }];
      for (const c of cands) {
        const r = { ...c, w, h };
        let score = Math.abs(t - 0.5) * 2 + (len < w + 16 ? 3 : 0);
        for (const s of shapes) {
          if (s.role === "group") score += onBorder(r, s) ? 20 : 0;
          else if (s.role !== "deco" && hit(r, s)) score += 50;
        }
        for (const p of placed) if (hit(r, p)) score += 50;
        // Another arrow under the label hides both.
        for (const other of lines) if (other !== pts && other.slice(1).some((q, j) => hit(r, segBox(other[j], q)))) score += 30;
        if (!best || score < best.score) best = { score, r };
      }
    }
  }
  return best ? [best.r, best.score] : [{ x: pts[0][0], y: pts[0][1] - h, w, h }, Infinity];
}
