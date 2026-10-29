import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { context, hook, repoWith, write } from './hooks-env.mjs';

const STUB = `#!/usr/bin/env node
process.stdout.write(process.env.STUB_OUT ?? require('node:fs').readFileSync(__dirname + '/out.txt', 'utf8'));
process.exit(2);
`;

const TSC_OUT = [
  "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  '  The expected type comes from the declaration of x.',
  "src/b.ts(1,1): error TS2304: Cannot find name 'zzz'.",
  '',
].join('\n');

function tsProject(name, out) {
  const repo = repoWith(name, { 'tsconfig.json': '{}\n', 'src/a.ts': 'export const x: number = "s";\n', 'src/b.ts': 'zzz;\n', 'src/c.js': 'x\n' });
  write(repo, 'node_modules/.bin/tsc', STUB);
  chmodSync(join(repo, 'node_modules/.bin/tsc'), 0o755);
  write(repo, 'node_modules/.bin/out.txt', out);
  return repo;
}

const edit = (cwd, file, tool = 'Edit') => hook('PostToolUse', 'typecheck', { tool_name: tool, session_id: 'ts', cwd, tool_input: { file_path: join(cwd, file) } });

test('after a TypeScript edit the compiler errors that name the edited file are printed, and nothing else', () => {
  const repo = tsProject('ts-errors', TSC_OUT);
  const text = context(edit(repo, 'src/a.ts', 'Write'));
  assert.match(text, /src\/a\.ts\(3,7\): error TS2322/);
  assert.match(text, /The expected type comes from/);
  assert.doesNotMatch(text, /src\/b\.ts|TS2304/);
  assert.match(context(edit(repo, 'src/b.ts')), /TS2304/);
});

test('the typecheck stays silent without errors, without a tsconfig, without a local tsc, and for files that are not TypeScript', () => {
  assert.equal(edit(tsProject('ts-clean', ''), 'src/a.ts'), null);
  const repo = tsProject('ts-skips', TSC_OUT);
  assert.equal(edit(repo, 'src/c.js'), null);
  const noConfig = repoWith('ts-no-config', { 'src/a.ts': 'x\n' });
  write(noConfig, 'node_modules/.bin/tsc', STUB);
  chmodSync(join(noConfig, 'node_modules/.bin/tsc'), 0o755);
  assert.equal(edit(noConfig, 'src/a.ts'), null);
  const noTsc = repoWith('ts-no-tsc', { 'tsconfig.json': '{}\n', 'src/a.ts': 'x\n' });
  assert.equal(edit(noTsc, 'src/a.ts'), null);
});
