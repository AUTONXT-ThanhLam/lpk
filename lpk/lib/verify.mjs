// `lpk verify`: runs the run's checks in place, with the repo's own dependencies, and records the
// result against the working-tree id it ran on (tree.mjs), before anything is committed, so the
// commit gate can let that exact tree in.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { appendRecord, readRecords } from './records.mjs';
import { CODE } from './rules.mjs';
import { tiersGreen } from './proof.mjs';
import { noteBranch, readRun, runDir, writeRun } from './run.mjs';
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
    const end = (exit) => { clearTimeout(timer); live.delete(x); resolve({ cmd, exit: x.stopped ? 'stopped' : exit, ms: Date.now() - t0, limit: timeout, tail: tailOf(out), out }); };
    p.on('error', (e) => { out += e.message; end(1); });
    p.on('close', (code, signal) => end(code ?? (signal ? `killed (${signal})` : 1)));
    p.on('exit', (code, signal) => setTimeout(() => { p.stdout.destroy(); p.stderr.destroy(); end(code ?? (signal ? `killed (${signal})` : 1)); }, 1000));
  });
  return x;
}

const notRun = (cmd) => ({ cmd, exit: 'not run', ms: 0, tail: '' });

async function execute(cmds, order, repo, limit, parallel) {
  const got = new Map();
  if (parallel) {
    const runs = order.map((i) => [i, start(cmds[i], repo, limit(cmds[i]))]);
    let failed = false;
    await Promise.all(runs.map(async ([i, x]) => {
      const v = await x.done;
      got.set(i, v);
      if (v.exit !== 0 && !failed) { failed = true; for (const [, o] of runs) if (o !== x) { o.stopped = true; o.kill(); } }
    }));
    return got;
  }
  for (const i of order) {
    const v = await start(cmds[i], repo, limit(cmds[i])).done;
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

const FLOOR = { fast: 1200, final: 7200 };

const greenMs = (records) => {
  const ms = new Map();
  for (const rec of records) if (rec.kind === 'verify') for (const x of rec.results || []) if (x.exit === 0) ms.set(x.cmd, x.ms);
  return ms;
};

const reusedOn = (records, run, tree) => {
  const got = new Map();
  for (const rec of records) {
    if (rec.kind !== 'verify' || rec.run !== run || rec.final || rec.stable !== true || rec.tree !== tree) continue;
    for (const x of rec.results || []) if (x.exit === 0) got.set(x.cmd, { cmd: x.cmd, exit: 0, ms: x.ms, limit: x.limit, reused: true, tail: '' });
  }
  return got;
};

function keepLogs(repo, got) {
  const dir = join(runDir(repo), 'verify-logs');
  for (const [i, v] of got) {
    const { out, ...rest } = v;
    got.set(i, rest);
    if (out === undefined || v.exit === 0 || v.exit === 'stopped') continue;
    mkdirSync(dir, { recursive: true });
    rest.log = join(dir, `${Date.now()}-${i + 1}.log`);
    writeFileSync(rest.log, out);
  }
}

export function timeoutFor(records, cmd, { final = false, explicit } = {}) {
  if (explicit) return explicit;
  const last = greenMs(records).get(cmd) ?? 0;
  return Math.max(final ? FLOOR.final : FLOOR.fast, Math.ceil((1.5 * last) / 1000));
}

export async function verify(repo, { only = [], parallel = false, final = false, timeout } = {}) {
  const r = readRun(repo);
  if (!r) return { error: 'no lpk run in this repo: start one with `lpk run start --verify "<command>"`' };
  const cmds = final ? r.verifyFinal || [] : r.verify;
  if (final && !cmds.length) return { error: 'this run has no final checks: name them with `lpk run start --verify-final "<command>"`' };
  const picked = pick(cmds, only);
  if (picked.error) return picked;
  const partial = only.length > 0 && picked.chosen.size < cmds.length;
  const indexes = cmds.map((_, i) => i).filter((i) => !only.length || picked.chosen.has(i));
  const records = readRecords(repo);
  const seen = greenMs(records.filter((rec) => Boolean(rec.final) === final));
  guard();
  const before = treeOf(repo);
  const reuse = !only.length && !final ? reusedOn(records, r.id, before.id) : new Map();
  const reused = new Set(indexes.filter((i) => reuse.has(cmds[i])));
  const order = indexes.filter((i) => !reused.has(i)).sort((a, b) => (seen.get(cmds[a]) ?? -1) - (seen.get(cmds[b]) ?? -1));
  const got = await execute(cmds, order, repo, (cmd) => timeoutFor(records, cmd, { final, explicit: timeout }), parallel);
  keepLogs(repo, got);
  for (const i of reused) got.set(i, reuse.get(cmds[i]));
  const results = indexes.map((i) => got.get(i) || notRun(cmds[i]));
  // Files the checks write beside the code (build info, stamps, caches) do not void the result; a
  // code file that changed while they ran does. The id recorded is the one the checks left.
  const after = treeOf(repo);
  const moved = git(['diff-tree', '-r', '--name-only', before.id, after.id], repo).split('\n').filter((p) => CODE.test(p));
  const green = results.every((x) => x.exit === 0) && !moved.length;
  const shown = { id: after.id, tree: after.id, source: after.source, code: after.code, green, at: Date.now(), results };
  if (!partial && !final) { r.verified = shown; noteBranch(repo, r); writeRun(r); }
  const rec = appendRecord(repo, { kind: 'verify', ...(final ? { final: true } : {}), run: r.id, tree: after.id, exit: green ? 0 : 1, green, stable: !moved.length, partial, untracked: after.untracked, results: results.map(({ cmd, exit, ms, limit, log, reused: again }) => ({ cmd, exit, ms, limit, ...(log ? { log } : {}), ...(again ? { reused: true } : {}) })) });
  const finalOwed = !final && green && !partial && !tiersGreen(r, [...records.filter((x) => x.run === r.id), rec], after.id).final;
  return { verified: shown, partial, final, finalOwed, changedDuring: moved, untracked: after.untracked };
}
