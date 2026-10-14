/**
 * Orthogonal arrows between fixed boxes. Each arrow is an A* search on an 8 px grid that may not
 * enter any box or group title, pays for every bend, for crossing an earlier arrow and more for
 * running along one; every pair of sides is tried and the cheapest route wins. Arrows that leave
 * or enter the same side of a box are spread along it.
 */
const STEP = 8, BEND = 6, CROSS = 22, ALONG = 60, NEAR = 8, MARGIN = 48;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const SIDES = { right: [1, 0], bottom: [0, 1], left: [-1, 0], top: [0, -1] };

class Heap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

export function router(obstacles, bounds) {
  const x0 = Math.floor((bounds.x - MARGIN) / STEP) * STEP, y0 = Math.floor((bounds.y - MARGIN) / STEP) * STEP;
  const W = Math.ceil((bounds.w + 2 * MARGIN) / STEP) + 1, H = Math.ceil((bounds.h + 2 * MARGIN) / STEP) + 1;
  const blocked = new Uint8Array(W * H), used = new Uint8Array(W * H * 2);
  const gx = (x) => Math.round((x - x0) / STEP), gy = (y) => Math.round((y - y0) / STEP);
  const block = (b, pad, val = 1) => {
    for (let j = Math.max(0, gy(b.y - pad)); j <= Math.min(H - 1, gy(b.y + b.h + pad)); j++)
      for (let i = Math.max(0, gx(b.x - pad)); i <= Math.min(W - 1, gx(b.x + b.w + pad)); i++) blocked[j * W + i] = val;
  };
  for (const b of obstacles) block(b, b.pad ?? 6);
  const sideCount = new Map();

  /** A point on a side: at `pos` along it (x for top/bottom, y for left/right), or spread by count k. */
  function port(box, side, k, pos, stub = 2) {
    const [dx, dy] = SIDES[side];
    const along = side === "left" || side === "right" ? box.h : box.w;
    const offset = pos !== undefined ? pos - (dx ? box.y + box.h / 2 : box.x + box.w / 2) : k === 0 ? 0 : Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.min(16, along / 6);
    const cx = box.x + box.w / 2 + (dy ? offset : 0), cy = box.y + box.h / 2 + (dx ? offset : 0);
    const edge = [dx > 0 ? box.x + box.w : dx < 0 ? box.x : cx, dy > 0 ? box.y + box.h : dy < 0 ? box.y : cy];
    // The stub out of the box runs straight for two grid steps past the padding, so no arrow bends at the arrowhead.
    let out = [edge[0] + dx * ((box.pad ?? 6) + stub * STEP), edge[1] + dy * ((box.pad ?? 6) + stub * STEP)];
    out = [x0 + gx(out[0]) * STEP, y0 + gy(out[1]) * STEP];
    // Keep the stub straight: snap the cross coordinate of the border point to the grid too.
    return { edge: dx ? [edge[0], out[1]] : [out[0], edge[1]], out, dir: DIRS.findIndex(([a, b]) => a === dx && b === dy) };
  }

  function search(a, b, alone) {
    const si = gx(a.out[0]), sj = gy(a.out[1]), ti = gx(b.out[0]), tj = gy(b.out[1]);
    if (si < 0 || sj < 0 || si >= W || sj >= H || ti < 0 || tj < 0 || ti >= W || tj >= H) return null;
    const free = (i, j) => !blocked[j * W + i] || (i === si && j === sj) || (i === ti && j === tj);
    const cost = new Float64Array(W * H * 4).fill(Infinity), prev = new Int32Array(W * H * 4).fill(-1);
    const heap = new Heap();
    const s = (sj * W + si) * 4 + a.dir;
    cost[s] = 0;
    heap.push([0, s]);
    const endDir = (b.dir + 2) % 4;
    let found = null;
    const heapMin = () => (heap.size ? heap.a[0][0] : Infinity);
    while (heap.size) {
      const [, st] = heap.pop();
      const d = st % 4, cell = (st - d) / 4, i = cell % W, j = (cell - i) / W;
      // Arriving at the stub from any direction is fine: the stub itself enters the box straight.
      if (i === ti && j === tj) {
        if (d === endDir) return trace(prev, st, W);
        if (!found || cost[st] + BEND < found.c) found = { c: cost[st] + BEND, st };
      }
      if (found && heapMin() > found.c) return trace(prev, found.st, W);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H || !free(ni, nj)) continue;
        const ncell = nj * W + ni, axis = nd % 2;
        let c = cost[st] + 1 + (nd !== d ? BEND : 0);
        if (!alone && used[ncell * 2 + axis]) c += ALONG;
        else if (!alone && used[ncell * 2 + 1 - axis]) c += CROSS;
        else if (!alone && near(ni, nj, axis)) c += NEAR;
        const h = Math.abs(ni - ti) + Math.abs(nj - tj);
        const ns = ncell * 4 + nd;
        if (c < cost[ns]) { cost[ns] = c; prev[ns] = st; heap.push([c + h, ns]); }
      }
    }
    return found ? trace(prev, found.st, W) : null;
  }

  /** True when an earlier arrow runs alongside this cell, one grid step away, in the same direction. */
  function near(i, j, axis) {
    const [a, b] = axis ? [[i - 1, j], [i + 1, j]] : [[i, j - 1], [i, j + 1]];
    return [a, b].some(([x, y]) => x >= 0 && y >= 0 && x < W && y < H && used[(y * W + x) * 2 + axis]);
  }

  function trace(prev, st, W) {
    const cells = [];
    for (let s = st; s !== -1; s = prev[s]) { const c = (s - (s % 4)) / 4; cells.push([c % W, (c - (c % W)) / W]); }
    cells.reverse();
    return { cells, cost: cells.length };
  }

  /** Routes one arrow from box a to box b; returns its points, first and last on the borders. */
  function route(a, b, { from, to, fromAt, toAt, alone = false } = {}) {
    let best = null;
    // A short stub is the fallback for boxes too close for the long one; it costs a little more.
    for (const fs of from ? [from] : Object.keys(SIDES)) for (const ts of to ? [to] : Object.keys(SIDES)) for (const stub of [2, 1]) {
      const pa = port(a, fs, sideCount.get(`${a.id}:${fs}`) ?? 0, fromAt, stub), pb = port(b, ts, sideCount.get(`${b.id}:${ts}`) ?? 0, toAt, stub);
      const r = search(pa, pb, alone);
      if (!r) continue;
      // Count bends over the whole arrow, the straight stubs out of and into the boxes included.
      const [sx, sy] = SIDES[fs], [tx, ty] = SIDES[ts], c0 = r.cells[0], cn = r.cells.at(-1);
      const path = [[c0[0] - sx, c0[1] - sy], ...r.cells, [cn[0] - tx, cn[1] - ty]];
      const bends = path.filter((c, k) => k > 0 && k < path.length - 1 && (c[0] - path[k - 1][0]) * (path[k + 1][1] - c[1]) !== (c[1] - path[k - 1][1]) * (path[k + 1][0] - c[0])).length;
      const score = (alone ? r.cells.length : scoreOf(r.cells)) + bends * BEND + (stub === 1 ? 4 : 0);
      if (!best || score < best.score) best = { score, cells: r.cells, pa, pb, fs, ts };
    }
    if (!best) return null;
    if (alone) return { from: best.fs, to: best.ts, points: [] };
    const marks = best.cells.map(([i, j], k) => {
      const n = best.cells[k + 1] ?? best.cells[k - 1];
      return (j * W + i) * 2 + (n && n[1] !== j ? 1 : 0);
    });
    mark(marks, 1);
    sideCount.set(`${a.id}:${best.fs}`, (sideCount.get(`${a.id}:${best.fs}`) ?? 0) + 1);
    sideCount.set(`${b.id}:${best.ts}`, (sideCount.get(`${b.id}:${best.ts}`) ?? 0) + 1);
    const pts = [best.pa.edge, ...best.cells.map(([i, j]) => [x0 + i * STEP, y0 + j * STEP]), best.pb.edge];
    return { points: simplify(pts), from: best.fs, to: best.ts, marks };
  }

  function mark(marks, by) { for (const c of marks) used[c] = Math.max(0, used[c] + by); }

  /** Takes a routed arrow off the grid, or puts it back, for rip-up and reroute. */
  route.lift = (r) => mark(r.marks, -1);
  route.drop = (r) => mark(r.marks, 1);
  return route;

  function scoreOf(cells) {
    let s = cells.length;
    for (let k = 1; k < cells.length; k++) {
      const [i, j] = cells[k], axis = cells[k][1] !== cells[k - 1][1] ? 1 : 0;
      if (used[(j * W + i) * 2 + axis]) s += ALONG; else if (used[(j * W + i) * 2 + 1 - axis]) s += CROSS;
    }
    return s;
  }
}

/** Drops points that sit on a straight line between their neighbours. */
function simplify(pts) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const [a, b, c] = [out.at(-1), pts[k], pts[k + 1]];
    if ((b[0] - a[0]) * (c[1] - b[1]) === (b[1] - a[1]) * (c[0] - b[0])) continue;
    out.push(b);
  }
  out.push(pts.at(-1));
  return out;
}
