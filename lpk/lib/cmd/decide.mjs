// `lpk decide "<what>" --why "<why>"`: one choice taken without the owner, with its reason, for the
// report's list of what was decided alone.
import { parseArgs, repoOf } from '../out.mjs';
import { briefHash } from '../briefcheck.mjs';
import { ROUND } from '../phase.mjs';
import { appendDecision } from '../records.mjs';

export function main(argv) {
  const a = parseArgs(argv, ['--why', '--repo']);
  if (a.error || a.words.length !== 1 || !a.opt('--why')) { console.error(`lpk: ${a.error || 'name one decision and its --why'}\nusage: lpk decide "<what>" --why "<why>" [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const round = ROUND.test(a.words[0].trim());
  if (!round && /^design review round\b/i.test(a.words[0].trim())) { console.error('lpk: a design round is recorded as `design review round <n>: <verdict>, <High>/<Medium>/<Low>`, e.g. `design review round 1: pass, 0/2/1`; this one does not parse, so `lpk go` would not see it. Nothing was recorded.'); return 2; }
  const brief = round ? briefHash(repo) : null;
  const d = appendDecision(repo, { what: a.words[0], why: a.opt('--why'), ...(brief ? { brief } : {}) });
  console.log(`decided: ${d.what} (${d.why})`);
  return 0;
}
