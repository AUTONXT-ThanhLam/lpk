import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('counts non-empty lines', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wc-')), 'in.txt');
  writeFileSync(file, 'a\nb\n\nc\n');
  assert.equal(execFileSync('node', ['src/cli.mjs', 'count', file], { encoding: 'utf8' }).trim(), '3 lines');
});
