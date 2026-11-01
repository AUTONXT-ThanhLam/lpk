import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inside } from './src/inside.mjs';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'inside-')));
const root = join(base, 'root');
const outside = join(base, 'outside');
mkdirSync(join(root, 'sub'), { recursive: true });
mkdirSync(outside);
mkdirSync(`${root}x`);
writeFileSync(join(root, 'sub', 'a.txt'), 'a');
writeFileSync(join(outside, 'secret.txt'), 's');
symlinkSync(outside, join(root, 'escape'));
symlinkSync(join(root, 'sub'), join(root, 'alias'));

test('root itself and files under it are inside', () => {
  assert.equal(inside(root, root), true);
  assert.equal(inside(root, join(root, 'sub', 'a.txt')), true);
});

test('a sibling that only shares the name prefix is outside', () => {
  assert.equal(inside(root, `${root}x`), false);
  assert.equal(inside(root, join(`${root}x`, 'f')), false);
});

test('dot-dot segments are resolved before judging', () => {
  assert.equal(inside(root, `${root}/sub/../../outside/secret.txt`), false);
  assert.equal(inside(root, `${root}/sub/../sub/a.txt`), true);
});

test('a path that goes through a link out of the root is outside', () => {
  assert.equal(inside(root, join(root, 'escape', 'secret.txt')), false);
});

test('a link that stays inside the root is inside', () => {
  assert.equal(inside(root, join(root, 'alias', 'a.txt')), true);
});

test('relative paths are read against the working directory', () => {
  const was = process.cwd();
  process.chdir(base);
  try {
    assert.equal(inside('root', 'root/sub/a.txt'), true);
    assert.equal(inside('root', 'outside/secret.txt'), false);
  } finally { process.chdir(was); }
});

test('a path that does not exist is judged without throwing', () => {
  assert.equal(inside(root, join(outside, 'gone.txt')), false);
  assert.doesNotThrow(() => inside(join(base, 'nope'), join(base, 'nope', 'x')));
});

process.on('exit', () => rmSync(base, { recursive: true, force: true }));
