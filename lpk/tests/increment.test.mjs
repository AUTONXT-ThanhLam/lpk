// The increment bar, as the session that starts a run meets it: the default of a new run, what it
// stops owing, what it still blocks, and that nothing lowers it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookBash, lpk, repoWith, sh, write } from './gates-env.mjs';
import { addFinding, ruleOn } from '../lib/findings.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const owedLenses = (repo, S) => JSON.parse(lpk(repo, S, 'reviews', 'owed', '--json').stdout).map((r) => r.lens);
const status = (repo, S) => JSON.parse(ok(lpk(repo, S, 'run', 'status')));

function incrementRun(name, S, ...extra) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false', '--scenario', 'true', ...extra));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  sh(repo, 'commit', '-qam', 'Set a to 2');
  return repo;
}

const confirm = (repo, claim, area, ruledArea) => {
  const f = addFinding(repo, { from: 'lpk:bug-hunter', at: `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`, claim, repro: 'r', kind: 'defect', severity: 'nit', ...(area ? { area } : {}) }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'c', evidence: 'seen', by: 'lpk:verifier', ...(ruledArea ? { area: ruledArea } : {}) });
  return f;
};

test('a new run is at the increment bar: it owes two lenses, lists a confirmed finding as a known limit, still blocks a protected one, and lets a draft push wait for no green verify', () => {
  const S = 'inc';
  const repo = incrementRun('inc', S);
  assert.equal(status(repo, S).bar, 'increment');
  assert.deepEqual(owedLenses(repo, S).sort(), ['bug-hunter', 'code-review']);
  confirm(repo, 'a long name is cut off in the tooltip');
  assert.match(lpk(repo, S, 'gates').stdout, /^findings +holds[\s\S]*known limits of the increment bar[^\n]*F1/m);
  assert.match(lpk(repo, S, 'report').stdout, /Known limits, not fixed[^\n]*\n- F1 /);
  confirm(repo, 'a token is logged', 'security');
  assert.match(lpk(repo, S, 'gates').stdout, /^findings +DENY[\s\S]*confirmed and not fixed: F2/m);
  confirm(repo, 'a query joins the input', undefined, 'data');
  assert.match(lpk(repo, S, 'gates').stdout, /^findings +DENY[\s\S]*confirmed and not fixed: F2, F3/m);
  const push = hookBash(repo, S, 'git push origin feat');
  assert.doesNotMatch(push, /no green `lpk verify`/);
  assert.match(push, /has not granted draft pushes/);
});

test('the bar rises to production when asked and no later start lowers it', () => {
  const S = 'raise';
  const repo = incrementRun('raise', S);
  ok(lpk(repo, S, 'run', 'start', '--bar', 'production', '--verify', 'false'));
  assert.equal(status(repo, S).bar, 'production');
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false'));
  assert.equal(status(repo, S).bar, 'production');
  ok(lpk(repo, S, 'run', 'start', '--bar', 'increment', '--verify', 'false'));
  assert.equal(status(repo, S).bar, 'production');
  assert.match(owedLenses(repo, S).join(), /techlead/);
});

test('a confirmed finding with no area is not a known limit when the floor owes the security lens', () => {
  const S = 'sec';
  const repo = repoWith('sec', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false', '--scenario', 'true'));
  write(repo, 'src/login.mjs', 'export const login = () => true;\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'Add login');
  confirm(repo, 'login accepts every password');
  assert.match(lpk(repo, S, 'gates').stdout, /^findings +DENY[\s\S]*confirmed and not fixed: F1/m);
});
