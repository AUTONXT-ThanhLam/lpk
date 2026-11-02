import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { covered } from './src/covered.mjs';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'covered-')));
const real = join(dir, 'a.ts');
writeFileSync(real, 'export {};\n');
const link = join(dir, 'link.ts');
symlinkSync(real, link);
const listing = `/usr/lib/lib.d.ts\n${real}\n`;

test('a listed file is covered, an unlisted one is not', () => {
  assert.equal(covered(listing, real), true);
  writeFileSync(join(dir, 'b.ts'), 'export {};\n');
  assert.equal(covered(listing, join(dir, 'b.ts')), false);
});

test('a symlink to a listed file is covered', () => {
  assert.equal(covered(listing, link), true);
});

test('a relative path is read against the working directory', () => {
  const was = process.cwd();
  process.chdir(dir);
  try { assert.equal(covered(listing, 'a.ts'), true); } finally { process.chdir(was); }
});

test('a file that no longer exists is not covered and nothing throws', () => {
  assert.equal(covered(listing, join(dir, 'gone.ts')), false);
  assert.equal(covered('', join(dir, 'gone.ts')), false);
});

test('a path that only starts like a listed one is not covered', () => {
  assert.equal(covered(listing, `${real}x`), false);
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
