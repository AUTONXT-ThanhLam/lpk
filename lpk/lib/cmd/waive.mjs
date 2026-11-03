// `lpk waive <id>... --why "<text>"`: the release of what a gate or tripwire holds, one record per
// id (`gate:<name>`, `connector:<tool>`, `git:<command>` or `pr:<url>`; a bare gate name becomes
// `gate:<name>`). Run by the lead it records `via: lead`, which the gates accept for a `gate:` id;
// the other ids are the owner's, through /lpk-waive (`--via /lpk-waive`) or the waiver question.
import { parseArgs, repoOf } from '../out.mjs';
import { sessionId } from '../host.mjs';
import { appendRecord } from '../records.mjs';
import { activeRun, runHere } from '../run.mjs';
import { GATES, ID_FORMS, isWaiverId, leadMay, WAIVE_SOURCE } from '../waiver.mjs';

const VIA = ['lead', '/lpk-waive'];
const FINDING = /^F\d+$/;
const NOT_FINDINGS = 'a finding id is not waived; the findings gate is `gate:findings`';
const USAGE = `usage: lpk waive <id>... --why "<what stays unproved, and why going on is right>" [--repo <dir>]\n  (an id is ${ID_FORMS}; the lead waives a gate, and the other ids are the owner's)`;

export function main(argv) {
  const a = parseArgs(argv, ['--why', '--via', '--repo']);
  const via = a.opt?.('--via') || 'lead';
  if (a.error || !a.words.length || !a.opt('--why') || !VIA.includes(via)) { console.error(`lpk: ${a.error || (!VIA.includes(via) ? `--via is one of ${VIA.join(', ')}` : 'name what is waived and --why')}\n${USAGE}`); return 2; }
  const findings = a.words.filter((w) => FINDING.test(w));
  if (findings.length) { console.error(`lpk: ${findings.join(', ')}: ${NOT_FINDINGS}\n${USAGE}`); return 2; }
  const ids = a.words.map((w) => (GATES.includes(w) ? `gate:${w}` : w));
  const bad = ids.filter((w) => !isWaiverId(w));
  if (bad.length) { console.error(`lpk: ${bad.map((w) => `\`${w}\``).join(', ')}: not a waiver id, so no gate would read it; an id is ${ID_FORMS}\n${USAGE}`); return 2; }
  const owners = via === 'lead' ? ids.filter((w) => !leadMay(w)) : [];
  if (owners.length) { console.error(`lpk: ${owners.map((w) => `\`${w}\``).join(', ')} leaves this machine, cannot be undone or fails before this command can run, so only the owner releases it: ask with the waiver question (AskUserQuestion, \`metadata: { source: "${WAIVE_SOURCE}" }\`, an option labelled exactly with the id), saying what it does and why`); return 2; }
  const here = repoOf(a.opt('--repo'));
  let own = null;
  try { own = here && runHere(here); } catch { own = null; }
  const run = own || (a.opt('--repo') ? null : activeRun(sessionId(), false, process.cwd()));
  if (!run) { console.error('lpk: no lpk run in this repo, and this session holds none elsewhere; a waiver belongs to a run'); return 1; }
  if (via === 'lead' && (!run.session || run.session !== sessionId())) { console.error(`lpk: run ${run.id} is held by another session; only the session that holds the run waives its gates`); return 2; }
  const repo = own ? here : run.repo;
  for (const what of ids) {
    appendRecord(repo, { kind: 'waiver', run: run.id, what, why: a.opt('--why'), by: via === 'lead' ? 'lead' : 'owner', via, session: sessionId() || null, exit: 0 });
    console.log(`waived ${what} in run ${run.id} via ${via}`);
  }
  return 0;
}
