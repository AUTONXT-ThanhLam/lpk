import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, lpk, repoWith, sh, write } from './gates-env.mjs';
import { addFinding, ruleOn } from '../lib/findings.mjs';
import { appendRecord } from '../lib/records.mjs';
import { readRun } from '../lib/run.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };

function quickRun(name, session) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, '.git/lpk/brief.md', '# Brief: set a to 2\n');
  ok(lpk(repo, session, 'decide', 'design review round 1: pass, 0/0/0', '--why', 'the critic found nothing'));
  ok(lpk(repo, session, 'run', 'start', '--bar', 'production', '--lane', 'quick', '--why', 'one line', '--scenario', 'grep -q "a = 2" src/a.mjs', '--surface', 'cli', '--entry', 'the shell', '--expect', '', '--verify', 'true'));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, session, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  return repo;
}

function section(text, heading) {
  const lines = text.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && !l.startsWith('- '));
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n');
}

test('S1 lpk report and lpk run end name each waiver, each deferral with who made it, each held plan item and the counted design round (R2, R3)', () => {
  const S = 'waiver-report-session';
  const repo = quickRun('waiver-report', S);
  const range = `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
  ok(lpk(repo, S, 'waive', 'gate:error', '--why', 'the ci probe crashed on a network blip'));
  ok(lpk(repo, S, 'waive', 'gate:reviews', '--why', 'the hunter could not start offline'));
  const f = addFinding(repo, { from: 'lpk:bug-hunter', at: range, claim: 'the tooltip truncates a long name', repro: 'r', kind: 'defect', severity: 'nit' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'a fixed width', evidence: 'seen', by: 'lpk:verifier' });
  const refused = lpk(repo, S, 'finding', 'fixed', f.id, '--closed-by', 'owner', '--evidence', 'skip it');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr + refused.stdout, /defer/);
  ok(lpk(repo, S, 'finding', 'fixed', f.id, '--closed-by', 'defer', '--evidence', 'no user reads a name that long'));
  ok(lpk(repo, S, 'learn'));
  ok(lpk(repo, S, 'prove', '--all'));
  ok(lpk(repo, S, 'plan', 'new', 'tooltips', '--repo', repo));
  ok(lpk(repo, S, 'plan', 'add', 'Set a to 2', '--proof', 'true', '--source', 'set a'));
  ok(lpk(repo, S, 'plan', 'add', 'Widen the tooltip', '--proof', 'true', '--source', 'widen it'));
  ok(lpk(repo, S, 'plan', 'hold', 'P2', '--why', 'which width does the owner want'));
  const garbled = join(ENV.XDG_DATA_HOME, 'lpk', 'plans', 'garbled.json');
  write(ENV.XDG_DATA_HOME, 'lpk/plans/garbled.json', `{"session":"${S}",`);

  const report = ok(lpk(repo, S, 'report'));
  assert.match(report, /^deliverable at \w{12}:.*\b2 waived\b.*gate:error.*gate:reviews/m);
  assert.doesNotMatch(report, /every delivery gate holds/);
  const waived = section(report, 'Waived (2):');
  assert.match(waived, /^- gate:error\b.*\blead\b.*\d{4}-\d\d-\d\dT[\d:.]+Z.*the ci probe crashed on a network blip/m);
  assert.match(waived, /^- gate:reviews\b.*\blead\b.*\d{4}-\d\d-\d\dT[\d:.]+Z.*the hunter could not start offline/m);
  assert.match(report, new RegExp(`^- ${f.id}\\b.*no user reads a name that long.*\\bdeferred by cli\\b`, 'm'));
  assert.match(report, /^Plan waiting.*tooltips.*P2.*which width does the owner want/m);
  assert.ok(report.includes(`plan not read: ${garbled}`));
  assert.match(report, /^- design review round 1: pass, 0\/0\/0: the critic found nothing/m);

  const ended = ok(lpk(repo, S, 'run', 'end'));
  assert.match(ended, /The delivery gates still apply to feat\b/);
  const after = ended.slice(ended.indexOf('still apply'));
  assert.match(after, /gate:error by lead[\s\S]*gate:reviews by lead/);
  assert.match(ok(lpk(repo, S, 'run', 'end')), /no lpk run is open/);
});

test('S2 a red gate keeps lpk report NOT deliverable while it lists every waiver, an old-shape one as not counted (R2)', () => {
  const S = 'waiver-red-session';
  const repo = quickRun('waiver-red', S);
  ok(lpk(repo, S, 'waive', 'gate:error', '--why', 'the ci probe crashed'));
  appendRecord(repo, { kind: 'waiver', run: readRun(repo).id, what: 'gate:scenarios', why: 'typed in the shell', via: 'cli' });
  const range = `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
  const f = addFinding(repo, { from: 'lpk:security', at: range, claim: 'the cookie is readable', repro: 'r', kind: 'defect', severity: 'important', area: 'security' }).finding;
  assert.equal(ruleOn(repo, { id: f.id, verdict: 'dropped', basis: 'not-reproduced', evidence: 'the repro passed', by: 'lpk:verifier' }).finding.state, 'unsettled');

  const r = lpk(repo, S, 'report');
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /^NOT deliverable at \w{12}:[^\n]*scenarios/m);
  assert.doesNotMatch(r.stdout, /^deliverable at/m);
  const waived = section(r.stdout, 'Waived (2):');
  assert.match(waived, /^- gate:error\b.*\blead\b.*the ci probe crashed/m);
  assert.match(waived, /^- gate:scenarios\b.*typed in the shell.*not counted/m);
  assert.match(r.stdout, new RegExp(`^- ${f.id} unsettled\\b.*the cookie is readable`, 'm'));
  assert.doesNotMatch(section(r.stdout, 'For the owner to read, not blocking:'), new RegExp(`\\b${f.id}\\b`));
});
