// `lpk repeat [--for <s>] -- <command>`: runs one command again and again for as long as the next
// run still fits the budget (2 minutes unless told), for timing, polling and race findings that one
// run cannot settle. Prints how many runs, how many failed, and the output of the first failure.
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { outDir, parseArgs, repoOf } from '../out.mjs';
import { runIn } from '../repro.mjs';

const USAGE = 'usage: lpk repeat [--for <seconds>] [--timeout <seconds per run>] -- <command>';

export async function main(argv) {
  const a = parseArgs(argv, ['--for', '--timeout']);
  const budget = Number(a.opt?.('--for') || 120);
  if (a.error || !a.cmd || a.words.length || !(budget > 0)) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const dir = outDir(repoOf('.'));
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const t0 = Date.now();
  const runs = [];
  let slowest = 0;
  // Another run starts only while the slowest run so far still fits in what is left.
  do {
    const left = budget * 1000 - (Date.now() - t0);
    const log = join(dir, `repeat-${stamp}-${runs.length + 1}.log`);
    const r = await runIn(process.cwd(), a.cmd, Number(a.opt('--timeout')) || Math.max(1, Math.ceil(left / 1000)), log);
    // Only a failing run's output is kept.
    if (r.exit === 0 && !r.crash && !r.timedOut) try { unlinkSync(log); } catch { /* already gone */ }
    runs.push({ ...r, log });
    slowest = Math.max(slowest, r.ms);
  } while (Date.now() - t0 + slowest <= budget * 1000);
  const failed = runs.filter((r) => r.exit !== 0 || r.crash || r.timedOut);
  const how = (r) => (r.timedOut ? 'timed out' : r.crash ? `crash (${r.signal})` : `exit ${r.exit}`);
  const kinds = new Map();
  for (const r of failed) kinds.set(how(r), (kinds.get(how(r)) || 0) + 1);
  const out = [`\`${a.cmd}\`: ${runs.length} run(s) in ${Math.round((Date.now() - t0) / 1000)}s, ${failed.length} failed${failed.length ? ` (${[...kinds].map(([k, n]) => `${n}x ${k}`).join(', ')})` : ''}`];
  if (failed.length) {
    const f = failed[0];
    out.push(`first failure, run ${runs.indexOf(f) + 1} (${how(f)}); last 30 lines (log: ${f.log}):`, ...f.tail.split('\n').slice(-30).map((l) => `  | ${l}`));
  }
  console.log(out.join('\n'));
  return 0;
}
