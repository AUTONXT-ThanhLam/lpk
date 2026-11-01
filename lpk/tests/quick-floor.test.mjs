import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lpk, repoWith, sh, write } from './gates-env.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const gates = (repo, session) => { const r = lpk(repo, session, 'gates'); return r.stdout + r.stderr; };
const quick = (name, session) => {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, session, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  return repo;
};

test('a quick run whose change the floor calls full says so in the plan row, and one that holds says nothing', () => {
  const small = quick('quick-small', 'qf-small');
  write(small, 'src/a.mjs', 'export const a = 2;\n');
  sh(small, 'commit', '-qam', 'Set a to 2');
  assert.doesNotMatch(gates(small, 'qf-small'), /floor/);

  const wide = quick('quick-wide', 'qf-wide');
  for (const n of ['b', 'c', 'd']) write(wide, `src/${n}.mjs`, `export const ${n} = 1;\n`);
  write(wide, 'src/a.mjs', 'export const a = 2;\n');
  sh(wide, 'add', '-A');
  sh(wide, 'commit', '-qm', 'Widen');
  assert.match(gates(wide, 'qf-wide'), /floor.*4 files changed/);

  ok(lpk(wide, 'qf-wide', 'run', 'lane', 'full', '--why', 'wider than quick'));
  assert.doesNotMatch(gates(wide, 'qf-wide'), /floor/);
});
