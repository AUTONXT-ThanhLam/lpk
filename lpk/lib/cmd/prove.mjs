// `lpk prove --all | <id>...`: runs the run's command scenarios in place, each passing on exit 0
// and, when it names one, the expected text in its output, and records each result against the
// working-tree id it ran on. The scenarios gate reads these records for HEAD's tree.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outDir, parseArgs, repoOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';
import { readRun } from '../run.mjs';
import { treeOf } from '../tree.mjs';

export function main(argv) {
  const a = parseArgs(argv, ['--repo', '--timeout'], ['--all']);
  if (a.error || (!a.flags.has('--all') && !a.words.length)) { console.error(`lpk: ${a.error || 'name the scenarios or --all'}\nusage: lpk prove --all | <scenario id>... [--repo <dir>] [--timeout <s>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const run = repo && readRun(repo);
  if (!run) { console.error('lpk: no lpk run in this repo'); return 1; }
  const want = run.scenarios.filter((s) => s.cmd && (a.flags.has('--all') || a.words.includes(s.id)));
  const unknown = a.words.filter((w) => !run.scenarios.some((s) => s.id === w && s.cmd));
  if (unknown.length) { console.error(`lpk: no command scenario ${unknown.join(', ')}; \`lpk run status\` lists them`); return 2; }
  if (!want.length) { console.log('no command scenario in this run; the agent-judged ones are the Prover\'s'); return 0; }
  const tree = treeOf(repo).id;
  let bad = 0;
  for (const s of want) {
    const t0 = Date.now();
    const p = spawnSync('bash', ['-c', s.cmd], { cwd: repo, encoding: 'utf8', timeout: Number(a.opt('--timeout') || 600) * 1000, maxBuffer: 1 << 26 });
    const out = `${p.stdout || ''}${p.stderr || ''}`;
    const exit = p.status ?? (p.signal ? `killed (${p.signal})` : 1);
    const found = s.expect === undefined ? null : out.includes(s.expect);
    const pass = exit === 0 && found !== false;
    const log = join(outDir(repo), `prove-${run.id}-${s.id}.log`);
    writeFileSync(log, out);
    appendRecord(repo, { kind: 'prove', run: run.id, scenario: s.id, cmd: s.cmd, tree, exit, expect: s.expect, expectFound: found, pass, ms: Date.now() - t0, log });
    if (!pass) bad++;
    console.log(`${pass ? 'pass' : 'FAIL'} ${s.id} \`${s.cmd}\` exit ${exit}${found === null ? '' : found ? `, "${s.expect}" found` : `, "${s.expect}" NOT in its output`}${pass ? '' : `\n${out.trim().split('\n').slice(-10).map((l) => `  | ${l}`).join('\n')}\n  log: ${log}`}`);
  }
  console.log(`${want.length - bad} of ${want.length} command scenarios pass on tree ${tree.slice(0, 12)}`);
  return bad ? 1 : 0;
}
