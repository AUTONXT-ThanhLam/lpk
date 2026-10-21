// `lpk status [--json] [--gates] [--session <id>] [--repo <dir>]`: where the lpk run of this repo stands, as
// facts: its step (and the steps it went through), its time against the owner's bound, the fresh
// tokens of the session, what matters in this step, the team of the session that runs now and what
// waits on the owner. Fast and local: no gh, no network. The gates are read from the first review
// on, or always with --gates.
import { parseArgs, repoOf } from '../out.mjs';
import { status } from '../status.mjs';

const NAMES = { understand: 'Understand', design: 'Design', build: 'Build', review: 'Review', fix: 'Fix', prove: 'Prove', deliver: 'Deliver' };
// A duration as the band shows it: seconds under a minute, minutes under an hour, then hours.
const mins = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`; };
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const MARK = { landed: '●', building: '◐', waiting: '○' };

// The step's own line, as the band prints it.
export function detailText(s) {
  const d = s.phaseDetail;
  switch (s.phase) {
    case 'understand': return [d.doing, d.openQuestions ? `${d.openQuestions} open question` : ''].filter(Boolean).join(' · ');
    case 'design': return d.round ? `round ${d.round}: ${d.verdict}, ${d.high} High / ${d.medium} Medium / ${d.low} Low${d.running.length ? ` · running: ${d.running.join(', ')}` : ''}` : `brief written, no review round yet${d.running.length ? ` · running: ${d.running.join(', ')}` : ''}`;
    case 'build': return d.slices.length ? d.slices.map((x) => `${MARK[x.state]} ${x.name}`).join('  ') : 'one slice (no brief.json slices)';
    case 'review': return `lenses ${d.lensesDone}/${d.lenses}${d.owed ? ` · ${d.owed} owed` : ''} · findings ${d.raised} raised · ${d.confirmed} confirmed · ${d.dropped} dropped${d.verifiersRunning ? ` · ${d.verifiersRunning} verifying` : ''}`;
    case 'fix': return `${d.left.length ? `to fix: ${d.left.join(' ')}` : 'nothing left to fix'} · ${d.fixed} fixed · delta review ${d.delta}`;
    case 'prove': return `scenarios ${d.scenarios?.passed ?? 0}/${d.scenarios?.total ?? 0} · requirements ${d.requirements?.proved ?? 0}/${d.requirements?.total ?? 0}`;
    default: return `gates ${d.holding}/${d.total}${d.firstDeny ? ` · ${d.firstDeny.gate}: ${d.firstDeny.why}` : ''}`;
  }
}

// The team rows the owner needs now: the agents that run, identical titles grouped when more than
// three run, then each failed agent no later agent of its title and work has taken over.
export function runningRows(team) {
  const rows = team.filter((r) => r.id !== 'main' && r.state === 'running');
  const failed = team.filter((r) => r.state === 'failed' && !team.some((x) => x !== r && x.title === r.title && x.what === r.what && Date.parse(x.startedAt) >= Date.parse(r.lastAt)));
  const by = new Map();
  for (const r of rows) by.set(r.title, [...(by.get(r.title) || []), r]);
  return [...[...by.values()].flatMap((g) => (g.length > 3
    ? [{ title: `${g[0].title} ×${g.length}`, what: g.map((r) => r.finding || r.slice || r.what).filter(Boolean).join(' '), action: '', state: 'running', elapsedMs: Math.max(...g.map((r) => r.elapsedMs)), ...(g.some((r) => r.stalledMs) ? { stalledMs: Math.max(...g.map((r) => r.stalledMs || 0)) } : {}) }]
    : g)), ...failed];
}

// The band's wording, so the mod only draws: the track with each step's state, the head line, the
// step's own line, one row per agent the owner needs to see and what waits on the owner.
export function viewOf(s) {
  const at = s.track.indexOf(s.phase);
  const rows = runningRows(s.team).map((r) => ({ title: r.title, what: r.what || '',
    note: r.state === 'failed' ? `failed: ${r.reason || 'no reason given'}` : r.stalledMs ? `stalled ${mins(r.stalledMs)}` : r.action || '', elapsed: mins(r.elapsedMs) }));
  return {
    track: s.track.map((p, i) => ({ name: NAMES[p], state: i === at ? 'current' : s.phasesVisited.includes(p) ? 'visited' : 'next' })),
    quiet: s.stuck ? `nothing moved for ${mins(s.quietMs)}` : '',
    head: `worked ${mins(s.activeMs)} · ${tokens(s.tokens.fresh)} tokens${s.lane ? ` · ${s.lane} lane` : ''}`,
    detail: detailText(s), rows,
    waits: s.waits.map((w) => w.what).join(', '),
    line: `lpk ${NAMES[s.phase]}${s.stuck ? ' · quiet' : ''} · ${mins(s.activeMs)}${s.waits.length ? ' · waits on you' : ''}`,
  };
}

export function statusText(s) {
  if (!s.open) return s.run ? `lpk run ${s.run.id} belongs to another session` : 'no lpk run in this repo';
  const v = viewOf(s);
  const track = v.track.map((p) => (p.state === 'current' ? `[${p.name}]` : p.name)).join(' › ');
  const lines = [[track, v.quiet, v.head].filter(Boolean).join(' · '), v.detail];
  for (const r of v.rows) lines.push(`  ${[r.title, r.what, r.note, r.elapsed].filter(Boolean).join('  ')}`);
  if (s.waits.length) lines.push(`waits on you: ${s.waits.map((w) => `${w.what} (${w.why})`).join('; ')}`);
  if (s.error) lines.push(`error: ${s.error}`);
  return lines.join('\n');
}

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--session'], ['--json', '--gates']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk status [--json] [--gates] [--session <id>] [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  let s;
  try { s = await status(repo, { session: a.opt('--session') || '', withGates: a.flags.has('--gates') }); } catch (e) {
    if (a.flags.has('--json')) console.log(JSON.stringify({ v: 1, repo, open: false, error: String(e.message || e) }));
    else console.error(`lpk: ${e.message || e}`);
    return 1;
  }
  console.log(a.flags.has('--json') ? JSON.stringify(s.open ? { ...s, view: viewOf(s) } : s) : statusText(s));
  return 0;
}
