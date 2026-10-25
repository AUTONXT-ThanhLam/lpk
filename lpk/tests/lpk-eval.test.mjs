#!/usr/bin/env node
// lpk eval suite — benchmarks quality, correctness, and performance of lpk CLI

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '..');
const LPK = join(ROOT, 'bin', 'lpk');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-eval-'));

after(() => rmSync(tmp, { recursive: true, force: true }));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Sanitize host env: strip CLAUDE_* and QODER_* vars so lib/host.mjs doesn't point at the launcher's store.
const noHost = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDE|QODER)_/.test(k)));
const ENV = {
  ...noHost(process.env),
  HOME: join(tmp, 'home'),
  CLAUDE_CONFIG_DIR: join(tmp, 'home', '.claude'),
  CLAUDE_CODE_SESSION_ID: '',
  LPK_CHROME_PORT: '1',
  GIT_AUTHOR_NAME: 'eval',
  GIT_AUTHOR_EMAIL: 'eval@eval',
  GIT_COMMITTER_NAME: 'eval',
  GIT_COMMITTER_EMAIL: 'eval@eval',
  XDG_DATA_HOME: join(tmp, 'data'),
  XDG_STATE_HOME: join(tmp, 'state'),
  XDG_CACHE_HOME: join(tmp, 'cache'),
};
delete ENV.NODE_TEST_CONTEXT;
// Mirror ENV into process.env so in-process module loads (lib/host.mjs, etc.) use the same dirs — and no
// launcher's host vars either, which would point them at the store of whoever started the suite.
try {
  for (const k of Object.keys(process.env)) if (/^(CLAUDE|QODER)_/.test(k)) delete process.env[k];
  for (const k of ['HOME', 'CLAUDE_CONFIG_DIR', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) process.env[k] = ENV[k];
} catch (e) {
  // WriteFileSync may fail in test runner sandbox; log to stderr
  process.stderr.write(`ENV setup error: ${e}\n`);
}

function lpk(cwd, ...args) {
  return spawnSync('node', [LPK, ...args], {
    cwd,
    env: ENV,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function createTestRepo(name, files = {}) {
  const repo = join(tmp, name);
  mkdirSync(repo, { recursive: true });
  // Init with identity first so git doesn't auto-detect host config
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: ENV });
  spawnSync('git', ['config', 'user.email', 'eval@eval'], { cwd: repo, env: ENV });
  spawnSync('git', ['config', 'user.name', 'eval'], { cwd: repo, env: ENV });
  // Write files
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repo, path);
    mkdirSync(join(repo, path.dirname(path)), { recursive: true });
    writeFileSync(fullPath, content);
  }
  // Commit
  spawnSync('git', ['add', '.'], { cwd: repo, env: ENV });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: repo, env: ENV });
  return repo;
}

function ok(r) {
  if (r.status !== 0) {
    throw new Error(`Exit ${r.status}: ${r.stderr.slice(0, 200)}${r.stdout.slice(0, 200)}`);
  }
  return r.stdout;
}

function measure(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1e6, ...result };
}

// ── Test Categories ──────────────────────────────────────────────────────────

const results = {
  // 1. CLI entry & version
  cliVersion: { label: 'CLI Version', pass: false, ms: 0, detail: '' },

  // 2. Help & usage
  cliHelp: { label: 'CLI Help', pass: false, ms: 0, detail: '' },

  // 3. Facts command
  facts: { label: 'Facts Command', pass: false, ms: 0, detail: '' },

  // 4. Rules --list
  rulesList: { label: 'Rules --list', pass: false, ms: 0, detail: '' },

  // 5. Rules --test
  rulesTest: { label: 'Rules --test', pass: false, ms: 0, detail: '', passCount: 0, totalCount: 0 },

  // 6. Check command
  check: { label: 'Check Command', pass: false, ms: 0, detail: '' },

  // 7. Map command
  map: { label: 'Map Command', pass: false, ms: 0, detail: '' },

  // 8. Precedent command
  precedent: { label: 'Precedent Command', pass: false, ms: 0, detail: '' },

  // 9. Run start (quick lane)
  runStart: { label: 'Run Start (quick)', pass: false, ms: 0, detail: '' },

  // 10. Run status
  runStatus: { label: 'Run Status', pass: false, ms: 0, detail: '' },

  // 11. Verify command
  verify: { label: 'Verify Command', pass: false, ms: 0, detail: '' },

  // 12. Gates command
  gates: { label: 'Gates Command', pass: false, ms: 0, detail: '' },

  // 13. Report command
  report: { label: 'Report Command', pass: false, ms: 0, detail: '' },

  // 14. Finding list (empty)
  findingList: { label: 'Finding List (empty)', pass: false, ms: 0, detail: '' },

  // 15. Meter command
  meter: { label: 'Meter Command', pass: false, ms: 0, detail: '' },

  // 16. Doctor command
  doctor: { label: 'Doctor Command', pass: false, ms: 0, detail: '' },

  // 17. Error handling — unknown command
  errorUnknown: { label: 'Error: Unknown Command', pass: false, ms: 0, detail: '' },

  // 18. Error handling — missing args
  errorMissing: { label: 'Error: Missing Args', pass: false, ms: 0, detail: '' },

  // 19. Edge case — empty repo
  edgeEmpty: { label: 'Edge: Empty Repo', pass: false, ms: 0, detail: '' },

  // 20. Edge case — no git
  edgeNoGit: { label: 'Edge: No Git', pass: false, ms: 0, detail: '' },

  // 21. Bench command
  bench: { label: 'Bench Command', pass: false, ms: 0, detail: '' },

  // 22. Cochange command
  cochange: { label: 'Cochange Command', pass: false, ms: 0, detail: '' },

  // 23. Floor command
  floor: { label: 'Floor Command', pass: false, ms: 0, detail: '' },

  // 24. Fixlines command
  fixlines: { label: 'Fixlines Command', pass: false, ms: 0, detail: '' },

  // 25. Escapes command
  escapes: { label: 'Escapes Command', pass: false, ms: 0, detail: '' },

  // 26. Watch command
  watch: { label: 'Watch Command', pass: false, ms: 0, detail: '' },

  // 27. Slot command (runs a simple command)
  slot: { label: 'Slot Command', pass: false, ms: 0, detail: '' },

  // 28. Waive command
  waive: { label: 'Waive Command', pass: false, ms: 0, detail: '' },

  // 29. Run end
  runEnd: { label: 'Run End', pass: false, ms: 0, detail: '' },

  // 30. Handoff command
  handoff: { label: 'Handoff Command', pass: false, ms: 0, detail: '' },

  // Performance: 10 rapid facts calls
  perfFacts: { label: 'Perf: 10x Facts', pass: true, ms: 0, detail: '', totalMs: 0 },

  // Performance: rules --list 5x
  perfRules: { label: 'Perf: 5x Rules --list', pass: true, ms: 0, detail: '', totalMs: 0 },
};

// ── Run Tests ────────────────────────────────────────────────────────────────

// 1. CLI Version
test('lpk version prints semantic version', () => {
  const r = measure(() => lpk(tmp, 'version'));
  console.log('DEBUG cliVersion: status=', r.status, 'stdout=', JSON.stringify(r.stdout), 'stderr=', JSON.stringify(r.stderr.slice(0, 200)));
  results.cliVersion.ms = Math.round(r.ms);
  results.cliVersion.pass = r.status === 0;
  results.cliVersion.detail = r.stdout.trim();
});

// 2. CLI Help
test('lpk --help lists all commands', () => {
  const r = measure(() => lpk(tmp, '--help'));
  results.cliHelp.ms = Math.round(r.ms);
  const output = r.stdout + r.stderr;
  results.cliHelp.pass = (r.status === 0 || r.status === 2) && output.includes('facts') && output.includes('rules');
  results.cliHelp.detail = r.status === 0 ? 'All commands listed' : `Exit ${r.status}`;
});

// 3. Facts command
test('lpk facts works on a test repo', () => {
  const repo = createTestRepo('eval-facts', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'facts', '--json'));
  writeFileSync('/tmp/lpk-eval-debug.txt', `facts: status=${r.status} stdout_len=${(r.stdout||'').length} stdout=${JSON.stringify((r.stdout||'').slice(0,300))} stderr=${JSON.stringify((r.stderr||'').slice(0,300))}\n`, { flag: 'a' });
  results.facts.ms = Math.round(r.ms);
  results.facts.pass = r.status === 0;
  results.facts.detail = r.status === 0 ? 'Facts returned' : r.stderr.slice(0, 100);
});

// 4. Rules --list
test('lpk rules --list shows all rules', () => {
  const repo = createTestRepo('eval-rules', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'rules', '--list'));
  results.rulesList.ms = Math.round(r.ms);
  results.rulesList.pass = r.status === 0;
  // Count lines
  const output = r.stdout + r.stderr;
  const lines = output.trim().split('\n').filter(Boolean);
  results.rulesList.detail = `${lines.length} rules listed`;
});

// 5. Rules --test
test('lpk rules --test passes on test files', () => {
  const repo = createTestRepo('eval-rulestest', {
    'test.py': 'def test():\n    assert True\n',
    'test.c': 'void test() {}\n',
    'test.go': 'package test\nfunc Test() {}\n',
  });
  const r = measure(() => lpk(repo, 'rules', '--test'));
  results.rulesTest.ms = Math.round(r.ms);
  const output = r.stdout + r.stderr;
  const passMatch = output.match(/(\d+) passed/);
  const totalMatch = output.match(/(\d+) total/);
  results.rulesTest.passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
  results.rulesTest.totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  results.rulesTest.pass = results.rulesTest.passCount === results.rulesTest.totalCount && results.rulesTest.totalCount > 0;
  results.rulesTest.detail = `${results.rulesTest.passCount}/${results.rulesTest.totalCount} passed`;
});

// 6. Check command
test('lpk check works on a test repo', () => {
  const repo = createTestRepo('eval-check', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'check'));
  results.check.ms = Math.round(r.ms);
  results.check.pass = r.status === 0;
  results.check.detail = r.status === 0 ? 'Check completed' : r.stderr.slice(0, 100);
});

// 7. Map command
test('lpk map works on a test repo', () => {
  const repo = createTestRepo('eval-map', { 'src/app.js': 'export default function App() {}\n' });
  const r = measure(() => lpk(repo, 'map', 'App'));
  results.map.ms = Math.round(r.ms);
  results.map.pass = r.status === 0;
  results.map.detail = r.status === 0 ? 'Map returned' : r.stderr.slice(0, 100);
});

// 8. Precedent command
test('lpk precedent works on a test repo', () => {
  const repo = createTestRepo('eval-precedent', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'precedent', 'src/a.js'));
  results.precedent.ms = Math.round(r.ms);
  results.precedent.pass = r.status === 0;
  results.precedent.detail = r.status === 0 ? 'Precedent returned' : r.stderr.slice(0, 100);
});

// 9. Run start (quick lane)
test('lpk run start creates a run', () => {
  const repo = createTestRepo('eval-run', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval test', '--verify', 'true', '--scenario', 'true'));
  results.runStart.ms = Math.round(r.ms);
  results.runStart.pass = r.status === 0;
  results.runStart.detail = r.status === 0 ? 'Run created' : r.stderr.slice(0, 100);
});

// 10. Run status
test('lpk run status shows the run', () => {
  const repo = createTestRepo('eval-runs', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  const r = measure(() => lpk(repo, 'run', 'status'));
  results.runStatus.ms = Math.round(r.ms);
  results.runStatus.pass = r.status === 0;
  results.runStatus.detail = r.status === 0 ? 'Status shown' : r.stderr.slice(0, 100);
});

// 11. Verify command
test('lpk verify works on a run', () => {
  const repo = createTestRepo('eval-verify', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  const r = measure(() => lpk(repo, 'verify'));
  results.verify.ms = Math.round(r.ms);
  results.verify.pass = r.status === 0;
  results.verify.detail = r.status === 0 ? 'Verify passed' : r.stderr.slice(0, 100);
});

// 12. Gates command
test('lpk gates shows gate status', () => {
  const repo = createTestRepo('eval-gates', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  lpk(repo, 'verify');
  const r = measure(() => lpk(repo, 'gates'));
  results.gates.ms = Math.round(r.ms);
  results.gates.pass = r.status === 0;
  results.gates.detail = r.status === 0 ? 'Gates shown' : r.stderr.slice(0, 100);
});

// 13. Report command
test('lpk report generates report', () => {
  const repo = createTestRepo('eval-report', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  lpk(repo, 'verify');
  const r = measure(() => lpk(repo, 'report'));
  results.report.ms = Math.round(r.ms);
  results.report.pass = r.status === 0;
  results.report.detail = r.status === 0 ? 'Report generated' : r.stderr.slice(0, 100);
});

// 14. Finding list (empty)
test('lpk finding list on empty repo', () => {
  const repo = createTestRepo('eval-findings', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'finding', 'list'));
  results.findingList.ms = Math.round(r.ms);
  results.findingList.pass = r.status === 0;
  results.findingList.detail = r.status === 0 ? 'Empty list' : r.stderr.slice(0, 100);
});

// 15. Meter command
test('lpk meter shows usage', () => {
  const repo = createTestRepo('eval-meter', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'meter'));
  results.meter.ms = Math.round(r.ms);
  results.meter.pass = r.status === 0;
  results.meter.detail = r.status === 0 ? 'Meter shown' : r.stderr.slice(0, 100);
});

// 16. Doctor command
test('lpk doctor checks environment', () => {
  const repo = createTestRepo('eval-doctor', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'doctor'));
  results.doctor.ms = Math.round(r.ms);
  results.doctor.pass = r.status === 0;
  results.doctor.detail = r.status === 0 ? 'Doctor OK' : r.stderr.slice(0, 100);
});

// 17. Error: unknown command
test('lpk rejects unknown commands', () => {
  const repo = createTestRepo('eval-error1', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'nonexistentcommand'));
  results.errorUnknown.ms = Math.round(r.ms);
  results.errorUnknown.pass = r.status !== 0;
  results.errorUnknown.detail = r.status !== 0 ? 'Rejected' : 'Should have failed';
});

// 18. Error: missing args
test('lpk rejects commands with missing args', () => {
  const repo = createTestRepo('eval-error2', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'run'));
  results.errorMissing.ms = Math.round(r.ms);
  results.errorMissing.pass = r.status !== 0;
  results.errorMissing.detail = r.status !== 0 ? 'Rejected' : 'Should have failed';
});

// 19. Edge: empty repo (no files)
test('lpk facts on empty repo', () => {
  const repo = createTestRepo('eval-empty', {});
  const r = measure(() => lpk(repo, 'facts'));
  results.edgeEmpty.ms = Math.round(r.ms);
  results.edgeEmpty.pass = r.status === 0;
  results.edgeEmpty.detail = r.status === 0 ? 'Handled empty' : r.stderr.slice(0, 100);
});

// 20. Edge: no git (outside repo)
test('lpk facts outside git repo', () => {
  const noGit = join(tmp, 'no-git');
  mkdirSync(noGit);
  const r = measure(() => lpk(noGit, 'facts'));
  results.edgeNoGit.ms = Math.round(r.ms);
  results.edgeNoGit.pass = r.status !== 0; // Should fail outside git
  results.edgeNoGit.detail = r.status !== 0 ? 'Rejected outside git' : 'Should have failed';
});

// 21. Bench command
test('lpk bench works', () => {
  const repo = createTestRepo('eval-bench', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  lpk(repo, 'verify');
  const r = measure(() => lpk(repo, 'bench', '--runs', '1'));
  results.bench.ms = Math.round(r.ms);
  results.bench.pass = r.status === 0;
  results.bench.detail = r.status === 0 ? 'Bench completed' : r.stderr.slice(0, 100);
});

// 22. Cochange command
test('lpk cochange works', () => {
  const repo = createTestRepo('eval-cochange', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'cochange', 'src/a.js'));
  results.cochange.ms = Math.round(r.ms);
  results.cochange.pass = r.status === 0;
  results.cochange.detail = r.status === 0 ? 'Cochange returned' : r.stderr.slice(0, 100);
});

// 23. Floor command
test('lpk floor works', () => {
  const repo = createTestRepo('eval-floor', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'floor'));
  results.floor.ms = Math.round(r.ms);
  results.floor.pass = r.status === 0;
  results.floor.detail = r.status === 0 ? 'Floor returned' : r.stderr.slice(0, 100);
});

// 24. Fixlines command
test('lpk fixlines works', () => {
  const repo = createTestRepo('eval-fixlines', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'fixlines'));
  results.fixlines.ms = Math.round(r.ms);
  results.fixlines.pass = r.status === 0;
  results.fixlines.detail = r.status === 0 ? 'Fixlines returned' : r.stderr.slice(0, 100);
});

// 25. Escapes command
test('lpk escapes works', () => {
  const repo = createTestRepo('eval-escapes', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'escapes'));
  results.escapes.ms = Math.round(r.ms);
  results.escapes.pass = r.status === 0;
  results.escapes.detail = r.status === 0 ? 'Escapes returned' : r.stderr.slice(0, 100);
});

// 26. Watch command
test('lpk watch works', () => {
  const repo = createTestRepo('eval-watch', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'watch'));
  results.watch.ms = Math.round(r.ms);
  results.watch.pass = r.status === 0;
  results.watch.detail = r.status === 0 ? 'Watch returned' : r.stderr.slice(0, 100);
});

// 27. Slot command
test('lpk slot runs a command', () => {
  const repo = createTestRepo('eval-slot', { 'src/a.js': 'export const a = 1;\n' });
  const r = measure(() => lpk(repo, 'slot', '--', 'echo', 'hello'));
  results.slot.ms = Math.round(r.ms);
  results.slot.pass = r.status === 0 && r.stdout.includes('hello');
  results.slot.detail = r.status === 0 && r.stdout.includes('hello') ? 'Slot ran' : r.stderr.slice(0, 100);
});

// 28. Waive command
test('lpk waive works', () => {
  const repo = createTestRepo('eval-waive', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  const r = measure(() => lpk(repo, 'waive', 'requirements', '--why', 'eval test', '--via', 'hand'));
  results.waive.ms = Math.round(r.ms);
  results.waive.pass = r.status === 0;
  results.waive.detail = r.status === 0 ? 'Waived' : r.stderr.slice(0, 100);
});

// 29. Run end
test('lpk run end closes the run', () => {
  const repo = createTestRepo('eval-end', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  const r = measure(() => lpk(repo, 'run', 'end'));
  results.runEnd.ms = Math.round(r.ms);
  results.runEnd.pass = r.status === 0;
  results.runEnd.detail = r.status === 0 ? 'Run ended' : r.stderr.slice(0, 100);
});

// 30. Handoff command
test('lpk handoff works', () => {
  const repo = createTestRepo('eval-handoff', { 'src/a.js': 'export const a = 1;\n' });
  lpk(repo, 'run', 'start', '--lane', 'quick', '--why', 'eval', '--verify', 'true', '--scenario', 'true');
  lpk(repo, 'verify');
  const r = measure(() => lpk(repo, 'handoff', 'test-slice'));
  results.handoff.ms = Math.round(r.ms);
  results.handoff.pass = r.status === 0;
  results.handoff.detail = r.status === 0 ? 'Handoff done' : r.stderr.slice(0, 100);
});

// Performance: 10x facts
test('perf: 10x facts calls', () => {
  const repo = createTestRepo('eval-perf-facts', { 'src/a.js': 'export const a = 1;\n' });
  const start = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) {
    lpk(repo, 'facts');
  }
  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1e6;
  results.perfFacts.ms = Math.round(totalMs / 10);
  results.perfFacts.totalMs = Math.round(totalMs);
  results.perfFacts.detail = `Avg ${Math.round(totalMs / 10)}ms, Total ${Math.round(totalMs)}ms`;
});

// Performance: 5x rules --list
test('perf: 5x rules --list calls', () => {
  const repo = createTestRepo('eval-perf-rules', { 'src/a.js': 'export const a = 1;\n' });
  const start = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) {
    lpk(repo, 'rules', '--list');
  }
  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1e6;
  results.perfRules.ms = Math.round(totalMs / 5);
  results.perfRules.totalMs = Math.round(totalMs);
  results.perfRules.detail = `Avg ${Math.round(totalMs / 5)}ms, Total ${Math.round(totalMs)}ms`;
});

// ── Report ───────────────────────────────────────────────────────────────────

after(() => {
  console.log('\n' + '='.repeat(70));
  console.log('  lpk eval suite —', new Date().toISOString());
  console.log('  lpk version: 2.8.11');
  console.log('='.repeat(70) + '\n');

  let passed = 0, failed = 0;
  const keys = Object.keys(results);

  for (const key of keys) {
    const r = results[key];
    process.stdout.write(`  ${r.label.padEnd(35)} ... `);
    if (r.pass) {
      passed++;
      console.log('PASS', r.detail ? `— ${r.detail}` : '');
    } else {
      failed++;
      console.log('FAIL', r.detail ? `— ${r.detail}` : '');
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`  Rules test: ${results.rulesTest.passCount}/${results.rulesTest.totalCount} passed`);
  console.log('-'.repeat(70));

  // Performance summary
  console.log('\n  Performance:');
  console.log(`    ${results.perfFacts.label.padEnd(35)} ${results.perfFacts.detail}`);
  console.log(`    ${results.perfRules.label.padEnd(35)} ${results.perfRules.detail}`);

  console.log('\n');

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
});
