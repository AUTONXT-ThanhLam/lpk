// `lpk waive <id>... --why "<text>"`: the owner's release of what a gate or tripwire holds, one
// record per id (`gate:<name>`, `connector:<tool>` or `git:<command>`; a bare gate row name becomes
// `gate:<row>`). It is the owner's channel: /lpk-waive calls it with `--via /lpk-waive`.
// Run by an agent it records `via: cli`, which no gate accepts as the owner's waiver.
import { parseArgs, repoOf } from '../out.mjs';
import { sessionId } from '../host.mjs';
import { appendRecord } from '../records.mjs';
import { activeRun, runHere } from '../run.mjs';

const ROWS = ['verify', 'findings', 'reviews', 'scenarios', 'requirements', 'ci', 'learn', 'tests-first', 'error'];
const VIA = ['cli', '/lpk-waive', 'ask'];
const FINDING = /^F\d+$/;
const NOT_FINDINGS = 'a finding id is not waived; the findings gate is `gate:findings`';
const USAGE = 'usage: lpk waive <id>... --why "<the owner\'s words>" [--via /lpk-waive|ask] [--repo <dir>]\n  (only the owner\'s /lpk-waive or the waiver question records a waiver the gates accept; an agent running this records via cli, which counts for nothing)';

export function main(argv) {
  const a = parseArgs(argv, ['--why', '--via', '--repo']);
  const via = a.opt?.('--via') || 'cli';
  if (a.error || !a.words.length || !a.opt('--why') || !VIA.includes(via)) { console.error(`lpk: ${a.error || (!VIA.includes(via) ? `--via is one of ${VIA.join(', ')}` : 'name what is waived and --why')}\n${USAGE}`); return 2; }
  const findings = a.words.filter((w) => FINDING.test(w));
  if (findings.length) { console.error(`lpk: ${findings.join(', ')}: ${NOT_FINDINGS}\n${USAGE}`); return 2; }
  const here = repoOf(a.opt('--repo'));
  let own = null;
  try { own = here && runHere(here); } catch { own = null; }
  const run = own || (a.opt('--repo') ? null : activeRun(sessionId(), false, process.cwd()));
  if (!run) { console.error('lpk: no lpk run in this repo, and this session holds none elsewhere; a waiver belongs to a run'); return 1; }
  const repo = own ? here : run.repo;
  for (const w of a.words) {
    const what = ROWS.includes(w) ? `gate:${w}` : w;
    appendRecord(repo, { kind: 'waiver', run: run.id, what, why: a.opt('--why'), by: 'owner', via, session: sessionId() || null, exit: 0 });
    console.log(`waived ${what} in run ${run.id} via ${via}${via === 'cli' ? ' (not an owner waiver: the gates ignore it)' : ''}`);
  }
  return 0;
}
