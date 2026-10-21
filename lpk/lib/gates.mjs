// The delivery gates of a run, each from what the CLI ran or computed: git facts, its own records,
// the findings ledger and the agents' transcripts. A gate with no evidence does not hold. A gate
// whose own code fails does not hold either, and names the error; the owner's waiver of that gate
// (`gate:<name>`) is the way out.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { needsOwner, readLedger, stateOf } from './findings.mjs';
import { ledgerFor, owed } from './owed.mjs';
import { patchesOf } from './patches.mjs';
import { lastProver, named, proofsOf, trace, verifiedGreen } from './proof.mjs';
import { ciFacts } from './ci.mjs';
import { readRecords, waived } from './records.mjs';
import { readRun, runDir } from './run.mjs';
import { headTree, untrackedCode } from './tree.mjs';

const list = (xs, n = 8) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` and ${xs.length - n} more` : ''}`;
const short = (s) => String(s || '').slice(0, 12);

function verifyGate(repo, run, recs) {
  const tree = headTree(repo);
  const untracked = untrackedCode(repo);
  const last = run.verified;
  const read = `HEAD^{tree} ${short(tree)}; last verify ${last ? `${last.green ? 'green' : 'RED'} on ${short(last.id)}` : 'never ran'}`;
  if (untracked.length) return { holds: false, read, why: `code files that are not committed: ${list(untracked)}`, wayOut: `add or ignore ${list(untracked)}, then \`lpk verify\`` };
  if (verifiedGreen(run, recs, tree)) return { holds: true, read, why: '' };
  return { holds: false, read, why: 'no green `lpk verify` of the run\'s current checks on HEAD\'s tree', wayOut: 'run `lpk verify` on the committed tree until it is green' };
}

function findingsGate(repo, run) {
  const all = ledgerFor(repo, run);
  const open = all.filter((f) => stateOf(f, all) === 'open' && f.state !== 'duplicate');
  const unfixed = all.filter((f) => f.state === 'confirmed' && f.kind !== 'test-gap');
  // Unsettled findings and rulings made by someone other than the verifier do not block: they are
  // named here and in `lpk report`, for the owner to read.
  const owner = all.filter(needsOwner);
  const why = [open.length && `open, no verifier ruling: ${list(open.map((f) => f.id))}`, unfixed.length && `confirmed and not fixed: ${list(unfixed.map((f) => f.id))}`].filter(Boolean);
  const note = owner.length ? `for the owner to read (not blocking): unsettled, or ruled by someone other than the verifier: ${list(owner.map((f) => `${f.id} (${f.state}${f.by ? ` by ${f.by}` : ''})`))}` : '';
  // The ledger tools read only the live ledger: once a later run has archived this ended run's
  // findings, no agent can rule on or close them, and only the owner's waiver is left.
  const archived = why.length && run.ended && !readLedger(repo).findings.some((f) => f.run === run.id);
  return { holds: !why.length, read: `ledger: ${all.length} findings of run ${run.id}`, why: [...why, note].filter(Boolean).join('; '),
    wayOut: archived ? `run ${run.id} has ended and a later run archived its findings, so no agent can rule on or close them any more`
      : [open.length && 'have a verifier rule on the open ones', unfixed.length && 'fix the confirmed ones and close each with finding_fixed'].filter(Boolean).join('; ') };
}

async function reviewsGate(repo, run) {
  const rows = await owed(repo, run);
  return { holds: !rows.length, read: `owed lenses on ${run.lane} lane`, why: list(rows.map((r) => `${r.lens} on ${r.range} (${r.why})`), 6), wayOut: 'run what `lpk reviews owed` lists, on those ranges' };
}

function scenariosGate(repo, run, recs) {
  const sc = run.scenarios || [];
  if (!sc.length) return { holds: false, read: 'run.json scenarios', why: 'the run records no scenario', wayOut: 'record them: `lpk run start --scenario "<cmd>" [--expect "<text>"]` or `--judged "<scenario>"` (it amends the open run)' };
  const tree = headTree(repo);
  const why = [];
  for (const s of sc.filter((x) => x.cmd)) {
    const mine = proofsOf(recs, s);
    if (!mine.some((r) => r.pass && r.tree === tree)) why.push(`${s.id} not proved on HEAD's tree${mine.length ? ` (last: ${mine.at(-1).pass ? 'pass' : 'FAIL'} on ${short(mine.at(-1).tree)})` : ''}`);
  }
  const judged = sc.filter((x) => x.agentJudged);
  if (judged.length) {
    const p = lastProver(repo, run);
    if (!p) why.push(`no Prover run on HEAD's code for ${list(judged.map((s) => s.id))}`);
    else { const miss = judged.filter((s) => !named(p.structured.results || [], s)); if (miss.length) why.push(`Prover ${p.agentId} did not list ${list(miss.map((s) => s.id))}`); }
  }
  return { holds: !why.length, read: `${sc.length} scenarios; \`lpk prove\` records; Prover transcripts`, why: why.join('; '), wayOut: '`lpk prove --all` on the committed tree; the Prover on the reviewed range for the agent-judged ones' };
}

// Every numbered requirement proved on HEAD. A Quick run given none only prints that; a Full run
// whose brief numbers none is denied, because then nothing ties the proof to what the owner asked.
function requirementsGate(repo, run, recs) {
  const t = trace(repo, run, recs);
  if (!t.rows.length) {
    if (run.lane === 'quick') return { holds: true, print: true, read: 'run.json requirements', why: 'none were recorded (`lpk run start --req "<text>"`)' };
    return { holds: false, read: `${t.from} requirements`, why: 'the brief has no numbered requirements', wayOut: 'number them in brief.json `requirements` ({ id: "R1", text, source }) and name in each scenario and failure row the ids it `proves`' };
  }
  const bad = t.rows.filter((r) => !r.proofs.length);
  return { holds: !bad.length, read: `${t.rows.length} requirements in ${t.from}; scenarios, failure rows and tests that name them`,
    why: bad.map((r) => `${r.id} unproved (${r.notes.join('; ') || 'no scenario, failure row or added test names it'})`).join('; '),
    wayOut: `prove ${list(bad.map((r) => r.id))}: a scenario or failure row that \`proves\` it, green or Prover PASS on HEAD, or a test naming it on a line the change adds, with \`lpk verify\` green` };
}

function ciGate(repo, run) {
  if (!hasCI(repo)) return { holds: true, read: 'no GitHub Actions workflow in the repo', why: '' };
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repo).trim();
  let pr;
  try { pr = JSON.parse(execFileSync('gh', ['pr', 'view', branch, '--json', 'number'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })).number; } catch (e) {
    if (!/no pull requests found/i.test(String(e.stderr))) throw new Error(`gh pr view ${branch}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
  if (!pr) return { holds: false, read: `no PR for ${branch}`, why: 'no PR yet', wayOut: 'push and open the PR as a draft first' };
  const c = ciFacts(repo, pr);
  const head = git(['rev-parse', 'HEAD'], repo).trim();
  const read = `PR #${pr} at ${short(c.head)}; ${c.runs} workflow runs; red jobs: ${c.jobs.length}`;
  if (c.head !== head) return { holds: false, read, why: `the PR head is not HEAD ${short(head)}`, wayOut: 'push HEAD and wait for its checks' };
  if (c.pending.length) return { holds: false, read, why: `still running: ${list(c.pending)}`, wayOut: 'wait for them' };
  const here = c.jobs.filter((j) => j.onlyHere);
  return { holds: !here.length, read, why: here.map((j) => `${j.workflow} / ${j.job}: ${j.verdict}`).join('; '), wayOut: 'fix them (`lpk ci` names each job and its rerun)' };
}

const hasCI = (repo) => existsSync(join(repo, '.github', 'workflows')) && readdirSync(join(repo, '.github', 'workflows')).some((n) => /\.ya?ml$/.test(n));

// Facts the owner may want before handover; it never holds a delivery back.
function planGate(repo, run, recs) {
  const facts = [];
  const brief = join(runDir(repo), 'brief.json');
  if (existsSync(brief)) {
    const slices = JSON.parse(readFileSync(brief, 'utf8')).slices || [];
    const owned = new Set(slices.flatMap((s) => s.files || []));
    const changed = git(['diff', '--name-only', `${patchesOf(repo, run.target).base}..HEAD`], repo).split('\n').filter(Boolean);
    const beyond = changed.filter((f) => !owned.has(f));
    if (slices.length && beyond.length) facts.push(`files beyond every slice: ${list(beyond)}`);
  }
  const go = recs.filter((r) => r.kind === 'go').at(-1);
  if (go?.verify && go.verify.join('\n') !== (run.verify || []).join('\n')) facts.push(`checks changed after go: ${list(go.verify)} → ${list(run.verify || [])}`);
  return { holds: true, read: existsSync(brief) ? 'brief.json slices; the go record' : 'no brief.json', why: facts.join('; ') };
}

// Every gate row for `run`, judged in the checkout `repo` (where its branch is checked out). `ci`
// false leaves the ci row out of what holds (it applies to `gh pr ready`).
export async function gates(repo, run = readRun(repo), { ci = true } = {}) {
  if (!run) throw new Error('no lpk run in this repo');
  const recs = readRecords(repo, { run: run.id });
  const out = [];
  const steps = { verify: () => verifyGate(repo, run, recs), findings: () => findingsGate(repo, run), reviews: () => reviewsGate(repo, run), scenarios: () => scenariosGate(repo, run, recs), requirements: () => requirementsGate(repo, run, recs), ci: () => ciGate(repo, run), plan: () => planGate(repo, run, recs) };
  for (const [gate, fn] of Object.entries(steps)) {
    if (gate === 'ci' && !ci) continue;
    let row;
    try { row = await fn(); } catch (e) { row = { holds: false, read: '', why: `the gate failed: ${String(e.message || e).split('\n')[0]}`, wayOut: '' }; }
    if (!row.holds && waived(repo, run.id, `gate:${gate}`)) row = { ...row, holds: true, why: `waived by the owner (${row.why})` };
    else if (!row.holds) row.wayOut = [row.wayOut, `or the owner waives it (option \`gate:${gate}\`)`].filter(Boolean).join('; ');
    out.push({ gate, ...row });
  }
  return out;
}

export const failing = (rows) => rows.filter((r) => !r.holds && r.gate !== 'plan');
export const gatesText = (rows) => rows.map((r) => `${r.gate.padEnd(12)} ${r.gate === 'plan' || r.print ? 'print' : r.holds ? 'holds' : 'DENY '}  ${r.read}${r.why ? `\n             ${r.why}` : ''}${!r.holds && r.wayOut ? `\n             → ${r.wayOut}` : ''}`).join('\n');
