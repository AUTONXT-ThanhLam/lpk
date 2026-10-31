import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'lpk-host-'));
after(() => rmSync(home, { recursive: true, force: true }));
const CLAUDE = join(home, '.claude');
const REPO = join(home, 'work', 'both');
const CS = 'c7a1d2e4-5b6f-4a01-9c3d-2e5f7a1b8c4d';
const ZS = '96b668a9-8543-469a-96b4-6019efb50b3f';

const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
mkdirSync(REPO, { recursive: true });
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

const BASE = { HOME: home, CLAUDE_CONFIG_DIR: CLAUDE, XDG_CACHE_HOME: join(home, 'cache'),
  XDG_STATE_HOME: join(home, 'state'), XDG_DATA_HOME: join(home, 'data'),
  CLAUDE_SESSION_ID: null, CLAUDE_CODE_SESSION_ID: null,
  CLAUDE_PLUGIN_ROOT: null, CLAUDE_PROJECT_DIR: null };

function withEnv(extra, fn) {
  const env = { ...BASE, ...extra };
  const keep = {};
  for (const [k, v] of Object.entries(env)) {
    keep[k] = process.env[k];
    if (v === null || v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

function childEnv(extra = {}) {
  const env = { ...process.env, ...BASE, ...extra };
  for (const [k, v] of Object.entries(env)) if (v === null || v === undefined) delete env[k];
  return env;
}

const { agentIdOf, agentFile, configCandidates, configDirs, hostName, pluginManifest, pluginRoot, projectDir, projectsDir, projectsDirs,
  TOKENS_UNMEASURED, sessionId, tokenFigure, usageRecorded } = await import('../lib/host.mjs');
const { latestSession, meter, projectsDirs: meterProjectsDirs, sessionFiles, slugOf, total } = await import('../lib/meter.mjs');
const { lensRuns } = await import('../lib/transcripts.mjs');
const { readCache, scanSession, tokensOf } = await import('../lib/scan.mjs');
const { sessionPid } = await import('../lib/run.mjs');

const ZEROS = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
const counts = (input, cacheWrite, cacheRead, output) => ({ input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output });
const msg = (id, model, usage, content = [{ type: 'text', text: 'x' }], at = '2026-10-24T16:34:26.925Z') =>
  ({ type: 'assistant', timestamp: at, sessionId: null, message: { id, type: 'message', role: 'assistant', model, stop_reason: 'end_turn', content, usage } });
const ask = (content = 'go', at = '2026-10-24T16:34:00Z') => ({ type: 'user', timestamp: at, message: { role: 'user', content } });
const rows = (by) => Object.fromEntries(by.map((r) => [r.agent, r]));

function plantZeroUsage() {
  const p = join(CLAUDE, 'projects', slugOf(REPO));
  write(p, `${ZS}.jsonl`, jsonl([
    ask(),
    msg('msg-d1420330', 'zfmodel', ZEROS, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    msg('msg-a855ba58', 'zfmodel', ZEROS),
  ]));
  const sub = join(p, ZS, 'subagents');
  write(sub, 'agent-a3.jsonl', jsonl([
    { type: 'user', timestamp: '2026-10-24T16:34:20.850Z', agentId: 'a3', message: { role: 'user', content: 'Probe the store.' } },
    { ...msg('msg-91a2', 'zfmodel', ZEROS), agentId: 'a3' },
  ]));
  write(sub, 'agent-a3.meta.json', JSON.stringify({ agentType: 'Explore', description: 'Probe the store' }));
  write(sub, 'agent-a2.jsonl', jsonl([
    ask('Review a1b2c3d4e5f6..0f9e8d7c6b5a as the tech lead.', '2026-10-24T16:35:00Z'),
    msg('msg-77c1', 'zfmodel', ZEROS, [{ type: 'tool_use', id: 't2', name: 'StructuredOutput', input: { findings: [{ claim: 'x' }] } }], '2026-10-24T16:36:00Z'),
  ]));
  write(sub, 'agent-a2.meta.json', JSON.stringify({ agentType: 'lpk:techlead', description: 'Review the range' }));
  return p;
}

function plantClaude() {
  const p = join(CLAUDE, 'projects', slugOf(REPO));
  write(p, `${CS}.jsonl`, jsonl([
    ask(),
    msg('msg01', 'claude-opus-5-5', counts(1000, 500, 9000, 200), [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    msg('msg01', 'claude-opus-5-5', counts(1000, 500, 9000, 200)),
    msg('msg02', 'claude-opus-5-5', counts(10, 20, 30, 5), [{ type: 'text', text: 'done' }]),
  ]));
  const sub = join(p, CS, 'subagents');
  write(sub, 'agent-a1.jsonl', jsonl([
    ask('Review a1b2c3d4e5f6..0f9e8d7c6b5a as the tech lead.', '2026-10-24T16:35:00Z'),
    msg('syn', '<synthetic>', counts(999, 0, 0, 0)),
    msg('msg03', 'claude-sonnet-5-5', counts(3, 300, 0, 30), [{ type: 'tool_use', id: 't2', name: 'StructuredOutput', input: { findings: [{ claim: 'x' }] } }], '2026-10-24T16:36:00Z'),
  ]));
  write(sub, 'agent-a1.meta.json', JSON.stringify({ agentType: 'lpk:techlead', description: 'Review the range' }));
  return p;
}

test('lpk reads the Claude Code store and names its root', () => {
  withEnv({}, () => {
    assert.deepEqual(configCandidates().map((c) => [c.host, c.dir]), [['claude', CLAUDE]]);
    assert.deepEqual(configDirs(), [CLAUDE]);
    assert.equal(hostName(), 'claude');
  });
  withEnv({ CLAUDE_CONFIG_DIR: null }, () => {
    assert.equal(hostName(), 'other');
    assert.deepEqual(configDirs(), [join(home, '.claude')]);
  });
  withEnv({ CLAUDE_CONFIG_DIR: null, CLAUDE_CODE_SESSION_ID: 'c' }, () => {
    assert.equal(hostName(), 'claude');
    assert.equal(sessionId(), 'c');
  });
  const empty = join(home, 'empty');
  withEnv({ HOME: empty, CLAUDE_CONFIG_DIR: join(empty, '.claude') }, () => {
    assert.deepEqual(projectsDirs(), []);
    assert.deepEqual(meterProjectsDirs(), []);
    assert.equal(projectsDir(), join(empty, '.claude', 'projects'));
    assert.equal(meter(CS), null, 'no store holds a session it has not');
  });
  plantZeroUsage();
  plantClaude();
  withEnv({}, () => {
    assert.deepEqual(projectsDirs(), [join(CLAUDE, 'projects')]);
    assert.deepEqual(meterProjectsDirs(), projectsDirs(), 'meter reads the roots host.mjs names');
  });
});

test('the variables Claude Code sets decide who launched lpk and where it lives', () => {
  assert.equal(withEnv({ CLAUDE_PLUGIN_ROOT: '/opt/claude/plugins/lpk' }, () => pluginRoot()), '/opt/claude/plugins/lpk');
  assert.equal(withEnv({ CLAUDE_PLUGIN_ROOT: null }, () => pluginRoot()), ROOT, 'with no host env lpk is the tree it was loaded from');
  assert.equal(withEnv({ CLAUDE_PLUGIN_ROOT: null }, () => pluginManifest()), join(ROOT, '.claude-plugin', 'plugin.json'));

  assert.equal(withEnv({ CLAUDE_CODE_SESSION_ID: 'c', CLAUDE_SESSION_ID: 's' }, () => sessionId()), 'c');
  assert.equal(withEnv({ CLAUDE_CODE_SESSION_ID: null, CLAUDE_SESSION_ID: 's' }, () => sessionId()), 's');
  assert.equal(withEnv({ CLAUDE_CODE_SESSION_ID: null, CLAUDE_SESSION_ID: null }, () => sessionId()), '');

  assert.equal(withEnv({ CLAUDE_PROJECT_DIR: '/w/c' }, () => projectDir()), '/w/c');
});

test('a Claude Code run whose usage is all zero is measured, and its tokens read as unmeasured', () => {
  plantZeroUsage();
  plantClaude();
  const by = rows(withEnv({}, () => meter(ZS)));
  assert.deepEqual(Object.keys(by).sort(), ['Explore', 'lpk:techlead', 'main session']);
  assert.deepEqual([by['main session'].agentId, by['main session'].label, by['main session'].messages, by['main session'].toolCalls, by['main session'].host],
    [ZS, '', 2, 1, 'claude'], 'one row per API message, each counted once');
  assert.deepEqual(by['main session'].models, ['zfmodel']);
  assert.deepEqual([by.Explore.agentId, by.Explore.label, by.Explore.messages, by.Explore.toolCalls, by.Explore.host],
    ['a3', 'Probe the store', 1, 0, 'claude']);
  assert.equal(by['lpk:techlead'].agentId, 'a2', 'an id read from the file name when its lines carry none');
  for (const r of Object.values(by)) {
    assert.equal(r.recorded, false, `${r.agent}: no counts recorded`);
    assert.deepEqual([r.fresh, r.input, r.cacheWrite, r.output, r.cacheRead, r.peakContext], [0, 0, 0, 0, 0, 0]);
    assert.ok(r.first && r.last, `${r.agent}: its own clock is read even when its counts are not`);
  }
  const totals = withEnv({}, () => total(meter(ZS)));
  assert.deepEqual(totals, { fresh: 0, cacheRead: 0, messages: 4, recorded: false });
  assert.equal(tokenFigure(0, totals.recorded), TOKENS_UNMEASURED, 'no token total prints for a run the host did not measure');

  assert.equal(usageRecorded(ZEROS), false);
  assert.equal(usageRecorded({ ...ZEROS, output_tokens: 7 }), true);
  assert.equal(usageRecorded(counts(1, 0, 0, 0)), true);
  assert.equal(usageRecorded({}), false);
  assert.equal(usageRecorded(undefined), false);
  assert.equal(tokenFigure(1735, true), 1735);
  assert.equal(tokenFigure(0, undefined), 0, 'a figure a reader never asked about still prints');
});

test('a run made on Claude Code reads its real counts', () => {
  plantZeroUsage();
  plantClaude();
  const by = rows(withEnv({}, () => meter(CS)));
  assert.deepEqual([by['main session'].fresh, by['main session'].cacheRead, by['main session'].messages, by['main session'].peakContext, by['main session'].host],
    [1735, 9030, 2, 10500, 'claude']);
  assert.deepEqual([by['lpk:techlead'].fresh, by['lpk:techlead'].cacheRead, by['lpk:techlead'].agentId, by['lpk:techlead'].messages], [333, 0, 'a1', 1]);
  assert.equal(by['lpk:techlead'].recorded, true, 'a synthetic line\'s counts do not make a transcript measured');
  assert.deepEqual(withEnv({}, () => total(meter(CS))), { fresh: 2068, cacheRead: 9030, messages: 3, recorded: true });

  const z = join(CLAUDE, 'projects', slugOf(REPO), `${ZS}.jsonl`);
  const c = join(CLAUDE, 'projects', slugOf(REPO), `${CS}.jsonl`);
  const touch = (file, iso) => utimesSync(file, new Date(iso), new Date(iso));
  touch(c, '2026-10-24T18:00:00Z');
  touch(z, '2026-10-24T17:00:00Z');
  assert.equal(withEnv({}, () => latestSession(REPO)), CS, 'the newest transcript of the repo\'s slug');
  touch(z, '2026-10-24T19:00:00Z');
  assert.equal(withEnv({}, () => latestSession(REPO)), ZS);
});

test('the transcripts reader finds a session\'s lenses and labels them', () => {
  plantZeroUsage();
  plantClaude();
  const runs = withEnv({}, () => lensRuns(REPO, ZS));
  const by = Object.fromEntries(runs.map((r) => [r.agentType, r]));
  assert.deepEqual(Object.keys(by).sort(), ['Explore', 'lpk:techlead']);
  assert.deepEqual([by['lpk:techlead'].ended, by['lpk:techlead'].range, by['lpk:techlead'].agentId, by['lpk:techlead'].host],
    ['structured', 'a1b2c3d4e5f6..0f9e8d7c6b5a', 'a2', 'claude']);
  assert.deepEqual([by.Explore.ended, by.Explore.agentId, by.Explore.host], ['end_turn', 'a3', 'claude']);
  assert.deepEqual(by['lpk:techlead'].structured, { findings: [{ claim: 'x' }] });
  assert.deepEqual(withEnv({}, () => lensRuns(REPO, 'no-such-session')), [], 'a session the store does not have');
  assert.deepEqual(withEnv({}, () => lensRuns(REPO, CS)).map((r) => [r.agentType, r.ended, r.agentId, r.host]), [['lpk:techlead', 'structured', 'a1', 'claude']]);

  assert.equal(agentFile('agent-a1.jsonl'), true);
  assert.equal(agentFile('agent-a1.meta.json'), false);
  assert.equal(agentIdOf(join(CLAUDE, 'subagents', 'agent-a1.jsonl')), 'a1');
  assert.equal(agentIdOf('journal.jsonl'), '', 'a file that is no agent transcript names no agent');

  const found = withEnv({}, () => sessionFiles(ZS));
  assert.equal(found.host, 'claude');
  assert.deepEqual(found.agents.map((f) => basename(f)).sort(), ['agent-a2.jsonl', 'agent-a3.jsonl']);
});

test('the incremental reader folds an all-zero transcript and calls its tokens unmeasured', () => {
  plantZeroUsage();
  plantClaude();
  const scan = withEnv({}, () => scanSession(ZS, readCache(ZS)));
  assert.deepEqual(scan.agents.map((a) => `${a.id} ${a.meta.agentType} "${a.workflow}"`).sort(),
    ['a2 lpk:techlead ""', 'a3 Explore ""']);
  assert.deepEqual(tokensOf([scan.main, ...scan.agents.map((a) => a.st)].filter(Boolean)), { fresh: 0, cacheRead: 0, recorded: false });
  assert.deepEqual(tokensOf([scan.main]), { fresh: 0, cacheRead: 0, recorded: false });
  const c = withEnv({}, () => { const s = scanSession(CS, readCache(CS)); return tokensOf([s.main, ...s.agents.map((a) => a.st)].filter(Boolean)); });
  assert.deepEqual(c, { fresh: 2068, cacheRead: 9030, recorded: true });
});

test('a session\'s live process is looked for in the Claude Code store', () => {
  mkdirSync(join(CLAUDE, 'sessions'), { recursive: true });
  write(CLAUDE, `sessions/${process.pid}.json`, JSON.stringify({ pid: process.pid, sessionId: 'claude-held' }));
  assert.equal(withEnv({}, () => sessionPid('claude-held')), process.pid, 'a Claude Code run reads as still running');
  assert.equal(withEnv({}, () => sessionPid('gone')), 0, 'a session no file names has no process');
});

test('lpk meter measures an all-zero run end to end and reports its tokens as unmeasured', () => {
  plantZeroUsage();
  plantClaude();
  const cli = (session) => {
    const r = spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'meter', '--session', session, '--json'], { cwd: REPO, env: childEnv(), encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    return JSON.parse(r.stdout);
  };
  const z = cli(ZS);
  assert.equal(z.total.recorded, false);
  assert.deepEqual([z.total.fresh, z.total.cacheRead], [0, 0], 'nothing is invented for the run');
  assert.deepEqual([...new Set(z.agents.map((a) => a.host))], ['claude']);
  assert.deepEqual(z.agents.map((a) => [a.agent, a.recorded]).sort(), [['Explore', false], ['lpk:techlead', false], ['main session', false]]);
  const c = cli(CS);
  assert.deepEqual([c.total.recorded, c.total.fresh, c.total.messages], [true, 2068, 3]);
  assert.deepEqual([...new Set(c.agents.map((a) => a.host))], ['claude']);
});
