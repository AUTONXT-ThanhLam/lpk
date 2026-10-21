// `lpk verify`: runs the run's checks in place, with the repo's own dependencies, and records the
// result against the working-tree id it ran on (tree.mjs), before anything is committed, so the
// commit gate can let that exact tree in.
import { spawnSync } from 'node:child_process';
import { git } from './git.mjs';
import { appendRecord } from './records.mjs';
import { CODE } from './rules.mjs';
import { activeRun, noteBranch, readRun, writeRun } from './run.mjs';
import { treeOf } from './tree.mjs';

export function verify(repo, timeout = 1200) {
  const r = readRun(repo);
  if (!r) return { error: 'no lpk run in this repo: start one with `lpk run start --verify "<command>"`' };
  const before = treeOf(repo);
  const results = r.verify.map((cmd) => {
    const t0 = Date.now();
    const p = spawnSync('bash', ['-c', cmd], { cwd: repo, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 26 });
    const out = `${p.stdout || ''}${p.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
    return { cmd, exit: p.status ?? (p.signal ? `killed (${p.signal})` : 1), ms: Date.now() - t0, tail: out };
  });
  // Files the checks write beside the code (build info, stamps, caches) do not void the result; a
  // code file that changed while they ran does. The id recorded is the one the checks left.
  const after = treeOf(repo);
  const moved = git(['diff-tree', '-r', '--name-only', before.id, after.id], repo).split('\n').filter((p) => CODE.test(p));
  const green = results.every((x) => x.exit === 0) && !moved.length;
  r.verified = { id: after.id, tree: after.id, source: after.source, code: after.code, green, at: Date.now(), results };
  noteBranch(repo, r);
  writeRun(r);
  appendRecord(repo, { kind: 'verify', run: r.id, tree: after.id, exit: green ? 0 : 1, green, untracked: after.untracked, results: results.map(({ cmd, exit, ms }) => ({ cmd, exit, ms })) });
  return { verified: r.verified, changedDuring: moved, untracked: after.untracked };
}

// One short line for the owner's status line: this session's run, its real age and its last verify.
export function statusLine(session) {
  const r = activeRun(session, false);
  if (!r) return '';
  const min = (t) => Math.round((Date.now() - t) / 60000);
  const v = r.verified;
  return `lpk ${min(r.started)}m · ${!v ? 'not verified yet' : `verify ${v.green ? 'green' : 'RED'} ${min(v.at)}m ago`}`;
}
