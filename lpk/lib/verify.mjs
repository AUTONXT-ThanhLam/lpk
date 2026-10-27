// `lpk verify`: runs the run's checks in place, with the repo's own dependencies, and records the
// result against the working-tree id it ran on (tree.mjs), before anything is committed, so the
// commit gate can let that exact tree in.
import { spawn } from 'node:child_process';
import { git } from './git.mjs';
import { appendRecord, readRecords } from './records.mjs';
import { CODE } from './rules.mjs';
import { noteBranch, readRun, writeRun } from './run.mjs';
import { treeOf } from './tree.mjs';

const live = new Set();
const killAll = () => { for (const x of live) x.kill(); };
let guarded = false;
function guard() {
  if (guarded) return;
  guarded = true;
  process.on('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killAll(); process.exit(1); });
}

const tailOf = (s) => s.trim().split('\n').slice(-15).join('\n');

function start(cmd, repo, timeout) {
  const t0 = Date.now();
  let out = '';
  const x = { stopped: false };
  const p = spawn('bash', ['-c', cmd], { cwd: repo, detached: true });
  const take = (d) => { out = (out + d).slice(-(1 << 20)); };
  p.stdout.on('data', take);
  p.stderr.on('data', take);
  x.kill = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* already gone */ } };
  const timer = setTimeout(x.kill, timeout * 1000);
  live.add(x);
  x.done = new Promise((resolve) => {
    const end = (exit) => { clearTimeout(timer); live.delete(x); resolve({ cmd, exit: x.stopped ? 'stopped' : exit, ms: Date.now() - t0, tail: tailOf(out) }); };
    p.on('error', (e) => { out += e.message; end(1); });
    p.on('close', (code, signal) => end(code ?? (signal ? `killed (${signal})` : 1)));
    p.on('exit', (code, signal) => setTimeout(() => { p.stdout.destroy(); p.stderr.destroy(); end(code ?? (signal ? `killed (${signal})` : 1)); }, 1000));
  });
  return x;
}

const notRun = (cmd) => ({ cmd, exit: 'not run', ms: 0, tail: '' });

async function execute(cmds, order, repo, timeout, parallel) {
  const got = new Map();
  if (parallel) {
    const runs = order.map((i) => [i, start(cmds[i], repo, timeout)]);
    let failed = false;
    await Promise.all(runs.map(async ([i, x]) => {
      const v = await x.done;
      got.set(i, v);
      if (v.exit !== 0 && !failed) { failed = true; for (const [, o] of runs) if (o !== x) { o.stopped = true; o.kill(); } }
    }));
    return got;
  }
  for (const i of order) {
    const v = await start(cmds[i], repo, timeout).done;
    got.set(i, v);
    if (v.exit !== 0) break;
  }
  return got;
}

function pick(cmds, only) {
  const chosen = new Set();
  for (const w of only) {
    const i = /^\d+$/.test(w) ? Number(w) - 1 : cmds.indexOf(w);
    if (!cmds[i]) return { error: `--only "${w}" names none of the run's checks:\n${cmds.map((c, k) => `  ${k + 1}. ${c}`).join('\n')}` };
    chosen.add(i);
  }
  return { chosen };
}

const lastMs = (repo, run) => {
  const ms = new Map();
  for (const rec of readRecords(repo, { run: run.id })) if (rec.kind === 'verify') for (const x of rec.results || []) if (x.exit === 0) ms.set(x.cmd, x.ms);
  return ms;
};

export async function verify(repo, timeout = 1200, { only = [], parallel = false } = {}) {
  const r = readRun(repo);
  if (!r) return { error: 'no lpk run in this repo: start one with `lpk run start --verify "<command>"`' };
  const picked = pick(r.verify, only);
  if (picked.error) return picked;
  const partial = only.length > 0 && picked.chosen.size < r.verify.length;
  const indexes = r.verify.map((_, i) => i).filter((i) => !only.length || picked.chosen.has(i));
  const seen = lastMs(repo, r);
  const order = [...indexes].sort((a, b) => (seen.get(r.verify[a]) ?? -1) - (seen.get(r.verify[b]) ?? -1));
  guard();
  const before = treeOf(repo);
  const got = await execute(r.verify, order, repo, timeout, parallel);
  const results = indexes.map((i) => got.get(i) || notRun(r.verify[i]));
  // Files the checks write beside the code (build info, stamps, caches) do not void the result; a
  // code file that changed while they ran does. The id recorded is the one the checks left.
  const after = treeOf(repo);
  const moved = git(['diff-tree', '-r', '--name-only', before.id, after.id], repo).split('\n').filter((p) => CODE.test(p));
  const green = results.every((x) => x.exit === 0) && !moved.length;
  const shown = { id: after.id, tree: after.id, source: after.source, code: after.code, green, at: Date.now(), results };
  if (!partial) { r.verified = shown; noteBranch(repo, r); writeRun(r); }
  appendRecord(repo, { kind: 'verify', run: r.id, tree: after.id, exit: green ? 0 : 1, green, partial, untracked: after.untracked, results: results.map(({ cmd, exit, ms }) => ({ cmd, exit, ms })) });
  return { verified: shown, partial, changedDuring: moved, untracked: after.untracked };
}
