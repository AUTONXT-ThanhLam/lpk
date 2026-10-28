import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

export function runChild({ cwd, timeoutMs, rawFile, bin = process.env.LPK_CLAUDE_BIN || 'claude', ...opts }) {
  const env = { ...process.env, CLAUDE_CODE_REPORT_FINDINGS: '1' };
  return new Promise((done) => {
    const out = createWriteStream(rawFile);
    let text = '', err = '', timedOut = false;
    const child = spawn(bin, childArgs(opts), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', (e) => { err = e.code === 'ENOENT' ? `the ${bin} CLI is not on PATH` : e.message; });
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

async function inWorktree(repo, at, fn) {
  const wt = mkdtempSync(join(tmpdir(), 'lpk-cr-'));
  try {
    const add = spawnSync('git', ['worktree', 'add', '--detach', '--quiet', wt, at], { cwd: repo, encoding: 'utf8' });
    if (add.status !== 0) return { error: `git worktree add failed: ${add.stderr.trim().slice(0, 300)}` };
    return await fn(wt);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'ignore' });
    rmSync(wt, { recursive: true, force: true });
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
  return inWorktree(repo, a, async (wt) => {
    const patch = git(['diff', '--binary', a, b], repo);
    const ap = spawnSync('git', ['apply', '--index', '--whitespace=nowarn'], { cwd: wt, input: patch, encoding: 'utf8' });
    if (ap.status !== 0) return { error: `git apply failed: ${ap.stderr.trim().slice(0, 300)}` };
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
