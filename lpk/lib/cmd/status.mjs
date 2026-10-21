// `lpk status [--json] [--gates] [--write-cache] [--session <id>] [--repo <dir>]`: where the lpk run
// of this repo stands, as facts: its step (and the steps it went through), the time it worked, the
// fresh tokens of the session, what matters in this step, the team of the session that runs now and what
// waits on the owner. Fast and local: no gh, no network. The gates are read from the first review
// on, or always with --gates. --write-cache also keeps the result as the session's band cache, which
// `lpk statusline` prints, and releases the refresh lock the status line took.
import { parseArgs, repoOf } from '../out.mjs';
import { status } from '../status.mjs';
import { dropLock, statusText, viewOf, writeBand } from '../band.mjs';

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--session'], ['--json', '--gates', '--write-cache']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk status [--json] [--gates] [--write-cache] [--session <id>] [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  let s;
  const cache = a.flags.has('--write-cache');
  try { s = await status(repo, { session: a.opt('--session') || '', withGates: a.flags.has('--gates') }); } catch (e) {
    if (a.flags.has('--json')) console.log(JSON.stringify({ v: 1, repo, open: false, error: String(e.message || e) }));
    else console.error(`lpk: ${e.message || e}`);
    if (cache && a.opt('--session')) { writeBand(a.opt('--session'), { open: false, error: String(e.message || e) }); dropLock(a.opt('--session')); }
    return 1;
  }
  if (cache && s.session) { writeBand(s.session, s); dropLock(s.session); }
  console.log(a.flags.has('--json') ? JSON.stringify(s.open ? { ...s, view: viewOf(s) } : s) : statusText(s));
  return 0;
}
