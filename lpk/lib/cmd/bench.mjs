// `lpk bench`: what the recorded runs actually cost and actually found, read from files that already
// exist (runs.jsonl, the ledgers, the records, the transcripts) and from no model.
// Yield per lens, fresh tokens per lens and per role, wall time on the critical path, and the bytes
// lpk keeps resident in every session. Absence is said out loud: a host whose transcripts write
// usage as zeros has no token figure (null, "unavailable"), never 0.
import { join, resolve } from 'node:path';
import { parseArgs } from '../out.mjs';
import { pluginRoot } from '../host.mjs';
import { BORN } from '../findings.mjs';
import { context, measureInjections } from '../bench-context.mjs';
import { cliLensRuns, ledgers, STATES, yieldOf } from '../bench-data.mjs';
import { readStores } from '../bench-hosts.mjs';
import { render } from '../bench-text.mjs';
import { sessionRows } from '../bench-sessions.mjs';
import { priced } from '../bench-tokens.mjs';
import { readRuns, runsFile } from '../runs.mjs';

const USAGE = 'usage: lpk bench [--json] [--lane <full|quick>] [--runs <n>] [--repo <dir>] [--no-transcripts]';

export async function main(argv) {
  const a = parseArgs(argv, ['--lane', '--runs', '--repo'], ['--json', '--no-transcripts']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const all = readRuns();
  if (!all.length) { console.error(`lpk: no recorded runs in ${runsFile()}`); return 1; }
  const lane = a.opt('--lane');
  let runs = all.filter((r) => !lane || r.lane === lane);
  const limit = a.opt('--runs') ? Number(a.opt('--runs')) : 0;
  if (limit && !(limit > 0)) { console.error(`lpk: --runs wants a whole number, got ${a.opt('--runs')}`); return 2; }
  if (limit) runs = runs.slice(0, limit);
  const repo = a.opt('--repo') ? resolve(a.opt('--repo')) : '';
  if (repo) runs = runs.filter((r) => r.path === repo);
  const skippedRows = all.length - runs.length;
  // A run is written to runs.jsonl once per recording, so its rows are snapshots of one run: keep
  // the fullest (the largest wallMs), or a run counts three times and its findings and tokens do too.
  const byId = new Map();
  for (const r of runs) { const k = r.id || `path:${r.path}`; const p = byId.get(k); if (!p || (r.wallMs || 0) > (p.wallMs || 0)) byId.set(k, r); }
  const dupRows = runs.length - byId.size;
  runs = [...byId.values()];

  const led = ledgers(runs);
  const findings = [...led.byRun.values()].flat();
  const lenses = yieldOf(findings).sort((x, y) => y.raised - x.raised);
  const cli = cliLensRuns(runs.map((r) => ({ repo: r.path, run: r.id })));

  // Tokens and wall time per agent, per host. A session is scanned once and shared by its runs; a
  // run's window is its own start until the next run started in the same session.
  const bySession = new Map();
  for (const r of runs) if (r.session) (bySession.get(r.session) || (bySession.set(r.session, []), bySession.get(r.session))).push(r);
  for (const list of bySession.values()) list.sort((x, y) => Date.parse(x.started) - Date.parse(y.started));

  const { hostsOut, stores, known } = readStores(runs, a.flags.has('--no-transcripts'));
  const { agentRows, runRows, injectFiles, scanned, inRuns, outsideRuns } = sessionRows(stores, bySession, led);
  // A run whose session no transcript store holds, or whose transcripts carry no counts: said so, not left
  // out, and never answered with a 0.
  const withRows = new Set(runRows.map((r) => r.id));
  const hostOf_ = new Map(known.map((x) => [x.session, x.where.host || 'unknown']));
  const quiet = new Set(hostsOut.filter((h) => h.tokensAvailable === false).map((h) => h.host));
  for (const r of runs) if (!withRows.has(r.id)) {
    const h = hostOf_.get(r.session) || '';
    runRows.push({
      id: r.id, repo: r.repo, path: r.path, lane: r.lane, host: h || (r.session ? 'none' : 'no session'), session: r.session || null,
      wallMs: r.wallMs ?? null, ledger: led.byRun.has(r.id) ? 'present' : 'absent',
      findings: (led.byRun.get(r.id) || []).length, fixed: (led.byRun.get(r.id) || []).filter((f) => f.state === 'fixed').length,
      fresh: null, cacheRead: null, criticalPathMs: null, lensMsSum: null, leadMs: null, ownerIdleMs: null, workingMs: null, longPole: '', lenses: {},
      note: quiet.has(h) ? `${h} transcripts write no token counts: its fresh tokens are unavailable, not 0`
        : r.session ? `no transcript of session ${r.session}` : 'run recorded without a session id',
    });
  }

  // The CLI lenses' cost and time, from the records: they have no transcript of their own.
  const cliTable = [];
  for (const r of cli) {
    const k = `${r.kind}:${r.model || 'unknown'}`;
    const t = (cliTable.find((x) => x.lens === k) || (() => { const x = { lens: k, host: 'claude', runs: 0, findingsReturned: 0, exitNonzero: 0, ms: 0, fresh: 0, cacheRead: 0, usd: null, unpriced: 0 }; cliTable.push(x); return x; })());
    t.runs++; t.findingsReturned += r.findings || 0;
    if (r.exit !== 0) t.exitNonzero++;
    t.ms += r.durationMs || 0;
    t.fresh = (t.fresh || 0) + (r.tokens?.fresh || 0);
    t.cacheRead = (t.cacheRead || 0) + (r.tokens?.cacheRead || 0);
    t.unpriced++;
  }
  // What each lens's fixed findings cost: the number that decides whether a lens earns its place.
  const cost = new Map();
  for (const t of [...cliTable, ...[...agentRows.values()].map((t) => ({ lens: t.agent, host: t.host, fresh: t.fresh, cacheRead: t.cacheRead, usd: priced(t).usd, unpriced: t.unpriced, runs: t.runs, ms: t.spanMs }))]) cost.set(t.lens, t);
  for (const l of lenses) {
    const c = cost.get(l.lens);
    l.host = c?.host || 'unknown';
    l.fresh = c ? (c.fresh ?? null) : null;
    l.cacheRead = c ? (c.cacheRead ?? null) : null;
    l.usd = c?.usd ?? null;
    l.unpriced = c?.unpriced ?? 0;
    l.ms = c?.ms ?? null;
    l.runs = c?.runs ?? 0;
    l.tokensPerFixed = c && c.fresh && l.fixed ? Math.round(c.fresh / l.fixed) : null;
    l.tokensPerFixedNote = c && c.fresh === null ? 'host writes no token counts' : l.tokensPerFixed ? '' : 'no finding of this lens in a ledger on disk';
  }
  // A lens that costs but raised nothing the ledgers on disk record (a role, or a CLI child whose
  // findings never reached a ledger): a row with its cost and zeros, so no key is missing.
  for (const [k, c] of cost) if (!lenses.some((l) => l.lens === k)) lenses.push({ lens: k, source: 'no ledger finding', host: c.host, raised: 0, unique: 0, repeated: 0, uniqueFixed: 0, ...Object.fromEntries(STATES.map((s) => [s, 0])), fresh: c.fresh ?? null, cacheRead: c.cacheRead ?? null, usd: c.usd ?? null, unpriced: c.unpriced ?? 0, ms: c.ms ?? null, runs: c.runs, tokensPerFixed: null, tokensPerFixedNote: 'raised nothing this lens has a ledger for' });

  const ctx = context(pluginRoot());
  measureInjections(ctx, injectFiles);

  // Where the confirmed defects began: the row that decides whether the next spend goes before the
  // build (request, design) or into it (build, fix). Only a ruled finding carries `born`.
  const born = Object.fromEntries(BORN.map((k) => [k, 0]));
  for (const rows of led.byRun.values()) for (const f of rows) if (f.born) born[f.born] = (born[f.born] || 0) + 1;
  const bornCount = Object.values(born).reduce((x, y) => x + y, 0);
  const bornNote = bornCount
    ? `${Object.entries(born).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')} of ${bornCount} ruled finding(s) in ${led.byRun.size} reachable ledger(s)`
    : `none of the ${led.byRun.size} reachable ledger(s) holds a ruled finding, so no defect has a birth step recorded yet`;

  const agents = [...agentRows.values()].map(priced);
  const dearest = (x, y) => (y.usd ?? -1) - (x.usd ?? -1);

  const out = {
    v: 1,
    runs: {
      recorded: all.length, distinct: runs.length, snapshotRowsCollapsed: dupRows, skippedByFilter: skippedRows,
      lanes: runs.reduce((x, r) => ({ ...x, [r.lane || 'none']: (x[r.lane || 'none'] || 0) + 1 }), {}),
      withLedger: runs.filter((r) => led.byRun.has(r.id)).length, withoutLedger: led.absent.length, ledgerAbsent: led.absent,
      ledgerDirs: led.dirs, unrecordedLedgers: led.unrecorded,
      withTranscripts: runRows.filter((r) => r.fresh !== null).length, withoutTranscripts: runRows.filter((r) => r.fresh === null).length,
      thin: runs.length < 20 ? `only ${runs.length} runs read; per-lens rows below are counts, not rates` : '',
    },
    hosts: hostsOut,
    lenses: lenses.sort((x, y) => y.raised - x.raised || dearest(x, y)),
    cliLensRuns: cliTable.sort((x, y) => y.runs - x.runs),
    born: { counts: born, ruled: bornCount, note: bornNote },
    agents: agents.sort(dearest),
    tokens: scanned ? { inRuns: priced(inRuns), outsideRuns: priced(outsideRuns), note: 'every message of the scanned sessions once: inRuns lies inside a run window, outsideRuns before, between or after them' } : { inRuns: null, outsideRuns: null, note: 'no transcript was scanned' },
    wall: { runs: runRows.map(({ lenses: _l, ...r }) => r), sessionsScanned: scanned, note: 'criticalPathMs is the union of the agents\' working spans inside the run window; lensMsSum is their sum. ownerIdleMs is the wall time the session waited for the owner (the gaps in all the transcripts work that an owner message closed); workingMs is wallMs without it. A lens running beside another is on neither critical path.' },
    context: ctx,
    missing: { ledger: led.absent, transcripts: runRows.filter((r) => r.fresh === null).map((r) => `${r.id}: ${r.note || 'host writes no token counts'}`), tokensUnavailableFor: hostsOut.filter((h) => !h.tokensAvailable).map((h) => h.host) },
  };
  if (a.flags.has('--json')) { console.log(JSON.stringify(out)); return 0; }
  render(out, repo);
  return 0;
}
