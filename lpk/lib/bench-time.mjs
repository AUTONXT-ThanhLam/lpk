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

const NOT_THE_OWNER = /^\s*(<task-notification>|<local-command|\[Request interrupted by user)/;
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');

// When the owner spoke in a main transcript, in ms: a prompt they typed, or the answer to an
// AskUserQuestion. A background task's notice, a command's output and a tool result are not them.
export function ownerTimes(text) {
  const times = new Set();
  const asked = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"user"') && !line.includes('AskUserQuestion')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const at = Date.parse(e.timestamp);
    const c = e.message?.content;
    if (e.type === 'assistant') { for (const b of Array.isArray(c) ? c : []) if (b?.type === 'tool_use' && b.name === 'AskUserQuestion') asked.add(b.id); continue; }
    if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly || !Number.isFinite(at)) continue;
    const answered = Array.isArray(c) && c.some((b) => b?.type === 'tool_result' && asked.has(b.tool_use_id));
    if (answered || (!(Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) && !NOT_THE_OWNER.test(textOf(c)))) times.add(at);
  }
  return times;
}

// The time the window sat waiting for the owner: each gap in the merged work of every transcript, the
// lead's included, that closes at a moment the owner spoke. A gap a notice closes is no owner time.
export function idle(spans, owner, from = -Infinity, to = Infinity) {
  const cut = spans.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, last = null;
  for (const [a, b] of cut) {
    if (last !== null && a > last && owner.has(a)) total += a - last;
    last = last === null ? b : Math.max(last, b);
  }
  return total;
}
