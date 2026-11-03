import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lpk, repoWith, sh, write } from './gates-env.mjs';
import { addFinding, ruleOn } from '../lib/findings.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const findingsRow = (repo, S) => JSON.parse(lpk(repo, S, 'gates', '--json').stdout).find((r) => r.gate === 'findings');

test('S4 R4: an unsettled finding in a protected area denies the findings gate until the lead waives it; one outside stays a note', () => {
  const S = 'protected-session';
  const repo = repoWith('protected', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--target', 'main', '--verify', 'true'));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  sh(repo, 'commit', '-qam', 'Set a to 2');
  const at = `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
  const raise = (claim, area) => addFinding(repo, { from: 'lpk:bug-hunter', at, claim, repro: 'r', kind: 'defect', severity: 'important', ...(area ? { area } : {}) });
  raise('the session cookie is readable by scripts', 'security');
  raise('the label wraps on a narrow screen');
  for (const id of ['F1', 'F2']) assert.equal(ruleOn(repo, { id, verdict: 'unsettled', evidence: 'could not start the app', by: 'lpk:verifier' }).finding.state, 'unsettled');

  const denied = findingsRow(repo, S);
  assert.equal(denied.holds, false);
  const [blocking, ...rest] = denied.why.split('; ');
  assert.match(blocking, /F1/);
  assert.doesNotMatch(blocking, /F2/);
  assert.doesNotMatch(rest.join('; '), /F1/, 'the protected finding is not also listed as not blocking');
  assert.match(rest.join('; '), /F2/);
  assert.match(lpk(repo, S, 'gates').stdout, /^findings +DENY/m);

  ok(lpk(repo, S, 'waive', 'gate:findings', '--why', 'the cookie flag is set by the proxy in front of the app'));
  const waived = findingsRow(repo, S);
  assert.equal(waived.holds, true);
  assert.match(waived.why, /^waived by the lead/);
  assert.deepEqual(waived.waived, { by: 'lead', why: 'the cookie flag is set by the proxy in front of the app' });
});
