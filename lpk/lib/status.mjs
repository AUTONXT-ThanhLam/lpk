// The facts `lpk status` prints: where the run of this repo stands, who of the session's team runs
// and what waits on the owner. Exact facts only, and fast: transcripts are read incrementally
// (lib/scan.mjs), and the gates, which read git, the records and every lens transcript, are
// computed again only when one of their inputs changed. No network: the ci gate is left out.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { activeMs, crew, STALL_MS } from './crew.mjs';
import { counts, needsOwner } from './findings.mjs';
import { gates } from './gates.mjs';
import { git } from './git.mjs';
import { ledgerFor, owed } from './owed.mjs';
import { patchesOf } from './patches.mjs';
import { designRound, phaseDetail, phaseOf } from './phase.mjs';
import { lastProver, named, proofsOf, trace } from './proof.mjs';
import { readDecisions, readRecords, waived } from './records.mjs';
import { endedRuns, runDir, runState } from './run.mjs';
import { readCache, scanSession, tokensOf, writeCache } from './scan.mjs';
import { headTree } from './tree.mjs';

const stamp = (p) => { try { const s = statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// Scenarios passed and requirements proved on HEAD, as the scenarios and requirements gates read them.
function proofs(repo, run, recs) {
  const sc = run.scenarios || [];
  const tree = headTree(repo);
  let prover;
  const results = () => { if (prover === undefined) prover = lastProver(repo, run); return prover?.structured?.results || []; };
  const passed = sc.filter((s) => (s.cmd ? proofsOf(recs, s).some((r) => r.pass && r.tree === tree) : named(results(), s)?.status === 'PASS')).length;
  let req = { proved: 0, total: 0 };
  try { const rows = trace(repo, run, recs).rows; req = { proved: rows.filter((r) => r.proofs.length).length, total: rows.length }; } catch { /* a damaged requirement list: the gate names it */ }
  return { scenarios: { passed, total: sc.length }, requirements: req };
}

// The gates (ci left out), the reviews still owed and the proof counts, kept while their inputs
// stay the same: HEAD, the working tree's status, the run's files and how each agent stands.
async function gated(repo, run, team, cache) {
  const dir = runDir(repo);
  const key = createHash('sha1').update(JSON.stringify([git(['rev-parse', 'HEAD'], repo), git(['status', '--porcelain'], repo),
    ...['run.json', 'records.jsonl', 'findings.jsonl', 'brief.json'].map((f) => stamp(join(dir, f))), team.filter((r) => r.id !== 'main').map((r) => `${r.id}:${r.state}`)])).digest('hex');
  if (cache.gates?.key === key) return cache.gates.value;
  const recs = readRecords(repo, { run: run.id });
  let rows = null, due = null, error = '';
  try { rows = await gates(repo, run, { ci: false }); } catch (e) { error = String(e.message || e); }
  try { due = await owed(repo, run); } catch (e) { error ||= String(e.message || e); }
  const value = { rows, owed: due, ...proofs(repo, run, recs), error };
  cache.gates = { key, value };
  return value;
}

// Each slice of brief.json, landed when the branch changes every file it owns against the run's
// base, building while a Builder whose prompt names it runs, else waiting.
function slicesOf(repo, run, team) {
  const brief = json(join(runDir(repo), 'brief.json'));
  const list = (brief?.slices || []).map((s, i) => ({ name: String(s.name || s.id || `slice ${i + 1}`), files: (s.files || []).map(String) }));
  if (!list.length) return [];
  let changed = new Set();
  if (run) { try { changed = new Set(git(['diff', '--name-only', `${patchesOf(repo, run.target).base}..HEAD`], repo).split('\n').filter(Boolean)); } catch { /* no base yet */ } }
  return list.map((s) => {
    const landed = s.files.length > 0 && s.files.every((f) => changed.has(f));
    const building = team.some((r) => r.state === 'running' && r.slice === s.name);
    return { ...s, landed, state: landed ? 'landed' : building ? 'building' : 'waiting' };
  });
}

export async function status(repo, { session = '', now = Date.now(), withGates = false } = {}) {
  const st = runState(repo);
  if (st.error) throw new Error(st.error);
  const run = st.run;
  const dir = runDir(repo);
  session ||= process.env.CLAUDE_CODE_SESSION_ID || run?.session || '';
  const cache = readCache(session || '-');
  const scan = session ? scanSession(session, cache) : null;
  const main = scan?.main;
  const lastEnded = endedRuns(repo)[0]?.endedAt || 0;
  const lpkAt = main?.lpkAt && Date.parse(main.lpkAt) > lastEnded ? Date.parse(main.lpkAt) : 0;
  // The band belongs to the session that holds the run, or, before `lpk run start`, to the session
  // that invoked /lpk after the last run of this repo ended.
  const mine = run ? !run.session || !session || run.session === session : Boolean(lpkAt);
  const started = run ? Math.min(run.started, lpkAt && lpkAt <= run.started ? lpkAt : run.started) : lpkAt;
  const sliceNames = (json(join(dir, 'brief.json'))?.slices || []).map((s, i) => String(s.name || s.id || `slice ${i + 1}`));
  const team = crew(scan, { since: started || now, now, slices: sliceNames });
  const recs = run ? readRecords(repo, { run: run.id }) : [];
  const decisions = readDecisions(repo).filter((d) => Date.parse(d.at) >= (started || 0));
  let findings = [], ledgerError = '';
  if (run) { try { findings = ledgerFor(repo, run); } catch (e) { ledgerError = String(e.message || e); } }
  // Before the first review no step reads the gates, so the band does not pay for them; the pane asks.
  const g = run && (withGates || recs.some((r) => r.kind === 'review-start')) ? await gated(repo, run, team, cache) : null;
  if (session) writeCache(session, cache);
  const asks = main?.asks?.length || 0;
  const agentsRun = team.some((r) => r.id !== 'main' && r.state === 'running');
  // The Captain ended its turn and no agent runs: the next move is the owner's.
  const yourTurn = Boolean(main?.waiting && !asks && !agentsRun);
  const lastMove = Math.max(0, ...team.map((r) => Date.parse(r.lastAt || '') || 0));
  const quietMs = lastMove ? now - lastMove : 0;
  const slices = slicesOf(repo, run, team);
  const f = { run, lane: run?.lane || '', briefMd: existsSync(join(dir, 'brief.md')), round: designRound(decisions), reviewStarts: recs.filter((r) => r.kind === 'review-start'),
    handover: recs.some((r) => r.kind === 'handover'), proveRecords: recs.some((r) => r.kind === 'prove'), findings, gates: g?.rows || null, owed: g?.owed || null,
    team, slices, asks, captainAction: main?.action || '', scenarios: g?.scenarios, requirements: g?.requirements };
  const { phase, phasesVisited, track, net } = phaseOf(f);
  const waits = [
    ...(asks ? [{ what: 'question', why: 'the Captain asked you a question' }] : []),
    ...(yourTurn ? [{ what: 'reply', why: 'the Captain ended its turn and no agent runs' }] : []),
    ...findings.filter((x) => needsOwner(x) && !waived(repo, run.id, x.id)).map((x) => ({ what: x.id, why: `${x.state}${x.by ? ` by ${x.by}` : ''}` })),
    ...(g?.rows || []).filter((r) => !r.holds && String(r.wayOut || '').startsWith('or the owner waives')).map((r) => ({ what: `gate:${r.gate}`, why: String(r.why || '').split('\n')[0] })),
  ];
  const tokens = scan ? tokensOf([main, ...scan.agents.map((a) => a.st)].filter(Boolean), started || now) : { fresh: 0, cacheRead: 0 };
  return {
    v: 1, repo, session, open: Boolean(mine && (run || lpkAt)), mine,
    run: run ? { id: run.id, lane: run.lane, target: run.target, branch: run.branch || null, started: new Date(run.started).toISOString() } : null,
    phase, phasesVisited, track, elapsedMs: started ? now - started : 0, activeMs: activeMs(scan, team, { since: started || now, now }),
    // Nothing in the run wrote a line for STALL_MS while nothing waits on the owner.
    quietMs, stuck: quietMs > STALL_MS && !asks && !yourTurn,
    tokens, phaseDetail: phaseDetail(phase, f, net), lane: f.lane, slices,
    gates: g?.rows ? { holding: g.rows.filter((r) => r.gate !== 'plan' && r.holds).length, total: g.rows.filter((r) => r.gate !== 'plan').length, rows: g.rows.map(({ gate, holds, read, why }) => ({ gate, holds, read, why })) } : null,
    findings: { ...counts(findings), ...(ledgerError ? { error: ledgerError } : {}) }, waits, team,
    ...(g?.error ? { error: g.error } : {}),
  };
}
