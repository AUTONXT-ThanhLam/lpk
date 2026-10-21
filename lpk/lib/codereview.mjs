// Runs the bundled /code-review or /security-review on one range of a change as a headless Claude
// Code child, and reads its findings. The child authenticates with the owner's active account,
// whose token reaches it on a file descriptor, never in its environment or on its command line.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromReport, parseSecurity, proseFindings, readStream } from './codereview-parse.mjs';
import { git } from './git.mjs';

// The account `cc-switch` made active: its name (cc1, cc2, ...) and its token, or null when this
// machine keeps no such accounts and the child signs in as `claude` itself does.
export function activeAccount(dir = process.env.LPK_ACCOUNTS_DIR || join(homedir(), '.config', 'lpk', 'accounts')) {
  let name = 'cc1';
  try { name = readFileSync(join(dir, 'active'), 'utf8').trim() || name; } catch { /* cc-switch's default */ }
  if (!/^[\w.-]+$/.test(name)) return null;
  try {
    const token = readFileSync(join(dir, `${name}.token`), 'utf8').trim();
    return token ? { name, token } : null;
  } catch { return null; }
}

// `a..b` with both ends resolved to full commit ids, or why it is not one. A ref name never holds
// `..` (git check-ref-format), so the first `..` splits the ends and dots inside them (`v1.2`,
// `release-1.2`) stay; an empty end is HEAD, as in git. `a...b` is the change b made since it left
// a: from their merge base to b, the diff `git diff a...b` shows.
export function resolveRange(repo, range) {
  const text = String(range || '');
  const at = text.indexOf('..');
  if (at < 0 || /\s/.test(text)) return { error: `${range || '(none)'} is not a range <from>..<to>` };
  const three = text[at + 2] === '.';
  const ends = [text.slice(0, at) || 'HEAD', text.slice(at + (three ? 3 : 2)) || 'HEAD'];
  const sha = (ref) => git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], repo).trim();
  const [from, b] = ends.map(sha);
  if (!from || !b) return { error: `${!from ? ends[0] : ends[1]} is not a commit in ${repo}` };
  const a = three ? git(['merge-base', from, b], repo).trim() : from;
  if (!a) return { error: `${ends[0]} and ${ends[1]} have no merge base` };
  if (a === b) return { error: `${range} is empty: both ends are ${a.slice(0, 12)}` };
  return { a, b, range: `${a}..${b}` };
}

// One headless child running `prompt` in `cwd`, its stream-json output kept in `rawFile`. It never
// writes a session file (`claude -c` must not resume it), and its system prompt leaves out the
// per-machine sections so every child shares one cached prefix.
export function runChild({ cwd, prompt, model, fallbackModel, effort, appendSystemPrompt, timeoutMs, rawFile }) {
  const account = activeAccount();
  const env = { ...process.env, CLAUDE_CODE_REPORT_FINDINGS: '1' };
  if (account) { delete env.CLAUDE_CODE_OAUTH_TOKEN; env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = '3'; }
  const args = ['-p', prompt, '--model', model, '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--exclude-dynamic-system-prompt-sections',
    ...(fallbackModel && fallbackModel !== model ? ['--fallback-model', fallbackModel] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(appendSystemPrompt ? ['--append-system-prompt', appendSystemPrompt] : [])];
  return new Promise((done) => {
    const out = createWriteStream(rawFile);
    let text = '', err = '', timedOut = false;
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', account ? 'pipe' : 'ignore'] });
    child.on('error', (e) => { err = e.code === 'ENOENT' ? 'the claude CLI is not on PATH' : e.message; });
    if (account) {
      // Claude Code reads this pipe to its first newline at start-up; a child that exits first
      // closes it, which is not an error here.
      child.stdio[3].on('error', () => {});
      child.stdio[3].end(`${account.token}\n`);
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { text += d; out.write(d); });
    child.stderr.on('data', (d) => { err = `${err}${d}`.slice(-2000); });
    const kill = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(kill);
      out.end();
      const exit = timedOut ? 'timeout' : code ?? signal ?? 'no exit code';
      done({ ...readStream(text), exit, stderr: err.trim(), account: account ? account.name : 'claude login' });
    });
  });
}

// A detached scratch worktree of `at`, removed again whatever happens inside `fn`.
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

// The base's REVIEW.md, the review rules a team keeps for its reviewers, or ''.
export function reviewRules(repo, a) {
  return spawnSync('git', ['cat-file', '-e', `${a}:REVIEW.md`], { cwd: repo }).status === 0 ? git(['show', `${a}:REVIEW.md`], repo) : '';
}

// Why a child gave no usable answer, or '' when it did.
function failure(c) {
  if (c.exit === 'timeout') return 'the review child ran past its time limit and was stopped';
  if (!c.result) return `the review child ended without a result (exit ${c.exit})${c.stderr ? `: ${c.stderr.split('\n').slice(-3).join(' ').slice(0, 300)}` : ''}`;
  if (c.result.is_error || c.result.subtype !== 'success') return `the review child failed (${c.result.subtype}): ${String(c.result.result || c.result.errors || '').slice(0, 300)}`;
  return '';
}

const meta = (c) => ({
  account: c.account, exit: c.exit, ran: Object.keys(c.result?.modelUsage || {}), durationMs: c.result?.duration_ms,
  tokens: c.result?.usage && {
    fresh: (c.result.usage.input_tokens || 0) + (c.result.usage.cache_creation_input_tokens || 0) + (c.result.usage.output_tokens || 0),
    cacheRead: c.result.usage.cache_read_input_tokens || 0,
  },
});

// /code-review on the change a..b: a scratch worktree of `a` with the change staged, the setup its
// recall was measured on, so it never depends on what any live checkout holds.
export function codeReview({ repo, a, b, level, model, fallbackModel, effort, appendSystemPrompt, timeoutMs, rawFile }) {
  return inWorktree(repo, a, async (wt) => {
    const patch = git(['diff', '--binary', a, b], repo);
    const ap = spawnSync('git', ['apply', '--index', '--whitespace=nowarn'], { cwd: wt, input: patch, encoding: 'utf8' });
    if (ap.status !== 0) return { error: `git apply failed: ${ap.stderr.trim().slice(0, 300)}` };
    const c = await runChild({ cwd: wt, prompt: `/code-review ${level} --max-findings all`, model, fallbackModel, effort, appendSystemPrompt, timeoutMs, rawFile });
    const why = failure(c);
    if (why) return { error: why, ...meta(c) };
    if (c.report) return { findings: fromReport(c.report), via: 'ReportFindings', ...meta(c) };
    const findings = proseFindings(String(c.result.result || ''));
    if (!findings) return { error: 'the review answered neither through ReportFindings nor with a findings list lpk can read; its output is in the stream file', ...meta(c) };
    return { findings, via: 'prose', ...meta(c) };
  });
}

// /security-review on the change a..b, run on a scratch worktree of `b` and told which diff to read
// (on its own it diffs against origin's default branch).
export function securityReview({ repo, a, b, model, fallbackModel, effort, appendSystemPrompt, timeoutMs, rawFile }) {
  return inWorktree(repo, b, async (wt) => {
    const c = await runChild({ cwd: wt, prompt: `/security-review Review only the change \`git diff ${a}..${b}\`.`, model, fallbackModel, effort, appendSystemPrompt, timeoutMs, rawFile });
    const why = failure(c);
    if (why) return { error: why, ...meta(c) };
    const report = String(c.result.result || '');
    // It answers with nothing, at no cost, when it cannot run: an empty report is never "no vulnerabilities".
    if (!report.trim()) return { error: '/security-review returned no report; it needs the repo to have an `origin` remote', ...meta(c) };
    const { findings, unread } = parseSecurity(report);
    if (unread) return { error: `${unread} vulnerability heading(s) in the report had no \`file:line\` or no Description; the report is in the stream file`, ...meta(c) };
    return { findings, via: 'markdown', ...meta(c) };
  });
}

// The names `bin/lpk` still imports for its old `code-review` branch, which `lib/cmd/code-review.mjs`
// shadows and which never runs; they go when that branch and its import are removed.
export { codeReview as runCodeReview, securityReview as runSecurityReview };
