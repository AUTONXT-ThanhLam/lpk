// `lpk repro <finding id> | --cmd "<command>" --at commit|base`: runs a finding's reproduction in
// the run's shared repro worktree of the reviewed commit or of its base, and records the exit and
// the output. `lpk repro prepare` creates and installs both trees ahead; `lpk repro clean` removes them.
import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLedger } from '../findings.mjs';
import { git } from '../git.mjs';
import { sessionId } from '../host.mjs';
import { parseArgs, repoOf, targetOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';
import { cleanRepro, logPath, reproTree, runIn } from '../repro.mjs';
import { activeRun, readRun } from '../run.mjs';

const USAGE = `usage:
  lpk repro <finding id> [--cmd "<command>"] --at commit|base [--commit <rev>] [--base <ref>] [--timeout <s>] [--repo <dir>]
  lpk repro --cmd "<command>" --at commit|base [--commit <rev>] [--base <ref>] [--timeout <s>] [--repo <dir>]
  lpk repro prepare [--commit <rev>] [--base <ref>] [--repo <dir>]
  lpk repro clean [--repo <dir>]`;
const sha = (repo, rev) => git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], repo).trim();

// The reviewed commit: `--commit`, else the right side of the range the finding was raised at (or
// that commit), else of the run's review range, else HEAD. Its base: `--base`'s merge base with it,
// else the left side of that range, else the merge base with the run's target.
function commits(repo, run, finding, a) {
  const range = String(finding?.at || run?.reviewRange || '').split(/\.\.\.?/).filter(Boolean);
  const commit = sha(repo, a.opt('--commit') || range.at(-1) || 'HEAD');
  const left = range.length === 2 && !a.opt('--commit') ? sha(repo, range[0]) : '';
  const target = targetOf(repo, a.opt('--base'));
  const base = !a.opt('--base') && left ? left : commit && target ? git(['merge-base', target, commit], repo).trim() : '';
  return { commit, base };
}

const runId = (run) => String(run?.id || 'adhoc').replace(/[^\w.-]/g, '-');

function treeLine(side, t) {
  const i = t.install;
  const how = !i.cmd ? 'no lockfile lpk installs from (pnpm, npm, yarn, bun): nothing installed' : `installed with \`${i.cmd}\`${i.ms ? ` in ${Math.round(i.ms / 1000)}s` : ''}`;
  return `${side} tree ${t.dir}: ${i.exit === 0 ? how : `INSTALL FAILED (\`${i.cmd}\` exit ${i.exit}; ${i.log})`}`;
}

export async function main(argv) {
  const a = parseArgs(argv, ['--cmd', '--at', '--commit', '--base', '--timeout', '--repo']);
  if (a.error) { console.error(`lpk: ${a.error}\n${USAGE}`); return 2; }
  let repo = repoOf(a.opt('--repo'));
  let run = repo ? readRun(repo) : null;
  const held = !run && !a.opt('--repo') && activeRun(sessionId(), false);
  if (held) [repo, run] = [held.repo, held];
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const [word] = a.words;
  if (word === 'clean') {
    const gone = cleanRepro(repo, runId(run));
    console.log(gone.length ? `removed ${gone.length} repro worktree(s):\n${gone.map((d) => `  ${d}`).join('\n')}` : 'no repro worktrees for this run');
    return 0;
  }
  let finding = null;
  if (word && word !== 'prepare') {
    finding = readLedger(repo).findings.find((f) => f.id === word);
    if (!finding) { console.error(`lpk: no finding ${word} in this run's ledger`); return 2; }
  }
  const { commit, base } = commits(repo, run, finding, a);
  if (!commit || !base) { console.error(`lpk: could not resolve the ${commit ? 'base' : 'reviewed commit'}; name it with ${commit ? '--base' : '--commit'}`); return 2; }
  if (word === 'prepare') {
    for (const [side, s] of [['commit', commit], ['base', base]]) {
      const t = reproTree(repo, runId(run), s);
      console.log(t.error ? `${side} tree: ${t.error}` : treeLine(`${side} ${s.slice(0, 12)}`, t));
    }
    return 0;
  }
  const side = a.opt('--at');
  const cmd = a.opt('--cmd') || finding?.repro;
  if (!['commit', 'base'].includes(side) || !cmd) { console.error(`lpk: ${!cmd ? 'no command: give --cmd, or a finding whose repro is a command' : '--at takes commit or base'}\n${USAGE}`); return 2; }
  const at = side === 'commit' ? commit : base;
  const t = reproTree(repo, runId(run), at);
  if (t.error) { console.error(`lpk: ${t.error}`); return 1; }
  console.log(treeLine(`${side} ${at.slice(0, 12)}`, t));
  if (t.install.exit !== 0) return 1;
  // The command runs in the same subdirectory of the tree as the caller stands in the checkout.
  const sub = relative(repo, realpathSync(process.cwd()));
  const cwd = sub && !sub.startsWith('..') ? join(t.dir, sub) : t.dir;
  const log = logPath(runId(run), at, side);
  const timeout = Number(a.opt('--timeout') || 600);
  const r = await runIn(cwd, cmd, timeout, log);
  appendRecord(repo, { kind: 'repro', finding: finding?.id || null, side, commit: at, cmd, exit: r.exit, signal: r.signal, crash: r.crash, timedOut: r.timedOut, ms: r.ms, log, at: new Date().toISOString() });
  const verdict = r.timedOut ? `TIMED OUT after ${timeout}s` : r.crash ? `CRASH (killed by ${r.signal})` : `exit ${r.exit}`;
  const lines = r.tail.split('\n');
  console.log([`\`${cmd}\` at ${side} ${at.slice(0, 12)}: ${verdict} in ${Math.round(r.ms / 1000)}s`, ...(lines.length > 40 ? [`... (${lines.length - 40} earlier lines in the log)`] : []), ...lines.slice(-40).map((l) => `  | ${l}`), `log: ${log}`].join('\n'));
  return 0;
}
