// Main against the change on the same inputs: one command runs in a worktree of the base and in
// one of the change (the working tree as it is), once per input file. Facts only: which inputs
// give another exit code or output. Whether a difference is the one the request asked for is the
// agent's call. The developer's checkout, index and stash are never touched.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { killGroup, linkShared, scratchRun, snapshot } from './mutate.mjs';

const live = new Set();

// The input arrives on stdin and as $LPK_INPUT. The command runs in its own process group, so a
// timeout stops it together with whatever it started.
function runOne(dir, cmd, input, timeout) {
  return new Promise((done) => {
    const child = spawn('bash', ['-c', cmd], { cwd: dir, detached: true, env: { ...process.env, LPK_INPUT: input }, stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child);
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', (b) => { out = (out + b).slice(-(1 << 20)); });
    child.stderr.on('data', (b) => { err = (err + b).slice(-16384); });
    child.stdin.on('error', () => { /* the command did not read its input */ });
    child.stdin.end(readFileSync(input));
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeout * 1000);
    // A directory missing on one side (new in the change) fails to spawn: that is this side's result.
    let settled = false;
    child.on('error', (e) => { if (settled) return; settled = true; clearTimeout(timer); live.delete(child); done({ exit: e.code, out: '', err: e.code === 'ENOENT' ? 'no such directory on this side' : e.message }); });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup(child);
      live.delete(child);
      // Each side runs in its own tree: paths into it must not read as a difference.
      const clean = (t) => t.split(dir).join('.');
      // The tail of stderr as written: which line names the failure is the reader's call.
      done({ exit: timedOut ? `timeout ${timeout}s` : code ?? signal, out: clean(out), err: clean(err).trimEnd().split('\n').slice(-12).join('\n') });
    });
  });
}

export async function compare({ repo, base, cmd, inputs, sub = '', timeout = 30, jobs = 4 }) {
  if (!existsSync(inputs) || !statSync(inputs).isDirectory()) return { error: `no input directory at ${inputs}` };
  const files = readdirSync(inputs).sort().map((n) => join(inputs, n)).filter((p) => statSync(p).isFile());
  if (!files.length) return { error: `no input files in ${inputs}` };
  const { scratch, end: endRun } = scratchRun(repo, ['base', 'wt'], () => { for (const c of live) killGroup(c); });
  const trees = { main: join(scratch, 'base'), change: join(scratch, 'wt') };
  try {
    const snap = snapshot(repo, scratch);
    for (const [side, ref] of [['main', base], ['change', snap]]) {
      git(['worktree', 'add', '--detach', trees[side], ref], repo);
      if (!existsSync(join(trees[side], '.git'))) return { error: `could not create a worktree at ${trees[side]}` };
      linkShared(repo, trees[side]);
    }
    const rows = new Array(files.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < files.length; i = next++) {
        const [m, c] = await Promise.all([runOne(join(trees.main, sub), cmd, files[i], timeout), runOne(join(trees.change, sub), cmd, files[i], timeout)]);
        const head = readFileSync(files[i], 'utf8').slice(0, 200).split('\n')[0];
        rows[i] = { input: files[i].slice(inputs.length).replace(/^\//, ''), head: head.includes('\0') ? '' : head, main: m, change: c, same: m.exit === c.exit && m.out === c.out };
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, files.length)) }, worker));
    return { base, snapshot: snap, rows };
  } finally {
    endRun();
  }
}

const esc = (t) => t.replace(/\s*\n\s*/g, ' ⏎ ').replace(/\t/g, ' ⇥ ').replace(/\|/g, '\\|').replace(/`/g, "'");
const cell = (r) => `exit ${r.exit}: ${r.out.trim() ? esc(r.out.trim()).slice(0, 160) : r.err ? '(stderr below)' : '(no output)'}`;
const STDERR_ROWS = 10;
const stderrOf = (diff) => diff.slice(0, STDERR_ROWS).flatMap((x) => [['main', x.main], ['this change', x.change]]
  .filter(([, r]) => !r.out.trim() && r.err).map(([side, r]) => `\n${x.input} on ${side}, last lines of stderr:\n\`\`\`\n${r.err}\n\`\`\``));

// A markdown table of the inputs that differ, ready for the PR body.
export async function compareText(args) {
  const r = await compare(args);
  if (r.error) return { text: `lpk: ${r.error}`, code: 2 };
  const diff = r.rows.filter((x) => !x.same);
  const failing = r.rows.every((x) => x.main.exit !== 0 && x.change.exit !== 0);
  return { code: 0, text: [
    `main: ${r.base.slice(0, 12)}  this change: the working tree (${r.snapshot.slice(0, 12)})  command: \`${args.cmd}\``,
    `${r.rows.length} inputs: ${r.rows.length - diff.length} same, ${diff.length} differ`,
    ...(failing ? [`every input exits non-zero on both sides, so the command itself fails; stderr of ${r.rows[0].input} on this change:`, '```', r.rows[0].change.err || r.rows[0].change.out, '```'] : []),
    ...(diff.length ? ['', '| input | main | this change |', '|---|---|---|', ...diff.slice(0, 40).map((x) => `| ${x.input}${x.head ? ` \`${esc(x.head).slice(0, 60)}\`` : ''} | ${cell(x.main)} | ${cell(x.change)} |`)] : []),
    ...(diff.length > 40 ? [`(${diff.length - 40} more differ: ${diff.slice(40).map((x) => x.input).join(', ').slice(0, 400)})`] : []),
    ...stderrOf(diff),
    ...(diff.length > STDERR_ROWS ? [`(stderr shown for the first ${STDERR_ROWS} differing inputs only)`] : []),
  ].join('\n') };
}
