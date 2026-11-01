import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, lpk, repoWith, tmp } from './verbs-env.mjs';

const DATA = join(ENV.XDG_DATA_HOME, 'lpk');
let worlds = 0;

function oneRun() {
  const repo = repoWith(`dev-repo-${worlds++}`, { 'a.txt': 'a\n' });
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, 'runs.jsonl'), `${JSON.stringify({ id: '20261021100000-d1', repo: 'dev-repo', path: repo, lane: 'full', started: '2026-10-21T10:00:00.000Z', recorded: '2026-10-21T11:00:00.000Z', wallMs: 1000, yield: {}, agents: {}, lenses: {}, files: [] })}\n`);
}

test('lpk dev runs bench, meter and escapes, the commands only a developer of lpk uses', () => {
  oneRun();
  const bench = lpk(tmp, 'dev', 'bench', '--json');
  assert.equal(bench.status, 0, bench.stderr);
  assert.equal(JSON.parse(bench.stdout).v, 1);
  assert.equal(lpk(tmp, 'dev', 'meter', '--session', 'nope').status, 1, 'meter reaches its own check');
  const escapes = lpk(tmp, 'dev', 'escapes', 'stray');
  assert.equal(escapes.status, 2, 'escapes reaches its own usage');
  assert.match(escapes.stderr, /usage: lpk dev escapes/);
});

test('lpk dev alone, or with a name it does not have, says which names it has and exits 2', () => {
  for (const args of [['dev'], ['dev', 'nope']]) {
    const r = lpk(tmp, ...args);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /bench/);
    assert.match(r.stderr, /meter/);
    assert.match(r.stderr, /escapes/);
  }
});

test('the old top-level names are refused with a pointer to lpk dev, not run', () => {
  oneRun();
  for (const name of ['bench', 'meter', 'escapes']) {
    const r = lpk(tmp, name, '--json');
    assert.equal(r.status, 2, name);
    assert.match(r.stderr, new RegExp(`lpk dev ${name}`));
    assert.equal(r.stdout, '');
  }
});

test('lpk with no command lists lpk dev and no longer lists the commands moved under it', () => {
  const usage = lpk(tmp).stdout + lpk(tmp).stderr;
  assert.match(usage, /lpk dev/);
  assert.doesNotMatch(usage, /^\s*lpk bench/m);
  assert.doesNotMatch(usage, /lpk meter\s/);
});
