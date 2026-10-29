import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const EVALS = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals');
const dirs = readdirSync(EVALS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const executionModel = (yaml) => yaml.match(/^execution:\s*\n(?:[ \t]+.*\n|[ \t]*\n)*?[ \t]+model:[ \t]*(\S+)[ \t]*$/m)?.[1];

test('every eval case sets execution.model to sonnet and has no prompt.md to override it', () => {
  assert.ok(dirs.length >= 4, 'lpk/evals holds the shipped cases');
  for (const name of dirs) {
    assert.ok(existsSync(join(EVALS, name, 'case.yaml')), `${name} must hold a case.yaml`);
    assert.ok(!existsSync(join(EVALS, name, 'prompt.md')), `${name} must not hold a prompt.md`);
    assert.equal(executionModel(readFileSync(join(EVALS, name, 'case.yaml'), 'utf8')), 'sonnet', `${name} must set model: sonnet`);
  }
});

test('the model is read from execution, not from any other model line', () => {
  assert.equal(executionModel('execution:\n  model: gpt-4o\ngraders:\n  - model: sonnet\n'), 'gpt-4o');
  assert.equal(executionModel('name: x\ngraders:\n  - model: sonnet\n'), undefined);
  assert.equal(executionModel('execution:\n  max_turns: 8\n  model: sonnet\n  prompt: hi\n'), 'sonnet');
});
