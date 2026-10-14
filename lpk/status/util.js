// Small helpers the status page's views share.
export const STEPS = ['Understand', 'Gather facts', 'Choose lane', 'Design Brief', 'Build', 'Verify & review', 'Self-check', 'Fix findings', 'Deliver'];
export const QUIET = 10 * 60 * 1000;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function ago(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}
// A relative time the page's ticker keeps current without a redraw.
export const since = (t) => `<span data-ago="${t}">${ago(t)}</span>`;
export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// What the owner needs to know about a run at a glance, most urgent first.
export function stateOf(r, now) {
  if (r.ended) return 'ended';
  if (r.narrative?.waiting) return 'waiting';
  if (r.verify && !r.verify.green) return 'red';
  return now - r.activity > QUIET ? 'quiet' : 'working';
}
export const STATE = { working: 'Working', waiting: 'Waiting on you', red: 'Verify red', quiet: 'Quiet', ended: 'Ended' };

export const firstAsk = (r) => r.feed?.find((x) => x.who === 'owner')?.text || r.owner?.last?.text || '';
export const titleOf = (r) => r.narrative?.headline || firstAsk(r).replace(/^\/\S+\s*/, '').slice(0, 140) || r.name;
