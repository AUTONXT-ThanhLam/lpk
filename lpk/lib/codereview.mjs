import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchAs } from './account.mjs';
import { fromReport, proseFindings, readStream } from './codereview-parse.mjs';
import { git } from './git.mjs';

const ROLE_FILE = new URL('../agents/code-reviewer.md', import.meta.url);

export const roleBody = (file = ROLE_FILE) => readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();

export function childArgs({ prompt, model, fallbackModel, effort, appendSystemPrompt }) {
  return ['-p', prompt, '--model', model, '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--exclude-dynamic-system-prompt-sections',
    '--disallowedTools', 'mcp__plugin_lpk_lpk__finding_add',
    ...(fallbackModel && fallbackModel !== model ? ['--fallback-model', fallbackModel] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(appendSystemPrompt ? ['--append-system-prompt', appendSystemPrompt] : [])];
}

const WINDOWS_NOT_AN_EXE = new Set(['ENOENT', 'EINVAL', 'EFTYPE']);

const notStartedWhy = (e, bin) => {
  if (process.platform === 'win32' && WINDOWS_NOT_AN_EXE.has(e.code)) return `the ${bin} CLI could not be started (${e.message}); Node starts only an .exe on Windows, not the .cmd shim an npm install leaves or a script, so use the native installer's claude.exe or set LPK_CLAUDE_BIN to a .exe`;
  return e.code === 'ENOENT' ? `the ${bin} CLI is not on PATH` : e.message;
};

export function runChild({ cwd, timeoutMs, rawFile, bin = process.env.LPK_CLAUDE_BIN || 'claude', ...opts }) {
  const env = { ...process.env, CLAUDE_CODE_REPORT_FINDINGS: '1' };
  const launch = launchAs(bin, childArgs(opts), env);
  if (launch.error) return Promise.resolve({ ...readStream(''), exit: 'not started', stderr: launch.error });
  return new Promise((done) => {
    const out = createWriteStream(rawFile);
    let text = '', err = '', timedOut = false;
    let child;
    try { child = spawn(launch.cmd, launch.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
      out.end();
      return done({ ...readStream(''), exit: 'not started', stderr: notStartedWhy(e, bin) });
    }
    child.on('error', (e) => { err = notStartedWhy(e, bin); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { text += d; out.write(d); });
    child.stderr.on('data', (d) => { err = `${err}${d}`.slice(-2000); });
    const kill = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(kill);
      out.end();
      done({ ...readStream(text), exit: timedOut ? 'timeout' : code ?? signal ?? 'no exit code', stderr: err.trim() });
    });
  });
}

const run = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

async function inScratch(repo, a, b, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-cr-'));
  try {
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo).trim();
    const clone = run(['clone', '--shared', '--no-checkout', '--quiet', '--origin', 'lpk-source', common, dir]);
    if (clone.status !== 0) return { error: `git clone failed: ${clone.stderr.trim().slice(0, 300)}` };
    const branch = run(['symbolic-ref', '--short', 'HEAD'], dir).stdout.trim() || 'main';
    for (const step of [['remote', 'remove', 'lpk-source'], ['checkout', '--quiet', '-B', branch, a], ['read-tree', '--reset', '-u', b]]) {
      const r = run(step, dir);
      if (r.status !== 0) return { error: `git ${step[0]} failed in the scratch clone: ${r.stderr.trim().slice(0, 300)}` };
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function failure(c) {
  if (c.exit === 'timeout') return 'the review child ran past its time limit and was stopped';
  if (!c.result) return `the review child ended without a result (exit ${c.exit})${c.stderr ? `: ${c.stderr.split('\n').slice(-3).join(' ').slice(0, 300)}` : ''}`;
  if (c.result.is_error || c.result.subtype !== 'success') return `the review child failed (${c.result.subtype}): ${String(c.result.result || c.result.errors || '').slice(0, 300)}`;
  return '';
}

const meta = (c) => ({
  exit: c.exit, ran: Object.keys(c.result?.modelUsage || {}), durationMs: c.result?.duration_ms, costUsd: c.result?.total_cost_usd,
  tokens: c.result?.usage && {
    fresh: (c.result.usage.input_tokens || 0) + (c.result.usage.cache_creation_input_tokens || 0) + (c.result.usage.output_tokens || 0),
    cacheRead: c.result.usage.cache_read_input_tokens || 0,
  },
});

export function codeReview({ repo, a, b, level, ...child }) {
  return inScratch(repo, a, b, async (wt) => {
    const c = await runChild({ cwd: wt, prompt: `/code-review ${level} --max-findings all`, ...child });
    const why = failure(c);
    if (why) return { error: why, ...meta(c) };
    if (c.report?.findings.length) return { findings: fromReport(c.report), via: 'ReportFindings', ...meta(c) };
    const prose = proseFindings(String(c.result.result || ''));
    if (prose?.length) return { findings: prose, via: 'prose', ...meta(c) };
    if (c.report || prose) return { findings: [], via: c.report ? 'ReportFindings' : 'prose', ...meta(c) };
    return { error: 'the review answered neither through ReportFindings nor with a findings list lpk can read; its output is in the stream file', ...meta(c) };
  });
}
