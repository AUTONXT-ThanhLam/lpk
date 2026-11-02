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
  assert.match(gates(small, 'qf-small'), /^plan\s+print\s+no brief\.json$/m);

  const wide = quick('quick-wide', 'qf-wide');
  for (const n of ['b', 'c', 'd']) write(wide, `src/${n}.mjs`, `export const ${n} = 1;\n`);
  write(wide, 'src/a.mjs', 'export const a = 2;\n');
  sh(wide, 'add', '-A');
  sh(wide, 'commit', '-qm', 'Widen');
  assert.match(gates(wide, 'qf-wide'), /floor.*4 files changed/);

  ok(lpk(wide, 'qf-wide', 'run', 'lane', 'full', '--why', 'wider than quick'));
  assert.match(gates(wide, 'qf-wide'), /^plan\s+print\s+no brief\.json$/m);
});

test('a change the floor calls full owes the full review set at the increment bar, quick lane or not', () => {
  for (const lane of ['quick', 'full']) {
    const repo = repoWith(`owed-${lane}`, { 'src/a.mjs': 'export const a = 1;\n' });
    ok(lpk(repo, `ow-${lane}`, 'run', 'start', '--lane', lane, '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
    for (const n of ['b', 'c', 'd']) write(repo, `src/${n}.mjs`, `export const ${n} = 1;\n`);
    write(repo, 'src/a.mjs', 'export const a = 2;\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-qm', 'Widen');
    const r = lpk(repo, `ow-${lane}`, 'reviews', 'owed');
    const owed = r.stdout + r.stderr;
    for (const lens of ['techlead', 'prover', 'claims']) assert.match(owed, new RegExp(`^- ${lens} on `, 'm'));
  }
});

test('the design gate denies a change the floor calls full that has no Design Brief, whatever lane it declared, and holds for a small one', () => {
  const wide = (name, session, lane) => {
    const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
    ok(lpk(repo, session, 'run', 'start', '--lane', lane, '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
    for (const n of ['b', 'c', 'd']) write(repo, `src/${n}.mjs`, `export const ${n} = 1;\n`);
    write(repo, 'src/a.mjs', 'export const a = 2;\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-qm', 'Widen');
    return repo;
  };
  for (const lane of ['quick', 'full']) assert.match(gates(wide(`design-${lane}`, `dg-${lane}`, lane), `dg-${lane}`), /^design\s+DENY\s+no Design Brief/m);

  const small = quick('design-small', 'dg-small');
  write(small, 'src/a.mjs', 'export const a = 2;\n');
  sh(small, 'commit', '-qam', 'Set a to 2');
  assert.match(gates(small, 'dg-small'), /^design\s+holds/m);
});

test('the design gate holds once a round passed on the brief, denies the brief edited after it, and still holds after the run ended', () => {
  const S = 'dg-brief';
  const repo = repoWith('design-brief', { 'src/a.mjs': 'export const a = 1;\n' });
  const dir = `${repo}/.git/lpk`;
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  write(dir, 'brief.md', '# Brief\nA is doubled.\n');
  for (const n of ['b', 'c', 'd']) write(repo, `src/${n}.mjs`, `export const ${n} = 1;\n`);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-qm', 'Widen');
  assert.match(gates(repo, S), /^design\s+DENY .*\n.*round/m);

  ok(lpk(repo, S, 'decide', 'design review round 1: pass, 0/0/0', '--why', 'the critic answered'));
  assert.match(gates(repo, S), /^design\s+holds/m);

  write(dir, 'brief.md', '# Brief\nA is tripled.\n');
  assert.match(gates(repo, S), /^design\s+DENY[^]*before the brief changed/m);

  write(dir, 'brief.md', '# Brief\nA is doubled.\n');
  ok(lpk(repo, S, 'run', 'end'));
  const report = lpk(repo, S, 'report');
  assert.match(report.stdout + report.stderr, /^design\s+holds/m);
});
