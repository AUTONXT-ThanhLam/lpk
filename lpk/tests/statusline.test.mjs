// `lpk statusline`: the run band in Claude Code's status line, printed from the band cache within
// the status line's time limit, refreshed in the background when stale, and nothing without a run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, lpk, repoWith, ROOT } from './gates-env.mjs';
import { bandFile, lockFile, readBand } from '../lib/band.mjs';

const plain = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');
const project = join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-scratch');
const at = (m) => new Date(Date.now() + m * 60_000).toISOString();
const line = (row) => `${JSON.stringify(row)}\n`;

// The status line as Claude Code runs it: the session's JSON on stdin, from any directory.
function statusline(session, cwd) {
  const t = Date.now();
  const r = spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'statusline'], { cwd, env: ENV, input: JSON.stringify({ session_id: session, cwd, workspace: { current_dir: cwd } }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { out: r.stdout, ms: Date.now() - t };
}

function builderSession(S) {
  mkdirSync(join(project, S, 'subagents'), { recursive: true });
  writeFileSync(join(project, `${S}.jsonl`), line({ type: 'user', timestamp: at(-20), message: { role: 'user', content: '<command-name>/lpk</command-name> go' } }));
  writeFileSync(join(project, S, 'subagents', 'agent-b1.jsonl'), line({ type: 'user', timestamp: at(-5), message: { role: 'user', content: 'Your slice: ui.' } }) +
    line({ type: 'assistant', timestamp: at(-1), message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/kpi.tsx' } }], stop_reason: 'tool_use' } }));
  writeFileSync(join(project, S, 'subagents', 'agent-b1.meta.json'), JSON.stringify({ agentType: 'lpk:builder', description: 'Build slice ui' }));
}

const waitFor = (fn, ms = 15_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; spawnSync('sleep', ['0.2']); } return false; };

test('the status line prints the band from the session\'s cached status, well within its time limit', () => {
  const S = 'sl-cached';
  const repo = repoWith('sl-cached', { 'src/ui.tsx': '1\n' });
  assert.equal(lpk(repo, S, 'run', 'start', '--verify', 'true').status, 0);
  builderSession(S);
  assert.equal(lpk(repo, S, 'status', '--json', '--write-cache', '--session', S, '--repo', repo).status, 0);
  const { out, ms } = statusline(S, repo);
  assert.match(plain(out), /^Understand › Build › Review › Fix › Prove › Deliver {2}worked \d+m · 0 tokens · full lane\none slice \(no brief\.json slices\)\n {2}Builder {2}Build slice ui {2}Edit kpi\.tsx {2}\d+m$/);
  assert.match(out, /\x1b\[1mBuild\x1b\[22m/, 'the current step is bold');
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.equal(existsSync(lockFile(S)), false, 'a fresh band starts no refresh');
});

test('a stale band is printed as it is while one refresh runs in the background', () => {
  const S = 'sl-stale';
  const repo = repoWith('sl-stale', { 'a.mjs': '1\n' });
  assert.equal(lpk(repo, S, 'run', 'start', '--verify', 'true').status, 0);
  builderSession(S);
  assert.equal(lpk(repo, S, 'status', '--json', '--write-cache', '--session', S, '--repo', repo).status, 0);
  const old = readBand(S);
  old.at -= 60_000;
  old.status.view.head = 'worked 99m · 0 tokens · full lane';
  writeFileSync(bandFile(S), JSON.stringify(old));
  assert.match(plain(statusline(S, repo).out), /worked 99m/);
  assert.ok(waitFor(() => readBand(S).at > old.at + 30_000), 'the background refresh rewrote the band');
  assert.doesNotMatch(plain(statusline(S, repo).out), /worked 99m/);
  assert.ok(waitFor(() => !existsSync(lockFile(S))), 'the refresh released its lock');
});

test('before any refresh the status line shows the step from cheap facts, and with no run it prints nothing', () => {
  const S = 'sl-first';
  const repo = repoWith('sl-first', { 'a.mjs': '1\n' });
  assert.equal(statusline(S, repo).out, '');
  assert.equal(existsSync(bandFile(S)), false, 'no run, no refresh');
  assert.equal(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--verify', 'true').status, 0);
  assert.equal(plain(statusline(S, repo).out), 'Understand › Build › Review › Fix › Prove › Deliver  quick lane');
  assert.ok(waitFor(() => existsSync(bandFile(S))), 'the first call started a refresh');
});
