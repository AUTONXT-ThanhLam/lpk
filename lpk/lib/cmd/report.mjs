// `lpk report`: the numbers of the run's report, every one from code, after the gates ran. The
// verdict line says "deliverable" only when every delivery gate holds on the HEAD it names; the
// session adds the verdict in words, the decisions it took alone and the weakest point.
import { existsSync, readFileSync } from 'node:fs';
import { counts } from '../findings-text.mjs';
import { knownLimits } from '../bar.mjs';
import { BORN, needsOwner, stateOf } from '../findings.mjs';
import { failing, gates, gatesText } from '../gates.mjs';
import { git } from '../git.mjs';
import { REACH } from '../reach.mjs';
import { evidence, ledgerFor } from '../owed.mjs';
import { capped, parseArgs, repoOf } from '../out.mjs';
import { named, proofsOf, proverResults, trace } from '../proof.mjs';
import { readDecisions, readRecords } from '../records.mjs';
import { promptsOf, readRun } from '../run.mjs';
import { runRow } from '../runs.mjs';
import { runHere } from './gates.mjs';

// A finding the owner reads in the report: its ruling (for an unsettled one, the ruling asked and
// the protected area that kept it open), who made it, the claim and the evidence.
const asked = (f) => [f.asked && `asked ${f.asked}${f.basis ? `: ${f.basis}` : ''}`, f.area && `area ${f.area}`].filter(Boolean).join(', ');
const ruling = (f) => (f.state === 'fixed'
  ? `- ${f.id} fixed by ${f.fixedBy}: ${f.claim} — ${f.fixEvidence}${f.sweep ? ` (swept for ${f.sweep.pattern}: ${f.sweep.before} before the fix${f.sweep.preexisting.length ? `, still on older lines ${f.sweep.preexisting.join(', ')}` : ''})` : ''}`
  : `- ${f.id} ${f.state === 'duplicate' ? `duplicate of ${f.primary}` : f.state}${f.state === 'unsettled' && asked(f) ? ` (${asked(f)})` : ''}${f.by ? ` by ${f.by}` : ''}: ${f.claim} — ${f.evidence}`);
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const CLIP = 600;
function ownerWords(repo, run) {
  if (readRun(repo)?.id !== run.id) return 'Owner words during the run: not listed, the run has ended (`lpk run end` named the file of them)';
  const file = promptsOf(run.marker);
  const rows = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [String(JSON.parse(l).prompt || '').trim()]; } catch { return []; } }).filter(Boolean) : [];
  if (!rows.length) return 'Owner words during the run: none recorded';
  return [`Owner words during the run (${rows.length}), each to be set beside the requirement and proof that delivered it, or marked not delivered:`,
    ...rows.map((w, i) => `${i + 1}. ${(w.length > CLIP ? `${w.slice(0, CLIP)} [+${w.length - CLIP} chars in ${file}]` : w).replace(/\n/g, '\n   ')}`)].join('\n');
}

const wallEnd = (repo, run) => run.endedAt || Math.max(0, ...readRecords(repo, { run: run.id }).map((r) => Date.parse(r.at) || 0)) || Date.now();

export async function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk report [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  let run;
  try { run = runHere(repo); } catch (e) { console.error(`lpk: ${e.message}`); return 1; }
  if (!run) { console.error('lpk: no lpk run delivers this branch'); return 1; }
  const rows = await gates(repo, run);
  const bad = failing(rows);
  const head = git(['rev-parse', '--short=12', 'HEAD'], repo).trim();
  const out = [
    bad.length ? `NOT deliverable at ${head}: ${bad.map((r) => r.gate).join(', ')} do not hold` : `deliverable at ${head}: every delivery gate holds`,
    `run ${run.id}, ${run.lane} lane${run.laneWhy ? ` (${run.laneWhy})` : ''}, branch ${run.branch || 'none'}, wall ${Math.round((wallEnd(repo, run) - run.started) / 60000)} min`,
    '', 'Gates:', gatesText(rows),
  ];
  const facts = [];
  try {
    const ledger = ledgerFor(repo, run);
    const c = counts(ledger);
    facts.push(`Findings: ${c.total} raised; ${['confirmed', 'fixed', 'deferred', 'dropped', 'preexisting', 'unsettled', 'open'].map((s) => `${c[s]} ${s}`).join(', ')}, ${c.duplicate} duplicate; ${ledger.filter((f) => f.kind === 'test-gap').length} test gaps`);
    const born = BORN.map((b) => [b, ledger.filter((f) => f.born === b && ['confirmed', 'fixed', 'deferred'].includes(stateOf(f, ledger))).length]).filter(([, n]) => n);
    if (born.length) facts.push(`Confirmed defects by the step they began in: ${born.map(([b, n]) => `${b} ${n}`).join(', ')}`);
    const reach = REACH.map((r) => [r, ledger.filter((f) => f.reach === r && ['confirmed', 'fixed', 'deferred'].includes(stateOf(f, ledger))).length]).filter(([, n]) => n);
    if (reach.length) facts.push(`Confirmed defects by who meets them: ${reach.map(([r, n]) => `${r} ${n}`).join(', ')}`);
    const deferred = [...ledger.filter((f) => f.state === 'deferred'), ...knownLimits(repo, run, ledger.filter((f) => f.state === 'confirmed' && f.kind !== 'test-gap'))];
    if (deferred.length) facts.push(['Known limits, not fixed (for the PR body):', ...deferred.map((f) => `- ${f.id} ${f.kind}/${f.severity}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.claim} — ${f.deferEvidence || 'confirmed; a known limit of the increment bar'}`)].join('\n'));
    const toRead = ledger.filter(needsOwner);
    if (toRead.length) facts.push(['For the owner to read, not blocking:', ...toRead.map(ruling)].join('\n'));
    const ran = {};
    for (const i of evidence(repo, run, ledger).items) { ran[i.key] = (ran[i.key] || 0) + 1; }
    facts.push(`Lenses that ran: ${Object.entries(ran).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}`);
  } catch (e) { facts.push(`Findings and lenses could not be read: ${e.message}`); }
  const recs = readRecords(repo, { run: run.id });
  if ((run.scenarios || []).length) {
    let judged;
    try { judged = proverResults(repo, run).results; } catch { judged = []; }
    const tree = git(['rev-parse', 'HEAD^{tree}'], repo).trim();
    const cell = (x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const status = (s) => {
      if (s.cmd) { const last = proofsOf(recs, s).filter((r) => r.tree === tree).at(-1); return last ? (last.pass ? 'PASS' : 'FAIL') : 'NOT PROVED'; }
      const r = named(judged, s);
      return r && ['PASS', 'FAIL'].includes(r.status) ? r.status : 'NOT PROVED';
    };
    facts.push(['Scenarios:', '| S | Scenario | Status on HEAD |', '|---|---|---|',
      ...run.scenarios.map((s) => `| ${s.id} | ${s.cmd ? `\`${cell(s.cmd)}\`` : `${cell(s.agentJudged)} (agent-judged)`} | ${status(s)} |`)].join('\n'));
  }
  // R -> proof as a Markdown table, so the PR body can carry it as it stands.
  try {
    const t = trace(repo, run, recs);
    const cell = (x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    facts.push(t.rows.length ? [`Requirements (${t.from}):`, '| R | Requirement | Source | Proof |', '|---|---|---|---|',
      ...t.rows.map((r) => `| ${r.id} | ${cell(r.text)} | ${cell(r.source)} | ${cell(r.proofs.join('; ') || `UNPROVED: ${r.notes.join('; ') || 'nothing names it'}`)} |`)].join('\n') : 'Requirements: none numbered');
  } catch (e) { facts.push(`Requirements could not be traced: ${e.message}`); }
  facts.push(ownerWords(repo, run));
  facts.push(`Verify runs: ${recs.filter((r) => r.kind === 'verify' && !r.final).length}${recs.some((r) => r.final) ? ` (and ${recs.filter((r) => r.final).length} final)` : ''}; reviewed ranges: ${recs.filter((r) => r.kind === 'review-start').map((r) => r.range).join(', ') || 'none recorded'}`);
  try {
    const row = run.ended ? null : runRow(repo);
    if (row) facts.push(`Tokens by job: ${Object.entries(row.agents).map(([k, v]) => `${k} ${fmt(v.fresh)} fresh, ${fmt(v.cacheRead)} cache reads`).join('; ') || 'none measured'}`);
  } catch (e) { facts.push(`Tokens could not be measured: ${e.message}`); }
  const decided = readDecisions(repo, { run: run.id });
  console.log(capped(repo, `report-${run.id}`, [...out, '', ...facts, '', `Decided without the owner (${decided.length}):`], decided.map((d) => `- ${d.what}: ${d.why}`)));
  return bad.length ? 1 : 0;
}
