// Which step of the lpk flow a run is in, and what matters in that step, from exact facts only:
// the run's files (run.json, brief.md, brief.json, records, decisions, the findings ledger), the
// local gates and the session's transcripts. The rule, checked from the last step back:
//
// - deliver: a handover record (the PR was asked for), or a review has started, nothing of its net
//   runs, no lens is owed, no confirmed finding is left and the scenarios and requirements gates
//   hold (the line names the first gate still denying, verify or findings among them).
// - fix: a review has started, and either confirmed findings are not fixed while no lens or
//   Verifier of the review net runs, or a fixed finding's delta review is still owed or running.
// - prove: as deliver, but the scenarios or the requirements gate still denies.
// - review: the run has a review-start record (`lpk review start`).
// - build: a run is open (`lpk run start` opens the build step).
// - design: no run is open and brief.md is written, or a design review round was decided.
// - understand: none of the above.
//
// A step is visited when its own fact held at some point (brief.md or a design round, the run, a
// review start, a confirmed finding, a prove record or a Prover's report) or it is the current one.
// The track leaves out a step before the current one that was never visited: the Quick lane's
// design, a fix no finding needed.

export const PHASES = ['understand', 'design', 'build', 'review', 'fix', 'prove', 'deliver'];
const LENSES = new Set(['techlead', 'bug-hunter', 'security', 'regression', 'claims', 'ocr', 'prover', 'mutant', 'verifier', 'perf', 'a11y', 'ui-reviewer']);
const keyOf = (type) => String(type || '').split(':').pop();
const isNet = (r) => r.id !== 'main' && (['Review', 'Verify'].includes(r.workflowPhase) || LENSES.has(keyOf(r.type)) || /^(Code|Security) reviewer$/.test(r.title));
const ROUND = /^design review round (\d+): (\w+), (\d+)\/(\d+)\/(\d+)/i;

// The newest design review round recorded with `lpk decide "design review round <n>: <verdict>,
// <High>/<Medium>/<Low>"`, as design.md tells the Captain to record it.
export function designRound(decisions) {
  const d = [...decisions].reverse().find((x) => ROUND.test(x.what || ''));
  if (!d) return null;
  const m = ROUND.exec(d.what);
  return { round: Number(m[1]), verdict: m[2], high: Number(m[3]), medium: Number(m[4]), low: Number(m[5]), at: d.at };
}

const gate = (rows, name) => rows?.find((r) => r.gate === name);
const holds = (rows, name) => Boolean(gate(rows, name)?.holds);

export function phaseOf(f) {
  const reviewed = f.reviewStarts.length > 0;
  const since = reviewed ? Date.parse(f.reviewStarts[0].at) : Infinity;
  const net = f.team.filter((r) => isNet(r) && Date.parse(r.startedAt) >= since);
  const netRuns = net.some((r) => r.state === 'running');
  const unfixed = f.findings.filter((x) => x.state === 'confirmed');
  const fixed = f.findings.filter((x) => x.state === 'fixed');
  const deltaOwed = (f.owed || []).filter((r) => /fix delta/.test(r.why));
  const confirmedEver = unfixed.length + fixed.length > 0;
  let phase = 'understand';
  if (f.run && f.handover) phase = 'deliver';
  else if (f.run && reviewed) {
    if ((unfixed.length && !netRuns) || (fixed.length && deltaOwed.length)) phase = 'fix';
    else if (netRuns || unfixed.length || (f.owed || []).length) phase = 'review';
    else if (holds(f.gates, 'scenarios') && holds(f.gates, 'requirements')) phase = 'deliver';
    else phase = 'prove';
  } else if (f.run) phase = 'build';
  else if (f.briefMd || f.round) phase = 'design';
  const at = PHASES.indexOf(phase);
  const proved = f.proveRecords || f.team.some((r) => keyOf(r.type) === 'prover');
  const fact = { understand: true, design: Boolean(f.briefMd || f.round), build: Boolean(f.run), review: reviewed, fix: confirmedEver, prove: proved, deliver: false };
  const visited = PHASES.filter((p, i) => i === at || (i < at && fact[p]));
  const track = PHASES.filter((p, i) => i >= at ? !(p === 'design' && f.lane === 'quick') : visited.includes(p));
  return { phase, phasesVisited: visited, track, net };
}

const count = (xs, fn) => xs.filter(fn).length;

// What matters in the current step only; the band prints it as line 2.
export function phaseDetail(phase, f, net) {
  const running = (pred) => f.team.filter((r) => r.state === 'running' && pred(r));
  if (phase === 'understand') return { doing: f.asks ? 'asking the owner' : f.captainAction || '', openQuestions: f.asks };
  if (phase === 'design') {
    const r = f.round;
    return { round: r?.round ?? 0, verdict: r?.verdict ?? '', high: r?.high ?? 0, medium: r?.medium ?? 0, low: r?.low ?? 0,
      running: running((x) => ['architect', 'design-critic', 'plan-sim', 'plan-trace'].includes(keyOf(x.type))).map((x) => x.title) };
  }
  if (phase === 'build') return { slices: f.slices.map(({ name, state }) => ({ name, state })) };
  const ids = (xs) => xs.map((x) => x.id);
  if (phase === 'review') {
    const lenses = net.filter((r) => keyOf(r.type) !== 'verifier');
    return { lensesDone: count(lenses, (r) => r.state !== 'running'), lenses: lenses.length, owed: (f.owed || []).length,
      raised: f.findings.length, confirmed: count(f.findings, (x) => ['confirmed', 'fixed', 'deferred'].includes(x.state)), dropped: count(f.findings, (x) => x.state === 'dropped'),
      verifiersRunning: count(net, (r) => r.state === 'running' && keyOf(r.type) === 'verifier') };
  }
  if (phase === 'fix') {
    const owed = (f.owed || []).filter((r) => /fix delta/.test(r.why));
    const lastFix = Math.max(0, ...f.findings.map((x) => Date.parse(x.fixedAt || '') || 0));
    const deltaRuns = net.some((r) => r.state === 'running' && Date.parse(r.startedAt) >= lastFix);
    return { left: ids(f.findings.filter((x) => x.state === 'confirmed')), fixed: count(f.findings, (x) => x.state === 'fixed'),
      delta: deltaRuns ? 'running' : owed.length ? 'owed' : count(f.findings, (x) => x.state === 'fixed') ? 'done' : 'not yet' };
  }
  if (phase === 'prove') return { scenarios: f.scenarios, requirements: f.requirements };
  const rows = (f.gates || []).filter((r) => r.gate !== 'plan');
  const deny = rows.find((r) => !r.holds);
  return { holding: count(rows, (r) => r.holds), total: rows.length, firstDeny: deny ? { gate: deny.gate, why: String(deny.why || '').split('\n')[0].slice(0, 120) } : null };
}
