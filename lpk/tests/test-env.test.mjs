import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS = join(ROOT, 'tests');
const out = mkdtempSync(join(tmpdir(), 'lpk-env-probe-'));
after(() => rmSync(out, { recursive: true, force: true }));
const FAKE = 'leaked-claude-session';
const LEAK = { CLAUDE_CODE_SESSION_ID: FAKE, CLAUDE_SESSION_ID: FAKE, CLAUDE_PLUGIN_ROOT: '/opt/leaked/plugins/lpk', CLAUDE_PROJECT_DIR: '/w/leaked', CLAUDE_CONFIG_DIR: '/home/leaked/.claude' };

const PROBE = `
  const { spawnSync } = await import('node:child_process');
  const { rmSync, writeFileSync } = await import('node:fs');
  const { hostName, sessionId } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'lib', 'host.mjs')).href)});
  const [name, file] = process.argv.slice(1);
  const inherited = process.env.CLAUDE_CODE_SESSION_ID;
  const m = await import(${JSON.stringify(pathToFileURL(HELPERS).href)} + '/' + name + '.mjs');
  const seen = spawnSync('node', ['-e', 'process.stdout.write(process.env.CLAUDE_CODE_SESSION_ID ?? "<none>")'], { env: m.ENV, encoding: 'utf8' }).stdout;
  writeFileSync(file, JSON.stringify({
    inherited,
    leaked: Object.keys(m.ENV).filter((k) => m.ENV[k] === ${JSON.stringify(LEAK)}[k]),
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
    assert.equal(r.inherited, FAKE, `${name}: the fake was in the environment it read`);
    assert.deepEqual(r.leaked, [], `${name}: its ENV holds no CLAUDE_* value of the launcher's`);
    assert.equal(r.seen, '', `${name}: the child it starts sees the launcher's CLAUDE_CODE_SESSION_ID emptied`);
    assert.equal(r.host, 'claude', `${name}: a child runs as a Claude Code session of the scratch home`);
    assert.equal(r.session, '', `${name}: host.sessionId() gives the child no session until the test names one`);
    if (name === 'gates-env') assert.equal(r.inProcessSession, '', `${name}: no launcher session in-process either`);
  }
});
