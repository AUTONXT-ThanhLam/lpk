// What the owner reads at the session's end: `lpk report` and `lpk run end` name every waiver, every
// deferral with who made it, every plan item held for the owner and the design round the gate
// counted, and a waiver never turns a red gate into a deliverable headline.
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

const section = (text, heading) => text.split('\n\n').find((p) => p.startsWith(heading)) || '';

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
  ok(lpk(repo, S, 'prove', '--all'));
  ok(lpk(repo, S, 'plan', 'new', 'tooltips', '--repo', repo));
  ok(lpk(repo, S, 'plan', 'add', 'Set a to 2', '--proof', 'true', '--source', 'set a'));
  ok(lpk(repo, S, 'plan', 'add', 'Widen the tooltip', '--proof', 'true', '--source', 'widen it'));
  ok(lpk(repo, S, 'plan', 'hold', 'P2', '--why', 'which width does the owner want'));
  const garbled = join(ENV.XDG_DATA_HOME, 'lpk', 'plans', 'garbled.json');
  write(ENV.XDG_DATA_HOME, 'lpk/plans/garbled.json', `{"session":"${S}",`);

  const report = ok(lpk(repo, S, 'report'));
  assert.match(report, /^deliverable at \w{12}: \d+ hold, 2 waived \(gate:error, gate:reviews\)$/m);
  assert.doesNotMatch(report, /every delivery gate holds/);
  const waived = section(report, 'Waived (2)');
  assert.match(waived, /^- gate:error by lead\b.*\d{4}-\d\d-\d\dT[\d:.]+Z.*the ci probe crashed on a network blip/m);
  assert.match(waived, /^- gate:reviews by lead\b.*\d{4}-\d\d-\d\dT[\d:.]+Z.*the hunter could not start offline/m);
  assert.match(report, new RegExp(`^- ${f.id} defect/nit: the tooltip truncates a long name — no user reads a name that long \\(deferred by cli\\)$`, 'm'));
  assert.match(report, /^Plan waiting \(tooltips\): P2 held \(which width does the owner want\)$/m);
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

  const r = lpk(repo, S, 'report');
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /^NOT deliverable at \w{12}: [^\n]*scenarios[^\n]* do not hold/m);
  assert.doesNotMatch(r.stdout, /^deliverable at/m);
  const waived = section(r.stdout, 'Waived (2)');
  assert.match(waived, /^- gate:error by lead\b.*the ci probe crashed/m);
  assert.match(waived, /^- gate:scenarios\b.*typed in the shell.*not counted \(old shape\)/m);
});
