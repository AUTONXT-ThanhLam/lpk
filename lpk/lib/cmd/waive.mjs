// `lpk waive <id>... --why "<text>"`: the owner's release of what a gate or tripwire holds, one
// record per id (`gate:<name>`, `connector:<tool>` or `git:<command>`; a bare gate row name becomes
// `gate:<row>`). It is the owner's channel: /lpk-waive calls it with `--via /lpk-waive`.
// Run by an agent it records `via: cli`, which no gate accepts as the owner's waiver.
import { parseArgs, repoOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';
import { readRun } from '../run.mjs';

const ROWS = ['verify', 'findings', 'reviews', 'scenarios', 'requirements', 'ci', 'error'];
const VIA = ['cli', '/lpk-waive', 'ask'];
const FINDING = /^F\d+$/;
const NOT_FINDINGS = 'finding ids are not waived: unsettled findings and rulings not made by the verifier do not block, and `lpk report` lists them for the owner to read';
const USAGE = 'usage: lpk waive <id>... --why "<the owner\'s words>" [--via /lpk-waive|ask] [--repo <dir>]\n  (only the owner\'s /lpk-waive or the waiver question records a waiver the gates accept; an agent running this records via cli, which counts for nothing)';

export function main(argv) {
  const a = parseArgs(argv, ['--why', '--via', '--repo']);
  const via = a.opt?.('--via') || 'cli';
  if (a.error || !a.words.length || !a.opt('--why') || !VIA.includes(via)) { console.error(`lpk: ${a.error || (!VIA.includes(via) ? `--via is one of ${VIA.join(', ')}` : 'name what is waived and --why')}\n${USAGE}`); return 2; }
  const findings = a.words.filter((w) => FINDING.test(w));
  if (findings.length) { console.error(`lpk: ${findings.join(', ')}: ${NOT_FINDINGS}\n${USAGE}`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const run = repo && readRun(repo);
  if (!run) { console.error('lpk: no lpk run in this repo; a waiver belongs to a run'); return 1; }
  for (const w of a.words) {
    const what = ROWS.includes(w) ? `gate:${w}` : w;
    appendRecord(repo, { kind: 'waiver', run: run.id, what, why: a.opt('--why'), by: 'owner', via, session: process.env.CLAUDE_CODE_SESSION_ID || null, exit: 0 });
    console.log(`waived ${what} in run ${run.id} via ${via}${via === 'cli' ? ' (not an owner waiver: the gates ignore it)' : ''}`);
  }
  return 0;
}
