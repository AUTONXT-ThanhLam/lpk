// `lpk reap`: stops every app `lpk spawn` started for this repo's run, and nothing else. Run at
// `lpk run end`, never at session end, so a resumed prover keeps its app.
import { parseArgs, repoOf } from '../out.mjs';
import { reap } from '../spawn.mjs';

export async function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words.length) { console.error(`${a.error ? `lpk: ${a.error}\n` : ''}usage: lpk reap [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const out = await reap(repo);
  console.log(out.length ? out.map((r) => `${r.was}: pid ${r.pid} port ${r.port} (${r.cmd.slice(0, 80)})`).join('\n') : 'nothing lpk spawn started is recorded for this repo');
  return out.some((r) => r.was === 'STILL RUNNING') ? 1 : 0;
}
