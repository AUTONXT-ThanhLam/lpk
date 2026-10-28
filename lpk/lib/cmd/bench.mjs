// `lpk bench`: what the recorded runs actually cost and actually found, read from files that already
// exist (runs.jsonl, the ledgers, the records, the transcripts of both hosts) and from no model.
// Yield per lens, fresh tokens per lens and per role, wall time on the critical path, and the bytes
// lpk keeps resident in every session. Absence is said out loud: a host whose transcripts write
// usage as zeros has no token figure (null, "unavailable"), never 0.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { capped, parseArgs } from '../out.mjs';
import { configCandidates, pluginRoot, slugOf, TOKENS_UNMEASURED } from '../host.mjs';
import { BORN, readLedger } from '../findings.mjs';
import { meter, sessionFiles, total } from '../meter.mjs';
import { readRecords } from '../records.mjs';
import { runDir } from '../run.mjs';
import { readRuns, runsFile } from '../runs.mjs';
import { scanSession } from '../scan.mjs';

const USAGE = 'usage: lpk bench [--json] [--lane <full|quick>] [--runs <n>] [--repo <dir>] [--no-transcripts]';
const n = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const ms = (x) => (x === null || x === undefined ? 'n/a' : `${(x / 1000).toFixed(1)}s`);
// Rough, and said to be rough: lpk counts tokens exactly where a host writes them, and estimates
// them only for resident text, at 4 bytes per token.
const est = (bytes) => Math.round(bytes / 4);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const jsonl = (text) => text.split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });

// A lens name as the ledger and the transcripts both write it: `code-review:sonnet`, `lpk:ocr`.
const lensOf = (from) => String(from || 'unknown');

// The merged length of [from,to] intervals clipped to the window: the time the window holds work,
// not the sum of the work in it.
function union(spans, from = -Infinity, to = Infinity) {
  const cut = spans.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, last = -Infinity;
  for (const [a, b] of cut) { if (a > last) { total += b - a; last = b; } else if (b > last) { total += b - last; last = b; } }
  return total;
}
const sum = (spans, from = -Infinity, to = Infinity) => spans.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);

// One transcript's fresh tokens and cache reads written inside the window, its own messages only.
function inWindow(st, from, to) {
  const t = { fresh: 0, cacheRead: 0, messages: 0 };
  for (const [i, cw, cr, o, at] of Object.values(st.usage)) {
    if (!(at >= from && at < to)) continue;
    t.fresh += i + cw + o; t.cacheRead += cr; t.messages++;
  }
  return t;
}

// Frontmatter `description:` of a skill or agent file, and the body that only loads when invoked.
function parts(file) {
  const t = read(file);
  const fm = t.match(/^---\n([\s\S]*?)\n---\n?/);
  const d = fm ? fm[1].match(/^description:([\s\S]*?)(?=\n[a-zA-Z][\w-]*:|$)/m) : null;
  return { desc: d ? d[1].replace(/\n\s*/g, ' ').trim().length : 0, body: Math.max(0, t.length - (fm ? fm[0].length : 0)) };
}

// What one repo directory of the plugin contributes to every session, and what only loads on invoke.
function context(root) {
  const out = { resident: { skills: [], agents: [] }, onInvoke: { skillBodies: 0, agentBodies: 0 }, hooksJsonBytes: 0, pluginJsonBytes: 0 };
  for (const dir of ['skills', 'workflows']) {
    let names = [];
    try { names = readdirSync(join(root, dir)); } catch { /* none in this install */ }
    if (dir === 'skills') for (const s of names) {
      const p = join(root, dir, s, 'SKILL.md');
      if (!existsSync(p)) continue;
      const q = parts(p);
      out.resident.skills.push({ skill: s, descriptionBytes: q.desc, descriptionTokensEst: est(q.desc), bodyBytes: q.body, bodyTokensEst: est(q.body) });
      out.onInvoke.skillBodies += q.body;
    }
  }
  let agents = [];
  try { agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')); } catch { /* no agents */ }
  for (const f of agents) {
    const q = parts(join(root, 'agents', f));
    out.resident.agents.push({ agent: f.replace(/\.md$/, ''), descriptionBytes: q.desc, descriptionTokensEst: est(q.desc), bodyBytes: q.body, bodyTokensEst: est(q.body) });
    out.onInvoke.agentBodies += q.body;
  }
  out.hooksJsonBytes = (() => { try { return statSync(join(root, 'hooks', 'hooks.json')).size; } catch { return 0; } })();
  out.pluginJsonBytes = (() => { try { return statSync(join(root, '.claude-plugin', 'plugin.json')).size; } catch { return 0; } })();
  out.skillDescriptionBytes = out.resident.skills.reduce((x, s) => x + s.descriptionBytes, 0);
  out.agentDescriptionBytes = out.resident.agents.reduce((x, s) => x + s.descriptionBytes, 0);
  out.residentBytes = out.skillDescriptionBytes + out.agentDescriptionBytes;
  out.residentTokensEst = est(out.residentBytes);
  out.onInvokeBytes = out.onInvoke.skillBodies + out.onInvoke.agentBodies;
  // The advice a hook hands back is resident once it lands: measured from the transcripts, not from
  // the strings in lib/hooks.mjs, so a hook that never fires costs nothing here.
  out.measured = { adviceLines: 0, adviceBytes: 0, skillInjectLines: 0, skillInjectBytes: 0, cardLines: 0, cardBytes: 0, mainTranscriptBytes: 0 };
  return out;
}

function measureInjections(ctx, files) {
  for (const f of files) {
    const text = read(f);
    ctx.measured.mainTranscriptBytes += text.length;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (line.includes('hook additional context: lpk')) { ctx.measured.adviceLines++; ctx.measured.adviceBytes += line.length; }
      else if (line.includes('Base directory for this skill')) { ctx.measured.skillInjectLines++; ctx.measured.skillInjectBytes += line.length; }
      else if (line.includes('# lpk state card')) { ctx.measured.cardLines++; ctx.measured.cardBytes += line.length; }
    }
  }
}

// The CLI children, from the run records: what each headless lens ran, what it returned, how long it
// took, what it cost. Only `code-review` is still written; the other two kinds are history.
function cliLensRuns(repos) {
  const rows = [];
  for (const { repo, run } of repos) {
    let recs = [];
    try { recs = readRecords(repo, run ? { run } : {}); } catch { /* not a git repository any more */ }
    rows.push(...recs);
  }
  return rows.filter((r) => ['code-review', 'security-review', 'self-review'].includes(r.kind));
}

// Every ledger the recorded runs still have on disk. The path a row names may be a scratch worktree
// that is gone, so a ledger is read from every run directory a surviving path can reach: worktrees of
// one repo share it, and a run's archived ledger sits beside another run's live one.
function ledgerFiles(dir) {
  const one = join(dir, 'findings.jsonl');
  const live = existsSync(one) ? [one] : [];
  let ids = [];
  try { ids = readdirSync(join(dir, 'runs')); } catch { return live; }
  const archived = ids.flatMap((id) => {
    let names = [];
    try { names = readdirSync(join(dir, 'runs', id)); } catch { return []; }
    return names.filter((n) => /^findings(\.\d+)?\.jsonl$/.test(n)).map((n) => join(dir, 'runs', id, n));
  });
  return [...live, ...archived];
}

function ledgers(runs) {
  const out = { byRun: new Map(), absent: [], dirs: [], unrecorded: [] };
  const seen = new Set();
  for (const r of runs) {
    if (!r.path || !existsSync(r.path)) continue;
    let dir = '';
    try { dir = runDir(r.path); } catch { continue /* not a git repository any more */ }
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.dirs.push(dir);
    for (const file of ledgerFiles(dir)) {
      let found = [];
      try { found = readLedger(null, file).findings; } catch (e) { out.absent.push(`${file}: ${String(e.message).split('\n')[0]}`); continue; }
      for (const f of found) if (!out.byRun.has(f.run)) out.byRun.set(f.run, []);
      for (const f of found) out.byRun.get(f.run).push(f);
    }
  }
  const rows = new Set(runs.map((r) => r.id));
  out.unrecorded = [...out.byRun.entries()].filter(([id]) => !rows.has(id)).map(([id, f]) => ({ run: id, findings: f.length, fixed: f.filter((x) => x.state === 'fixed').length }));
  for (const x of out.unrecorded) out.byRun.delete(x.run);
  for (const r of runs) if (r.id && !out.byRun.has(r.id)) out.absent.push(`${r.id} (${r.path && existsSync(r.path) ? 'no ledger names it' : `${r.path || 'no path'} is gone`})`);
  return out;
}

const STATES = ['fixed', 'confirmed', 'dropped', 'duplicate', 'preexisting', 'unsettled', 'open', 'deferred'];

// Per lens: raised, settled each way, and how many of its findings no other lens of the same run put
// on the same file or area. A finding id is only unique inside its run, so the dedup key is both.
function yieldOf(all) {
  const by = new Map();
  const area = (f) => f.area || f.file || '(no file)';
  const seen = new Set();
  const uniq = (f) => `${f.run}|${f.id}`;
  const rows = all.filter((f) => !seen.has(uniq(f)) && (seen.add(uniq(f)) || true));
  for (const f of rows) {
    const k = lensOf(f.from);
    const t = (by.get(k) || (() => { const x = { lens: k, source: 'ledger', raised: 0, unique: 0, repeated: 0, uniqueFixed: 0, ...Object.fromEntries(STATES.map((s) => [s, 0])) }; by.set(k, x); return x; })());
    t.raised++;
    t[f.state] = (t[f.state] || 0) + 1;
    const dup = rows.some((d) => d !== f && d.run === f.run && d.from !== f.from && area(d) === area(f));
    if (dup) t.repeated++; else t.unique++;
    if (f.state === 'fixed' && !dup) t.uniqueFixed++;
  }
  return [...by.values()];
}

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

  const hostsOut = [];
  const agentRows = new Map();
  const runRows = [];
  let scanned = 0;
  const injectFiles = [];
  // lib/meter.mjs walks both stores and says which one a transcript came from, so a run made on
  // either host is found. Every store the machine names is reported, including one that holds none of
  // these runs: its verdict on tokens is measured from its own transcripts of the same projects, so a
  // SKIPPED row is a finding, not an absence.
  const runSessions = [...new Set(runs.map((r) => r.session).filter(Boolean))];
  const known = runSessions.map((s) => ({ session: s, where: sessionFiles(s), rows: (() => { try { return meter(s); } catch { return null; } })() })).filter((x) => x.where && x.rows);
  const slugs = new Set(runs.map((r) => r.path).filter(Boolean).map((p) => slugOf(p)));
  const stores = [];
  for (const c of configCandidates()) {
    const projects = join(c.dir, 'projects');
    if (!existsSync(projects)) { hostsOut.push({ host: c.host, root: projects, sessions: [], transcripts: [], fresh: null, cacheRead: null, tokensAvailable: null, note: 'no transcript store of this host on this machine' }); continue; }
    const mine = known.filter((x) => (x.where.host || '') === c.host);
    const others = [...new Set([...slugs].flatMap((slug) => { try { return readdirSync(join(projects, slug)); } catch { return []; } }))].filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
    const extra = others.slice(0, 4).filter((s) => !mine.some((x) => x.session === s))
      .map((s) => ({ session: s, where: sessionFiles(s, [projects]), rows: (() => { try { return meter(s, [projects]); } catch { return null; } })() }))
      .filter((x) => x.where && x.rows);
    const sample = mine.length ? mine : extra;
    const t = total(sample.flatMap((x) => x.rows));
    hostsOut.push({
      host: c.host, root: projects, ofTheseRuns: mine.length, sessions: sample.map((x) => x.session),
      projectFoldersWithTranscripts: [...slugs].filter((slug) => existsSync(join(projects, slug))).length,
      agents: sample.reduce((x, s) => x + s.rows.length, 0),
      transcripts: sample.flatMap((x) => x.rows.map((r) => ({ agent: r.agent, host: r.host, recorded: r.recorded, fresh: r.recorded ? r.fresh : null, cacheRead: r.recorded ? r.cacheRead : null }))),
      fresh: t.recorded ? t.fresh : null, cacheRead: t.recorded ? t.cacheRead : null,
      tokensAvailable: t.recorded,
      note: t.recorded ? '' : `SKIPPED for cost: ${TOKENS_UNMEASURED} (${c.host} writes every usage count as 0, so a token figure for its runs is unavailable, not 0)${mine.length ? '' : '; no lpk run row names a session of this host'}`,
      ...(t.recorded ? {} : { creditsSum: creditsOf(sample.map((x) => x.session)), creditsNote: 'the only cost figure this host writes is `credits`; summed once per message id, as meter.mjs counts tokens' }),
    });
    if (!t.recorded || a.flags.has('--no-transcripts')) continue;
    stores.push({ host: c.host, sessions: mine });
  }
  for (const store of stores) {
    const host = store.host;
    for (const x of store.sessions) {
      const s = x.session;
      const found = scanSession(s, { v: 4, files: {} });
      if (!found) continue;
      scanned++;
      // scanSession hands back the main transcript's state, not its path; the injections a hook and a
      // skill leave in a session are read from the file itself.
      if (x.where.main) injectFiles.push(x.where.main);
      const list = bySession.get(s);
      // The lead's own transcript is a role too, and its tokens count; its spans do not enter the
      // critical path, which is the question of how the lenses overlapped.
      const files = (found.main ? [{ id: s, meta: { agentType: 'main session' }, st: found.main, lead: true }, ...found.agents] : found.agents);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const from = Date.parse(r.started);
        const to = i + 1 < list.length ? Date.parse(list[i + 1].started) : Infinity;
        const spans = [];
        const per = {};
        let fresh = 0, cacheRead = 0, leadMs = 0;
        for (const ag of files) {
          const k = ag.meta.agentType || 'agent';
          const w = inWindow(ag.st, from, to);
          const sp = ag.st.spans.filter(([x, y]) => x < to && y > from);
          const p = (per[k] ||= { agent: k, host, runs: 0, fresh: 0, cacheRead: 0, messages: 0, spanMs: 0 });
          if (!w.messages && !sp.length) continue;
          p.runs++; p.fresh += w.fresh; p.cacheRead += w.cacheRead; p.messages += w.messages;
          p.spanMs += union(sp, from, to);
          fresh += w.fresh; cacheRead += w.cacheRead;
          if (ag.lead) leadMs += union(sp, from, to); else spans.push(...sp);
          const t = (agentRows.get(k) || (() => { const x = { agent: k, host, runs: 0, fresh: 0, cacheRead: 0, messages: 0, spanMs: 0 }; agentRows.set(k, x); return x; })());
          t.runs++; t.fresh += w.fresh; t.cacheRead += w.cacheRead; t.messages += w.messages; t.spanMs += union(sp, from, to);
        }
        runRows.push({
          id: r.id, repo: r.repo, path: r.path, lane: r.lane, host, session: r.session,
          wallMs: r.wallMs ?? null, ledger: led.byRun.has(r.id) ? 'present' : 'absent',
          findings: (led.byRun.get(r.id) || []).length,
          fixed: (led.byRun.get(r.id) || []).filter((f) => f.state === 'fixed').length,
          fresh: fresh || null, cacheRead: cacheRead || null,
          criticalPathMs: union(spans, from, to), lensMsSum: sum(spans, from, to), leadMs: leadMs || null,
          longPole: Object.values(per).filter((x) => x.agent !== 'main session').sort((x, y) => y.spanMs - x.spanMs)[0]?.agent || '',
          lenses: per,
        });
      }
    }
  }
  // A run whose session no store of these holds, or whose host writes no counts: said so, not left
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
      fresh: null, cacheRead: null, criticalPathMs: null, lensMsSum: null, leadMs: null, longPole: '', lenses: {},
      note: quiet.has(h) ? `${h} transcripts write no token counts: its fresh tokens are unavailable, not 0`
        : r.session ? `no transcript of session ${r.session} on either host` : 'run recorded without a session id',
    });
  }

  // The CLI lenses' cost and time, from the records: they have no transcript of their own.
  const cliTable = [];
  for (const r of cli) {
    const k = `${r.kind}:${r.model || 'unknown'}`;
    const t = (cliTable.find((x) => x.lens === k) || (() => { const x = { lens: k, host: 'claude', runs: 0, findingsReturned: 0, exitNonzero: 0, ms: 0, fresh: 0, cacheRead: 0 }; cliTable.push(x); return x; })());
    t.runs++; t.findingsReturned += r.findings || 0;
    if (r.exit !== 0) t.exitNonzero++;
    t.ms += r.durationMs || 0;
    t.fresh = (t.fresh || 0) + (r.tokens?.fresh || 0);
    t.cacheRead = (t.cacheRead || 0) + (r.tokens?.cacheRead || 0);
  }
  // What each lens's fixed findings cost: the number that decides whether a lens earns its place.
  const cost = new Map();
  for (const t of [...cliTable, ...[...agentRows.values()].map((t) => ({ lens: t.agent, host: t.host, fresh: t.fresh, cacheRead: t.cacheRead, runs: t.runs, ms: t.spanMs }))]) cost.set(t.lens, t);
  for (const l of lenses) {
    const c = cost.get(l.lens);
    l.host = c?.host || 'unknown';
    l.fresh = c ? (c.fresh ?? null) : null;
    l.cacheRead = c ? (c.cacheRead ?? null) : null;
    l.ms = c?.ms ?? null;
    l.runs = c?.runs ?? 0;
    l.tokensPerFixed = c && c.fresh && l.fixed ? Math.round(c.fresh / l.fixed) : null;
    l.tokensPerFixedNote = c && c.fresh === null ? 'host writes no token counts' : l.tokensPerFixed ? '' : 'no finding of this lens in a ledger on disk';
  }
  // A lens that costs but raised nothing the ledgers on disk record (a role, or a CLI child whose
  // findings never reached a ledger): a row with its cost and zeros, so no key is missing.
  for (const [k, c] of cost) if (!lenses.some((l) => l.lens === k)) lenses.push({ lens: k, source: 'no ledger finding', host: c.host, raised: 0, unique: 0, repeated: 0, uniqueFixed: 0, ...Object.fromEntries(STATES.map((s) => [s, 0])), fresh: c.fresh ?? null, cacheRead: c.cacheRead ?? null, ms: c.ms ?? null, runs: c.runs, tokensPerFixed: null, tokensPerFixedNote: 'raised nothing this lens has a ledger for' });

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
    lenses: lenses.sort((x, y) => y.raised - x.raised || (y.fresh || 0) - (x.fresh || 0)),
    cliLensRuns: cliTable.sort((x, y) => y.runs - x.runs),
    born: { counts: born, ruled: bornCount, note: bornNote },
    agents: [...agentRows.values()].sort((x, y) => y.fresh - x.fresh),
    wall: { runs: runRows.map(({ lenses: _l, ...r }) => r), sessionsScanned: scanned, note: 'criticalPathMs is the union of the agents\' working spans inside the run window; lensMsSum is their sum. A lens running beside another is on neither critical path.' },
    context: ctx,
    missing: { ledger: led.absent, transcripts: runRows.filter((r) => r.fresh === null).map((r) => `${r.id}: ${r.note || 'host writes no token counts'}`), tokensUnavailableFor: hostsOut.filter((h) => !h.tokensAvailable).map((h) => h.host) },
  };
  if (a.flags.has('--json')) { console.log(JSON.stringify(out)); return 0; }

  const head = [`bench: ${runs.length} distinct runs of ${all.length} rows in runs.jsonl (${dupRows} snapshot rows folded; ${Object.entries(out.runs.lanes).map(([k, v]) => `${k} ${v}`).join(', ')}); ledgers on disk for ${out.runs.withLedger} runs, absent for ${out.runs.withoutLedger}; transcripts of ${out.runs.withTranscripts} runs`];
  const lensRows = ['lens | raised | fixed | confirmed | dropped | dup | preexist | uniq | tokens fixed | fresh tokens | cache reads | wall'];
  for (const l of out.lenses) lensRows.push(`  ${l.lens} | ${l.raised} | ${l.fixed} | ${l.confirmed} | ${l.dropped} | ${l.duplicate} | ${l.preexisting} | ${l.unique} | ${n(l.tokensPerFixed)} | ${n(l.fresh)} | ${n(l.cacheRead)} | ${ms(l.ms)}`);
  const hostRows = out.hosts.map((h) => `  host ${h.host}: ${h.ofTheseRuns ?? 0} of these runs' sessions, ${h.agents ?? 0} transcript(s) read; fresh tokens ${h.tokensAvailable ? n(h.fresh) : 'UNAVAILABLE (SKIPPED)'}, cache reads ${h.tokensAvailable ? n(h.cacheRead) : 'SKIPPED'}${h.creditsSum !== undefined ? `, credits ${h.creditsSum}` : ''}. ${h.note}`);
  const cliRows = ['  CLI lens runs (from the records, the only cost a headless child leaves):', ...out.cliLensRuns.map((c) => `  ${c.lens}: ${c.runs} runs, ${c.findingsReturned} findings returned, ${c.exitNonzero} nonzero exit, ${ms(c.ms)} wall, fresh ${n(c.fresh)}, cache reads ${n(c.cacheRead)}`)];
  const wallRows = ['  wall, longest runs first (critical path vs the sum of the lenses in it):', ...[...out.wall.runs].sort((x, y) => (y.criticalPathMs || 0) - (x.criticalPathMs || 0)).slice(0, 12).map((r) => `  ${r.id} ${r.repo} [${r.lane}] ledger:${r.ledger}: run wall ${ms(r.wallMs)}, critical path ${ms(r.criticalPathMs)}, lens sum ${ms(r.lensMsSum)}, long pole ${r.longPole || 'n/a'}, findings ${r.findings} fixed ${r.fixed}`)];
  const bornRows = [
    '  where defects were born (the spend that follows: request+design is cheaper to fix than build+fix):',
    `  ${out.born.note}`,
    ...(out.born.ruled ? [`  before the build (request, design): ${['request', 'design'].reduce((x, k) => x + (out.born.counts[k] || 0), 0)}, in it or after (build, fix): ${['build', 'fix'].reduce((x, k) => x + (out.born.counts[k] || 0), 0)}`] : []),
  ];
  const ctxRows = [
    '  always-on context (bytes, token estimate at 4 bytes/token):',
    `  resident: skill descriptions ${n(ctx.skillDescriptionBytes)} B / ~${n(est(ctx.skillDescriptionBytes))} tok across ${ctx.resident.skills.length} skill(s); agent descriptions ${n(ctx.agentDescriptionBytes)} B / ~${n(est(ctx.agentDescriptionBytes))} tok across ${ctx.resident.agents.length} agent(s); hooks.json ${n(ctx.hooksJsonBytes)} B; plugin.json ${n(ctx.pluginJsonBytes)} B`,
    `  only on invoke: skill bodies ${n(ctx.onInvoke.skillBodies)} B / ~${n(est(ctx.onInvoke.skillBodies))} tok, agent bodies ${n(ctx.onInvoke.agentBodies)} B / ~${n(est(ctx.onInvoke.agentBodies))} tok`,
    `  measured in the scanned sessions' main transcripts: hook advice ${n(ctx.measured.adviceLines)} lines ${n(ctx.measured.adviceBytes)} B, skill injections ${n(ctx.measured.skillInjectLines)} lines ${n(ctx.measured.skillInjectBytes)} B, state cards ${n(ctx.measured.cardLines)} lines ${n(ctx.measured.cardBytes)} B over ${n(ctx.measured.mainTranscriptBytes)} B of main transcript`,
  ];
  console.log(capped(repo, 'bench', head, [
    ...hostRows, '', 'yield and cost per lens:', ...lensRows, ...cliRows, '', ...bornRows, '', ...wallRows, ...ctxRows,
    ...(out.missing.ledger.length ? ['', `ledgers not on disk (${out.missing.ledger.length}):`, ...out.missing.ledger.map((x) => `  ${x}`)] : []),
    ...(out.runs.unrecordedLedgers.length ? ['', `ledgers with no run row (${out.runs.unrecordedLedgers.length}), so not counted above:`, ...out.runs.unrecordedLedgers.map((x) => `  ${x.run}: ${x.findings} findings, ${x.fixed} fixed`)] : []),
  ]));
  return 0;
}

// The one cost figure a host that writes no token counts does write: `credits` per API message,
// summed once per message id, exactly as meter.mjs counts tokens. Null when the host writes neither.
function creditsOf(sessions) {
  const seen = new Set();
  let sum = 0, any = false;
  for (const s of sessions) {
    const found = sessionFiles(s);
    if (!found) continue;
    for (const f of [found.main, ...found.agents].filter(Boolean)) {
      for (const d of jsonl(read(f))) {
        const m = d.type === 'assistant' ? d.message : null;
        if (!m?.usage || !m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        if (typeof m.usage.credits === 'number') { sum += m.usage.credits; any = true; }
      }
    }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}
