// Runs the bundled /code-review on one change and keeps its findings as a JSON array.
// It reviews a scratch worktree of the base with the change staged, the setup its recall was
// measured on, so it never depends on what the live checkout has uncommitted.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git.mjs';

// Where the `[` at `start` closes, skipping brackets inside JSON strings; -1 when it never does.
function closing(text, start) {
  let depth = 0, str = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; } else if (c === '"') str = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

// The result text holds a JSON array of findings somewhere in prose, which may itself contain
// brackets (`arr[0]`): take the first non-empty array of objects, an empty one only when there is
// none. Only a `[` followed by `{` or `]` can open one, and each is parsed once.
export function parseFindings(text) {
  let empty = null;
  for (const m of text.matchAll(/\[(?=\s*[{\]])/g)) {
    const end = closing(text, m.index);
    if (end < 0) continue;
    const s = text.slice(m.index, end + 1);
    for (const t of [s, s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')]) {
      try { const v = JSON.parse(t); if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) { if (v.length) return v; empty = v; break; } } catch { /* try the next shape */ }
    }
  }
  return empty;
}

// One headless Claude Code run of a slash command in `cwd`: its result text, or why there is none.
function claudeRun(cwd, prompt, model, timeoutMs) {
  const r = spawnSync('claude', ['-p', prompt, '--model', model, '--output-format', 'json'],
    { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { error: `claude could not run: ${r.error.code === 'ENOENT' ? 'the claude CLI is not on PATH' : r.error.message}` };
  if (r.status !== 0 && !r.stdout) return { error: `claude exited ${r.status}: ${String(r.stderr).slice(0, 300)}` };
  try { return { res: JSON.parse(r.stdout) }; } catch { return { error: 'claude output was not JSON' }; }
}

// The bundled /security-review on the commit `repo` stands at, told to review only the change
// against `base` (on its own it diffs against origin's default branch). Its report is prose, kept
// as written for the agent that reads it.
export function runSecurityReview({ repo, base, out, model = 'sonnet', timeoutMs = 540000 }) {
  const { res, error } = claudeRun(repo, `/security-review Review only the change \`git diff ${base}...HEAD\`.`, model, timeoutMs);
  if (error) return { error };
  // It answers with nothing, at no cost, when it cannot run (a repo without an `origin` remote):
  // an empty report must never read as "no vulnerabilities".
  if (!String(res.result || '').trim()) return { error: '/security-review returned no report; it needs the repo to have an `origin` remote' };
  mkdirSync(out, { recursive: true });
  const file = join(out, 'security-review.md');
  writeFileSync(file, String(res.result || ''));
  return { file, costUsd: res.total_cost_usd, durationMs: res.duration_ms };
}

export function runCodeReview({ repo, base, out, level = 'high', model = 'sonnet', timeoutMs = 540000 }) {
  const wt = mkdtempSync(join(tmpdir(), 'lpk-cr-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', wt, base], { cwd: repo, stdio: 'ignore' });
    const patch = git(['diff', '--binary', base, 'HEAD'], repo);
    const ap = spawnSync('git', ['apply', '--index', '--whitespace=nowarn'], { cwd: wt, input: patch });
    if (ap.status !== 0) return { error: `git apply failed: ${String(ap.stderr).slice(0, 300)}` };
    const { res, error } = claudeRun(wt, `/code-review ${level} --max-findings all`, model, timeoutMs);
    if (error) return { error };
    const findings = parseFindings(String(res.result || ''));
    if (!findings) return { error: 'no findings array in the /code-review result', raw: String(res.result || '').slice(0, 500) };
    mkdirSync(out, { recursive: true });
    const file = join(out, 'code-review.json');
    writeFileSync(file, JSON.stringify(findings, null, 1));
    return { file, count: findings.length, costUsd: res.total_cost_usd, durationMs: res.duration_ms };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'ignore' });
    rmSync(wt, { recursive: true, force: true });
  }
}
