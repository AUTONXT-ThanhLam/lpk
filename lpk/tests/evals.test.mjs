import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const EVALS = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals');
const cases = readdirSync(EVALS, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(EVALS, d.name, 'case.yaml'))).map((d) => d.name);
const OTHER_MODEL = /\b(opus|haiku|fable)\b|claude-(?!sonnet)/i;

test('every eval case runs on sonnet and names no other model', () => {
  assert.ok(cases.length >= 4, 'lpk/evals holds the shipped cases');
  for (const name of cases) {
    const files = ['case.yaml', 'prompt.md'].map((f) => join(EVALS, name, f)).filter(existsSync).map((f) => readFileSync(f, 'utf8'));
    assert.match(files[0], /^\s*model:\s*sonnet\s*$/m, `${name} must set model: sonnet`);
    for (const text of files) assert.doesNotMatch(text, OTHER_MODEL, `${name} names a model other than sonnet`);
  }
});
