import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const LPK = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lpk');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-prose-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_CACHE_HOME: join(tmp, 'cache'), XDG_DATA_HOME: join(tmp, 'data') };
delete ENV.NODE_TEST_CONTEXT;
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };

const chip = (lines) => [...lines, ...Array(12).fill('const filler = 1;'), '// far away', 'const far = 1;', ''].join('\n');

test('lpk check lists the comments beside the lines the change edited, and only those it left unedited', () => {
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(repo, 'src/chip.ts', chip(['// Shows only when a file is still reading or failed.', 'export const show = (w) => w.pending || w.failed;']));
  write(repo, 'docs/chip.md', '# a heading\ntext\n');
  write(repo, 'src/gone.ts', 'const a = 1;\n// about b\nconst b = 2;\nconst c = 3;\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  sh(repo, 'switch', '-q', '-c', 'feat');
  write(repo, 'src/chip.ts', chip(['// Shows only when a file is still reading or failed.', 'export const show = (w) => w.pending || w.failed || w.stopped;', '// reworded here', 'const added = 1;']));
  write(repo, 'src/gone.ts', 'const a = 1;\n// about b\nconst c = 3;\n');
  write(repo, 'docs/chip.md', '# a heading\ntext changed\n');
  const out = spawnSync('node', [LPK, 'check', '--base', 'main'], { cwd: repo, env: ENV, encoding: 'utf8' }).stdout;
  assert.match(out, /src\/chip\.ts:1 {2}\/\/ Shows only when a file is still reading or failed\./);
  assert.doesNotMatch(out, /chip\.ts:3 /, 'a comment the change wrote is not listed');
  assert.doesNotMatch(out, /far away/);
  assert.match(out, /src\/gone\.ts:2 {2}\/\/ about b/, 'a comment above deleted code is listed');
  assert.doesNotMatch(out, /docs\/chip\.md:/);
});
