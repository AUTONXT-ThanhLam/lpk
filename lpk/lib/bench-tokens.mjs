import { usdOf } from './bench-price.mjs';

export const tally = () => ({ fresh: 0, cacheRead: 0, messages: 0, usd: 0, unpriced: 0 });

export function add(into, from) {
  into.fresh += from.fresh; into.cacheRead += from.cacheRead; into.messages += from.messages;
  into.usd += from.usd; into.unpriced += from.unpriced;
}

export function take(into, u) {
  const [input, cacheWrite, cacheRead, output] = u;
  const usd = usdOf(u);
  into.fresh += input + cacheWrite + output; into.cacheRead += cacheRead; into.messages++;
  if (usd === null) into.unpriced++; else into.usd += usd;
}

export const priced = (t) => ({ ...t, usd: t.unpriced ? null : Math.round(t.usd * 1e6) / 1e6 });

// Every message of a session once: files in their order, a message a later file replays from an
// earlier one left to the earlier. Each lands in the window that holds the moment it was written, or
// in `outside` when none does, so the windows and `outside` add up to everything the session used.
export function attribute(files, windows) {
  const seen = new Set();
  const inside = windows.map(() => files.map(tally));
  const outside = tally();
  files.forEach((file, f) => {
    for (const [id, u] of Object.entries(file.st.usage)) {
      if (seen.has(id)) continue;
      const at = u[4];
      const w = windows.findIndex((x) => at >= x.from && at < x.to);
      take(w < 0 ? outside : inside[w][f], u);
    }
    for (const id of Object.keys(file.st.usage)) seen.add(id);
  });
  return { inside, outside };
}
