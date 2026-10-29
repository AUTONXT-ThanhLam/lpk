// The merged length of [from,to] intervals clipped to the window: the time the window holds work,
// not the sum of the work in it.
export function union(spans, from = -Infinity, to = Infinity) {
  const cut = spans.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, last = -Infinity;
  for (const [a, b] of cut) { if (a > last) { total += b - a; last = b; } else if (b > last) { total += b - last; last = b; } }
  return total;
}
export const sum = (spans, from = -Infinity, to = Infinity) => spans.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);

// One transcript's fresh tokens and cache reads written inside the window, its own messages only.
export function inWindow(st, from, to) {
  const t = { fresh: 0, cacheRead: 0, messages: 0 };
  for (const [i, cw, cr, o, at] of Object.values(st.usage)) {
    if (!(at >= from && at < to)) continue;
    t.fresh += i + cw + o; t.cacheRead += cr; t.messages++;
  }
  return t;
}
