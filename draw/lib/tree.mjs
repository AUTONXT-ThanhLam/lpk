import { EDGE, SMALL, esc, textWidth } from "./style.mjs";
import { Model, S, edgeTone } from "./model.mjs";
import { noteEdgeTone } from "./legend.mjs";
import { drawNode, measure } from "./nodes.mjs";

const SIBLING = 24, LEVEL = { DOWN: 56, RIGHT: 72 };

/**
 * A hierarchy: org chart, work breakdown, decision tree (`direction` `DOWN`, the default) or
 * mind map (`RIGHT`). `root` is a node with `children`; a child's `via` labels the line from
 * its parent, `main` draws it blue, `dashed` dashes it; `arrows: true` adds arrowheads (a
 * decision tree). Each parent sits centred over its children, every level on one line, and
 * the lines run square: down from the parent, across, down to the child.
 */
export default async function tree(spec) {
  if (!spec.root) throw new Error("a tree needs a root: {title, children: [...]}");
  const dir = spec.direction ?? "DOWN";
  if (!LEVEL[dir]) throw new Error(`tree direction "${dir}" (DOWN, RIGHT)`);
  const down = dir === "DOWN";
  const all = [], depthSize = [];
  let auto = 0;
  const prep = (n, depth, parent) => {
    const t = { n: { ...n, id: n.id ?? `t${++auto}` }, depth, parent, kids: [] };
    const { w, h } = measure(t.n);
    // Down a tree, a `via` label runs right of its line, so the child keeps that much room on each side of it.
    const room = down && n.via ? 2 * (textWidth(n.via, SMALL) + 18) : 0;
    Object.assign(t, { w, h, breadth: down ? Math.max(w, room) : h, deep: down ? h : w });
    depthSize[depth] = Math.max(depthSize[depth] ?? 0, t.deep);
    all.push(t);
    t.kids = (n.children ?? []).map((c) => prep(c, depth + 1, t));
    t.span = Math.max(t.breadth, t.kids.reduce((a, k) => a + k.span, 0) + SIBLING * Math.max(0, t.kids.length - 1));
    return t;
  };
  const root = prep(spec.root, 0, null);
  const ids = new Set();
  for (const t of all) { if (ids.has(t.n.id)) throw new Error(`duplicate id "${t.n.id}"`); ids.add(t.n.id); }
  // Across a mind map, a level whose lines carry `via` labels is wide enough for the longest, and its lines fork near the parent.
  const viaW = [];
  if (!down) for (const t of all) if (t.n.via) viaW[t.depth] = Math.max(viaW[t.depth] ?? 0, textWidth(t.n.via, SMALL) + 10);
  const gap = depthSize.map((_, d) => (viaW[d] ? Math.max(LEVEL[dir], viaW[d] + 30) : LEVEL[dir]));
  const levelAt = depthSize.map((_, d) => depthSize.slice(0, d).reduce((a, s, j) => a + s + gap[j + 1], 0));

  // Breadth position: children packed left to right inside the parent's span, parent centred on them.
  const place = (t, from) => {
    let at = from + (t.span - (t.kids.reduce((a, k) => a + k.span, 0) + SIBLING * Math.max(0, t.kids.length - 1))) / 2;
    for (const k of t.kids) { place(k, at); at += k.span + SIBLING; }
    const mid = t.kids.length ? (t.kids[0].mid + t.kids.at(-1).mid) / 2 : from + t.span / 2;
    t.mid = mid;
    const b0 = mid - (down ? t.w : t.h) / 2, d0 = levelAt[t.depth] + (down ? (depthSize[t.depth] - t.deep) / 2 : 0);
    t.box = down ? { x: 20 + b0, y: 20 + d0, w: t.w, h: t.h } : { x: 20 + d0, y: 20 + b0, w: t.w, h: t.h };
  };
  place(root, 0);

  const m = new Model(spec.title ?? "tree");
  for (const t of all) drawNode(m, t.n, t.box);
  for (const t of all) {
    if (!t.parent) continue;
    const p = t.parent.box, c = t.box;
    const gapMid = levelAt[t.depth] - (viaW[t.depth] ? gap[t.depth] - 16 : gap[t.depth] / 2) + 20;
    const points = down
      ? [[p.x + p.w / 2, p.y + p.h], [p.x + p.w / 2, gapMid], [c.x + c.w / 2, gapMid], [c.x + c.w / 2, c.y]]
      : [[p.x + p.w, p.y + p.h / 2], [gapMid, p.y + p.h / 2], [gapMid, c.y + c.h / 2], [c.x, c.y + c.h / 2]];
    const tone = edgeTone({ main: t.n.main });
    noteEdgeTone(m, tone);
    m.edge({ source: t.parent.n.id, target: t.n.id, points: points.filter((q, k) => k === 0 || q[0] !== points[k - 1][0] || q[1] !== points[k - 1][1]), style: S.edge(tone, { dashed: t.n.dashed }) + (spec.arrows ? "" : "endArrow=none;") });
    if (t.n.via) {
      const w = textWidth(t.n.via, SMALL) + 10;
      const box = down ? { x: c.x + c.w / 2 + 4, y: gapMid + 3, w, h: 18 } : { x: gapMid + 6, y: c.y + c.h / 2 - 20, w, h: 18 };
      m.shape({ ...box, value: esc(t.n.via), style: S.label(EDGE[tone]), role: "label" });
    }
  }
  return m;
}
