import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lens, lpk, repoWith, sh, write } from './gates-env.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const rows = (repo, session) => lpk(repo, session, 'reviews', 'owed').stdout.split('\n').filter((l) => l.startsWith('- '));

test('a lens whose prompt began with one sha says so in the owed row, and one that never ran says it has not run', () => {
  const S = 'lone-session';
  const repo = repoWith('lone', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'two commits', '--scenario', 'true', '--verify', 'true'));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  write(repo, 'src/b.mjs', 'export const b = 1;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-qm', 'Add b');
  const tip = sh(repo, 'rev-parse', 'HEAD').trim();

  assert.ok(rows(repo, S).filter((r) => r.startsWith('- bug-hunter')).every((r) => r.includes('has not run on it')));

  lens(S, 'lone1', 'lpk:bug-hunter', tip.slice(0, 12), { findings: [] });
  const hunter = rows(repo, S).filter((r) => r.startsWith('- bug-hunter'));
  assert.ok(hunter.length > 0);
  assert.ok(hunter.some((r) => r.includes(tip.slice(0, 12)) && !r.includes('has not run on it')), hunter.join('\n'));
  assert.ok(rows(repo, S).filter((r) => r.startsWith('- code-review')).every((r) => r.includes('has not run on it')));

  write(repo, 'src/c.mjs', 'export const c = 1;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-qm', 'Add c');
  lens(S, 'range1', 'lpk:bug-hunter', `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD~2').trim()}`, { findings: [] });
  const after = rows(repo, S).filter((r) => r.startsWith('- bug-hunter'));
  assert.ok(after.length > 0 && after.every((r) => r.includes('has not run on it')), after.join('\n'));
});
