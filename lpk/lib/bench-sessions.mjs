import { readFileSync } from 'node:fs';
import { add, attribute, priced, tally } from './bench-tokens.mjs';
import { idle, ownerTimes, sum, union } from './bench-time.mjs';
import { scanSession } from './scan.mjs';

const row = (agent, host) => ({ agent, host, runs: 0, spanMs: 0, ...tally() });
const addRow = (to, t, spanMs) => { to.runs++; add(to, t); to.spanMs += spanMs; };

// Tokens and wall time per agent for every session of the runs, per host. A session is scanned once
// and shared by its runs; a run's window is its own start until the next run started in the same
// session, or until its wall time is spent.
export function sessionRows(stores, bySession, led) {
  const agentRows = new Map();
  const runRows = [];
  const injectFiles = [];
  const inRuns = tally();
  const outsideRuns = tally();
  let scanned = 0;
  for (const store of stores) {
    const host = store.host;
    for (const x of store.sessions) {
      const s = x.session;
      const found = scanSession(s, { v: 4, files: {} });
      if (!found) continue;
      scanned++;
      if (x.where.main) injectFiles.push(x.where.main);
      const list = bySession.get(s);
      const owner = x.where.main ? ownerTimes(readFileSync(x.where.main, 'utf8')) : new Set();
      const files = (found.main ? [{ id: s, meta: { agentType: 'main session' }, st: found.main, lead: true }, ...found.agents] : found.agents);
      const windows = list.map((r, i) => {
        const from = Date.parse(r.started);
        const next = i + 1 < list.length ? Date.parse(list[i + 1].started) : Infinity;
        return { from, to: r.wallMs > 0 ? Math.min(next, from + r.wallMs) : next };
      });
      const split = attribute(files, windows);
      add(outsideRuns, split.outside);
      list.forEach((r, i) => {
        const { from, to } = windows[i];
        const spans = [], worked = [], per = {};
        const whole = tally();
        let leadMs = 0;
        files.forEach((ag, f) => {
          const k = ag.meta.agentType || 'agent';
          const w = split.inside[i][f];
          const sp = ag.st.spans.filter(([a, b]) => a < to && b > from);
          if (!w.messages && !sp.length) return;
          const spanMs = union(sp, from, to);
          addRow(per[k] ||= row(k, host), w, spanMs);
          addRow(agentRows.get(k) || (agentRows.set(k, row(k, host)), agentRows.get(k)), w, spanMs);
          add(whole, w); add(inRuns, w);
          worked.push(...sp);
          if (ag.lead) leadMs += spanMs; else spans.push(...sp);
        });
        const ownerIdleMs = idle(worked, owner, from, to);
        const mine = led.byRun.get(r.id) || [];
        const total = priced(whole);
        runRows.push({
          id: r.id, repo: r.repo, path: r.path, lane: r.lane, host, session: r.session,
          wallMs: r.wallMs ?? null, ledger: led.byRun.has(r.id) ? 'present' : 'absent',
          findings: mine.length, fixed: mine.filter((f) => f.state === 'fixed').length,
          fresh: whole.fresh || null, cacheRead: whole.cacheRead || null, usd: whole.messages ? total.usd : null, unpriced: total.unpriced,
          criticalPathMs: union(spans, from, to), lensMsSum: sum(spans, from, to), leadMs: leadMs || null, ownerIdleMs, workingMs: r.wallMs == null ? null : Math.max(0, r.wallMs - ownerIdleMs),
          longPole: Object.values(per).filter((p) => p.agent !== 'main session').sort((p, q) => q.spanMs - p.spanMs)[0]?.agent || '',
          lenses: per,
        });
      });
    }
  }
  return { agentRows, runRows, injectFiles, scanned, inRuns, outsideRuns };
}
