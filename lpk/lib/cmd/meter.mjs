// `lpk meter [--session <id>]`: tokens per agent of one session (the run's, else the newest of this
// directory), from its transcripts, each API message once. Fresh = input + cache write + output;
// cache reads apart.
import { capped, parseArgs, repoOf } from '../out.mjs';
import { tokenFigure } from '../host.mjs';
import { latestSession, meter, total } from '../meter.mjs';
import { readRun } from '../run.mjs';

const USAGE = 'usage: lpk meter [--session <id>] [--json]';
const n = (x) => x.toLocaleString('en-US');

export async function main(argv) {
  const a = parseArgs(argv, ['--session'], ['--json']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf('.');
  const session = a.opt('--session') || (repo && readRun(repo)?.session) || latestSession(process.cwd());
  const rows = session && meter(session);
  if (!rows) { console.error(`lpk: no transcripts found for session ${session || '(none: give --session)'}`); return 1; }
  if (a.flags.has('--json')) { console.log(JSON.stringify({ session, total: total(rows), agents: rows })); return 0; }
  rows.sort((x, y) => y.fresh - x.fresh);
  const t = total(rows);
  const cost = tokenFigure(t.fresh, t.recorded);
  const head = [`session ${session}: ${rows.length} transcript(s), ${n(t.messages)} API messages; ${typeof cost === 'number'
    ? `fresh tokens ${n(cost)} (input + cache write + output), cache reads ${n(t.cacheRead)}`
    : cost}`];
  const body = rows.map((r) => `  ${r.agent}${r.label ? ` "${r.label.slice(0, 40)}"` : ''} ${r.agentId.slice(0, 17)}: fresh ${n(r.fresh)} (in ${n(r.input)} + write ${n(r.cacheWrite)} + out ${n(r.output)}), cache read ${n(r.cacheRead)}, ${r.messages} msgs, ${r.toolCalls} tool calls (${r.messages ? (r.toolCalls / r.messages).toFixed(2) : '0.00'} per msg), peak context ${n(r.peakContext)}, ${r.models.join('/') || 'no model'}`);
  console.log(capped(repo, `meter-${session}`, head, body));
  return 0;
}
