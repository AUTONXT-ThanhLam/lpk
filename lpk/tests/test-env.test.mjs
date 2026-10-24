// The test helpers' environment: neither host's own names leak into the children they start, so a
// suite measures its own scratch run whatever the machine that launched it happens to export.
// `lib/host.mjs` answers for the host whose variables are set — `QODER_SESSION_ID` before
// `CLAUDE_CODE_SESSION_ID` — so one leaked name would decide a test by who started it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS = join(ROOT, 'tests');
const out = mkdtempSync(join(tmpdir(), 'lpk-env-probe-'));
after(() => rmSync(out, { recursive: true, force: true }));
// What the shell of a Qoder session exports, faked here rather than trusted to the machine.
const FAKE = 'leaked-qoder-session';
const LEAK = { QODER_SESSION_ID: FAKE, QODER_PLUGIN_ROOT: '/opt/qoder/plugins/lpk', QODER_PROJECT_DIR: '/w/leaked', QODER_CONFIG_DIR: '/home/leaked/.qoder' };

// One helper, read under that environment, writing what the child it starts inherits into `file`.
// Run as a child itself so every helper snapshots the fake in its `process.env`, exactly as a suite
// started by Qoder does.
const PROBE = `
  const { spawnSync } = await import('node:child_process');
  const { rmSync, writeFileSync } = await import('node:fs');
  const { hostName, sessionId } = await import(${JSON.stringify(join(ROOT, 'lib', 'host.mjs'))});
  const [name, file] = process.argv.slice(1);
  // Read before the helper loads: it scrubs process.env too, and the point here is what the helper
  // was handed.
  const inherited = process.env.QODER_SESSION_ID;
  const m = await import(${JSON.stringify(HELPERS)} + '/' + name + '.mjs');
  const seen = spawnSync('node', ['-e', 'process.stdout.write(process.env.QODER_SESSION_ID ?? "<none>")'], { env: m.ENV, encoding: 'utf8' }).stdout;
  writeFileSync(file, JSON.stringify({
    inherited,
    qoderKeys: Object.keys(m.ENV).filter((k) => /^QODER_/.test(k)),
    seen,
    host: hostName(m.ENV),
    session: sessionId(m.ENV),
    inProcessSession: sessionId(),
  }));
  rmSync(m.tmp, { recursive: true, force: true });
`;

const probe = (name) => {
  const file = join(out, `${name}.json`);
  const p = spawnSync('node', ['--input-type=module', '-e', PROBE, name, file], { cwd: ROOT, env: { ...process.env, ...LEAK }, encoding: 'utf8' });
  assert.equal(p.status, 0, `${name}: ${p.stderr}`);
  return JSON.parse(readFileSync(file, 'utf8'));
};

test('no helper hands the host that launched the suite to the child it starts', () => {
  for (const name of ['gates-env', 'hooks-env', 'verbs-env']) {
    const r = probe(name);
    // Non-vacuous both ways: the fake really did reach the environment the helper read, and a helper
    // that stopped scrubbing would name it back here.
    assert.equal(r.inherited, FAKE, `${name}: the fake was in the environment it read`);
    assert.deepEqual(r.qoderKeys, [], `${name}: its ENV holds no QODER_* of the launcher's`);
    assert.equal(r.seen, '<none>', `${name}: the child it starts sees no QODER_SESSION_ID`);
    assert.equal(r.host, 'claude', `${name}: a child runs as a Claude Code session of the scratch home`);
    assert.equal(r.session, '', `${name}: host.sessionId() gives the child no session until the test names one`);
    // gates-env pushes its dirs into `process.env` as well, for the lib calls a test makes in its own
    // process; there the launcher's session would answer for the run just the same.
    if (name === 'gates-env') assert.equal(r.inProcessSession, '', `${name}: no launcher session in-process either`);
  }
});
