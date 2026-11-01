import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lpk, repoWith, sh, tmp } from './gates-env.mjs';
import { addFinding, readLedger, ruleOn, VERIFIER } from '../lib/findings.mjs';
import { loadRules } from '../lib/rules.mjs';
import { yieldText } from '../lib/yield.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };

function ledgerRepo(name) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  const dir = join(repo, '.git', 'lpk');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ v: 2, id: 'run1', repo, session: 's', started: Date.now() }));
  return { repo, at: sh(repo, 'rev-parse', 'HEAD').trim() };
}
const raiseRule = (repo, at, ruleId, extra = {}) => addFinding(repo, { from: 'lpk:techlead', at, claim: 'the rule is broken', repro: 'read the diff', kind: 'rule', ruleId, severity: 'important', file: 'src/a.mjs', line: 1, ...extra }).finding.id;
const confirm = (repo, id, reach) => ruleOn(repo, { id, verdict: 'confirmed', reach, born: 'build', cause: 'the diff breaks it', evidence: 'read the diff', by: VERIFIER });

test('a broken rule marked below high does not block the merge, one marked high does', () => {
  const { repo, at } = ledgerRepo('lean-rules');
  const rules = loadRules(repo);
  const high = rules.find((r) => r.blocks === 'high').id;
  const medium = rules.find((r) => r.blocks === 'medium').id;
  const soft = raiseRule(repo, at, medium);
  assert.match(confirm(repo, soft, 'merge').error, new RegExp(`${medium} is marked blocks: medium.*neither`));
  assert.match(confirm(repo, soft, 'user').error, /neither/);
  assert.equal(confirm(repo, soft, 'neither').finding.state, 'deferred');
  const hard = raiseRule(repo, at, high);
  assert.equal(confirm(repo, hard, 'merge').finding.state, 'confirmed');
  const secure = raiseRule(repo, at, medium, { area: 'security' });
  assert.equal(confirm(repo, secure, 'merge').finding.state, 'confirmed');
  assert.equal(readLedger(repo).findings.length, 3);
});

test('lpk rules --yield lists what each lens raised and the lenses the lanes use that raised nothing', () => {
  const { repo, at } = ledgerRepo('lean-yield');
  const id = addFinding(repo, { from: 'lpk:bug-hunter', at, claim: 'c', repro: 'r', kind: 'defect', severity: 'important' }).finding.id;
  ruleOn(repo, { id, verdict: 'dropped', basis: 'disproved', evidence: 'no', by: VERIFIER });
  const text = ok(lpk(repo, 's', 'rules', '--yield'));
  assert.match(text, /^lpk:bug-hunter +0 +0 +0 +1 +0 +0 +0$/m);
  assert.match(text, /^lenses that raised no finding in \d+ run ledger\(s\): .*regression/m);
  assert.doesNotMatch(text, /^lenses that raised no finding.*bug-hunter/m);
  assert.equal(yieldText(repo), text.trimEnd());
});

test('lpk report sets every scenario beside its status on HEAD: PASS, FAIL or NOT PROVED', () => {
  const repo = repoWith('lean-report', { 'src/a.mjs': 'export const a = 1;\n' });
  const S = 'lean-s';
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'x', '--verify', 'true', '--scenario', 'grep -q "a = 2" src/a.mjs', '--scenario', 'false', '--judged', 'the page shows 2'));
  writeFileSync(join(repo, 'src', 'a.mjs'), 'export const a = 2;\n');
  sh(repo, 'commit', '-qam', 'Set a to 2');
  lpk(repo, S, 'prove', '--all');
  const report = lpk(repo, S, 'report').stdout;
  assert.match(report, /\| S \| Scenario \| Status on HEAD \|/);
  assert.match(report, /\| S1 \| `grep -q "a = 2" src\/a\.mjs` \| PASS \|/);
  assert.match(report, /\| S2 \| `false` \| FAIL \|/);
  assert.match(report, /\| S3 \| the page shows 2 \(agent-judged\) \| NOT PROVED \|/);
});
