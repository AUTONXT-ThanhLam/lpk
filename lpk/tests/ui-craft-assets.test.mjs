import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fontVerdict } from '../skills/ui-craft/fontverdict.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'skills', 'ui-craft');
const docs = [['agents/designer.md'], ['agents/ui-reviewer.md'], ['skills/ui-craft/SKILL.md']]
  .map(([p]) => [p, readFileSync(join(ROOT, p), 'utf8')]);

const FILE = /`((?:assets\/)?[A-Za-z0-9_-]+\.(?:md|mjs|css|json))`/g;
const inKit = (name) => name.startsWith('assets/') || existsSync(join(KIT, name)) || KIT_FILES.includes(name);
const KIT_FILES = ['SKILL.md', 'apple.md', 'motion.md', 'parts.md', 'ux.md', 'benchmarks.md', 'frames.mjs', 'audit.mjs', 'page.mjs'];

test('every ui-craft file the designer, the reviewer and SKILL.md name exists in the kit', () => {
  assert.ok(existsSync(join(KIT, 'assets', 'apple.css')), 'SKILL.md and motion.md send the designer to assets/apple.css');
  for (const [file, text] of docs) {
    const named = [...new Set([...text.matchAll(FILE)].map((m) => m[1]))].filter(inKit);
    for (const name of named) assert.ok(existsSync(join(KIT, name)), `${file} names ${name}, which is not in skills/ui-craft`);
  }
});

test('frames.mjs states the key action and the second action in its usage line, and refuses a second action it cannot place', () => {
  const run = (...args) => spawnSync(process.execPath, [join(KIT, 'frames.mjs'), ...args], { encoding: 'utf8', timeout: 20000 });
  const usage = run();
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /key:<name>/);
  assert.match(usage.stderr, /--then <ms>:<action>/);
  const late = run('http://127.0.0.1:1/', 'a', '--ms', '300', '--then', '400:key:Escape');
  assert.equal(late.status, 2, late.stderr);
  assert.match(late.stderr, /--then/);
  const empty = run('http://127.0.0.1:1/', 'key:');
  assert.equal(empty.status, 2, empty.stderr);
});

test('the audit passes the mandated type stack when its web face is defined and fails it when it is not', () => {
  const stack = '-apple-system, BlinkMacSystemFont, "Inter Variable", system-ui, sans-serif';
  const face = (status) => [{ family: '"Inter Variable"', status }];
  assert.equal(fontVerdict(stack, face('unloaded')), 'loaded');
  assert.equal(fontVerdict(stack, face('loaded')), 'loaded');
  assert.equal(fontVerdict(stack, []), 'NOT LOADED');
  assert.equal(fontVerdict(stack, face('error')), 'NOT LOADED');
  assert.equal(fontVerdict('Arial, "Inter Variable"', face('unloaded')), 'loaded');
  assert.equal(fontVerdict('Arial, "Inter Variable"', []), 'NOT LOADED');
  assert.equal(fontVerdict('system-ui, sans-serif', []), 'system');
});
