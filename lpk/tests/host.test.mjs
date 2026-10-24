// Which host launched lpk, and where each host keeps what lpk reads. One place answers, and BOTH
// hosts' stores are read at once, so a run made on Qoder reads as a run made on Claude Code does —
// except that Qoder writes every usage count in its transcripts as 0 (measured), so its token figure
// reads as unmeasured, never as 0. The fixtures below plant a Qoder-shaped store in a temp home and
// read it with the real readers (lib/meter.mjs, lib/transcripts.mjs, lib/scan.mjs, lib/run.mjs), not
// with a copy of their logic.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'lpk-host-'));
after(() => rmSync(home, { recursive: true, force: true }));
const QODER = join(home, '.qoder');
const CLAUDE = join(home, '.claude');
const REPO = join(home, 'work', 'both');
const QS = '96b668a9-8543-469a-96b4-6019efb50b3f'; // a Qoder session: a uuid, as Qoder names them
const CS = 'c7a1d2e4-5b6f-4a01-9c3d-2e5f7a1b8c4d'; // a Claude Code session of the same repo

const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
mkdirSync(REPO, { recursive: true }); // the directory a session of this repo was started in
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

// The environment as the two hosts hand it to lpk: both config roots inside the scratch home, and
// none of the session / plugin-root / project-dir variables unless a test names them. null deletes,
// so the machine's real ~/.qoder store never leaks into these reads.
const BASE = { HOME: home, QODER_CONFIG_DIR: QODER, CLAUDE_CONFIG_DIR: CLAUDE, XDG_CACHE_HOME: join(home, 'cache'),
  XDG_STATE_HOME: join(home, 'state'), XDG_DATA_HOME: join(home, 'data'),
  QODER_SESSION_ID: null, CLAUDE_SESSION_ID: null, CLAUDE_CODE_SESSION_ID: null,
  QODER_PLUGIN_ROOT: null, CLAUDE_PLUGIN_ROOT: null, QODER_PROJECT_DIR: null, CLAUDE_PROJECT_DIR: null };

function withEnv(extra, fn) {
  const env = { ...BASE, ...extra };
  const keep = {};
  for (const [k, v] of Object.entries(env)) {
    keep[k] = process.env[k];
    if (v === null || v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// The same environment for a child process: a null value means the variable is not there, and the
// runner's own marker would silence the CLI's stdout.
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

// One API message as each host writes it. Qoder's counts are all 0 (measured); Claude Code's are real.
const ZEROS = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
const counts = (input, cacheWrite, cacheRead, output) => ({ input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output });
const msg = (id, model, usage, content = [{ type: 'text', text: 'x' }], at = '2026-10-24T16:34:26.925Z') =>
  ({ type: 'assistant', timestamp: at, sessionId: null, message: { id, type: 'message', role: 'assistant', model, stop_reason: 'end_turn', content, usage } });
const ask = (content = 'go', at = '2026-10-24T16:34:00Z') => ({ type: 'user', timestamp: at, message: { role: 'user', content } });
const rows = (by) => Object.fromEntries(by.map((r) => [r.agent, r]));

// A Qoder-shaped store: the session's own transcript, its subagents each with a sibling .meta.json,
// the task-<id>.json files and the compression-v2/ dir Qoder also writes, and no workflows dir.
function plantQoder() {
  const p = join(QODER, 'projects', slugOf(REPO));
  write(p, `${QS}.jsonl`, jsonl([
    ask(),
    msg('chatcmpl-d1420330', 'qfmodel', ZEROS, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    msg('chatcmpl-a855ba58', 'qfmodel', ZEROS),
  ]));
  const sub = join(p, QS, 'subagents');
  write(sub, 'agent-aExplore-f56533ee3ef8f18c.jsonl', jsonl([
    { type: 'user', timestamp: '2026-10-24T16:34:20.850Z', agentId: 'aExplore-f56533ee3ef8f18c', message: { role: 'user', content: 'Probe the store.' } },
    { ...msg('chatcmpl-91a2', 'qfmodel', ZEROS), agentId: 'aExplore-f56533ee3ef8f18c' },
  ]));
  write(sub, 'agent-aExplore-f56533ee3ef8f18c.meta.json', JSON.stringify({ agentType: 'Explore', toolUseId: 'call_e575852f82394e33b35372f6', description: 'Probe the Qoder store', invocationName: 'Explore', color: 'cyan' }));
  // An lpk lens on Qoder: the file name carries its type and a hash, and its lines carry no agentId,
  // so its id comes from the file name.
  write(sub, 'agent-alpk-techlead-9c2b4d1e0f7a5b83.jsonl', jsonl([
    ask('Review a1b2c3d4e5f6..0f9e8d7c6b5a as the tech lead.', '2026-10-24T16:35:00Z'),
    msg('chatcmpl-77c1', 'qfmodel', ZEROS, [{ type: 'tool_use', id: 't2', name: 'StructuredOutput', input: { findings: [{ claim: 'x' }] } }], '2026-10-24T16:36:00Z'),
  ]));
  write(sub, 'agent-alpk-techlead-9c2b4d1e0f7a5b83.meta.json', JSON.stringify({ agentType: 'lpk:techlead', toolUseId: 'call_1', description: 'Review the range', invocationName: 'lpk:techlead' }));
  // What Qoder writes beside them: none of it a transcript, none of it read as an agent.
  write(sub, 'task-a6c583226d2e6c089.json', JSON.stringify({ taskId: 'a6c583226d2e6c089', sessionId: QS, agentId: 'aExplore-f56533ee3ef8f18c', agentType: 'Explore', resolvedModel: 'qfmodel', description: 'Probe the Qoder store', status: 'completed', result: 'ok', transcriptPath: join(sub, 'agent-aExplore-f56533ee3ef8f18c.jsonl'), createdAt: 1, completedAt: 2, outputPath: '/tmp/x' }));
  write(p, `${QS}/compression-v2/state.json`, JSON.stringify({ v: 2 }));
  return p;
}

// The same repo's Claude Code store, with the counts Claude Code really writes.
function plantClaude() {
  const p = join(CLAUDE, 'projects', slugOf(REPO));
  write(p, `${CS}.jsonl`, jsonl([
    ask(),
    msg('msg01', 'claude-opus-5-5', counts(1000, 500, 9000, 200), [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    msg('msg01', 'claude-opus-5-5', counts(1000, 500, 9000, 200)), // one line per content block: counted once
    msg('msg02', 'claude-opus-5-5', counts(10, 20, 30, 5), [{ type: 'text', text: 'done' }]),
  ]));
  const sub = join(p, CS, 'subagents');
  write(sub, 'agent-a1.jsonl', jsonl([
    ask('Review a1b2c3d4e5f6..0f9e8d7c6b5a as the tech lead.', '2026-10-24T16:35:00Z'),
    msg('syn', '<synthetic>', counts(999, 0, 0, 0)), // a synthetic line names no real API call
    msg('msg03', 'claude-sonnet-5-5', counts(3, 300, 0, 30), [{ type: 'tool_use', id: 't2', name: 'StructuredOutput', input: { findings: [{ claim: 'x' }] } }], '2026-10-24T16:36:00Z'),
  ]));
  write(sub, 'agent-a1.meta.json', JSON.stringify({ agentType: 'lpk:techlead', description: 'Review the range' }));
  return p;
}

test('lpk reads both hosts\' stores, the one that launched it first, and never the same root twice', () => {
  withEnv({}, () => {
    assert.deepEqual(configCandidates().map((c) => [c.host, c.dir]), [['qoder', QODER], ['claude', CLAUDE]]);
    assert.deepEqual(configDirs(), [QODER, CLAUDE]);
    assert.equal(hostName(), 'qoder');
  });
  // Only Claude Code configured: its root leads, and Qoder's default home stays a candidate.
  withEnv({ QODER_CONFIG_DIR: null }, () => {
    assert.deepEqual(configDirs(), [CLAUDE, join(home, '.qoder')]);
    assert.equal(hostName(), 'claude');
  });
  // Both variables name one directory: it is read once.
  withEnv({ QODER_CONFIG_DIR: CLAUDE, CLAUDE_CONFIG_DIR: CLAUDE }, () => {
    assert.deepEqual(configDirs(), [CLAUDE]);
  });
  // Neither host launched it: the two default homes, in host order, Qoder's first.
  withEnv({ QODER_CONFIG_DIR: null, CLAUDE_CONFIG_DIR: null }, () => {
    assert.equal(hostName(), 'other');
    assert.deepEqual(configDirs(), [join(home, '.qoder'), join(home, '.claude')]);
  });
  // Launched by Qoder with nothing but its session id: still Qoder.
  withEnv({ QODER_CONFIG_DIR: null, CLAUDE_CONFIG_DIR: null, QODER_SESSION_ID: 'q' }, () => {
    assert.equal(hostName(), 'qoder');
    assert.equal(sessionId(), 'q');
  });
  // A store with nothing in it reads as nothing; the primary root is still named.
  const empty = join(home, 'empty');
  withEnv({ HOME: empty, QODER_CONFIG_DIR: join(empty, '.qoder'), CLAUDE_CONFIG_DIR: join(empty, '.claude') }, () => {
    assert.deepEqual(projectsDirs(), []);
    assert.deepEqual(meterProjectsDirs(), []);
    assert.equal(projectsDir(), join(empty, '.qoder', 'projects'));
    assert.equal(meter(QS), null, 'no store holds a session neither has');
  });
  plantQoder();
  plantClaude();
  withEnv({}, () => {
    assert.deepEqual(projectsDirs(), [join(QODER, 'projects'), join(CLAUDE, 'projects')]);
    assert.deepEqual(meterProjectsDirs(), projectsDirs(), 'meter reads the roots host.mjs names');
  });
});

test('the variables each host sets decide who launched lpk and where it lives', () => {
  assert.equal(withEnv({ QODER_PLUGIN_ROOT: '/opt/qoder/plugins/lpk' }, () => pluginRoot()), '/opt/qoder/plugins/lpk');
  assert.equal(withEnv({ CLAUDE_PLUGIN_ROOT: '/opt/claude/plugins/lpk' }, () => pluginRoot()), '/opt/claude/plugins/lpk');
  assert.equal(withEnv({ QODER_PLUGIN_ROOT: '/opt/qoder/plugins/lpk', CLAUDE_PLUGIN_ROOT: '/opt/claude/plugins/lpk' }, () => pluginRoot()), '/opt/qoder/plugins/lpk');
  assert.equal(withEnv({ QODER_PLUGIN_ROOT: null, CLAUDE_PLUGIN_ROOT: null }, () => pluginRoot()), ROOT, 'with no host env lpk is the tree it was loaded from');
  assert.equal(withEnv({ QODER_PLUGIN_ROOT: null, CLAUDE_PLUGIN_ROOT: null }, () => pluginManifest()), join(ROOT, '.claude-plugin', 'plugin.json'));

  assert.equal(withEnv({ QODER_SESSION_ID: 'q', CLAUDE_CODE_SESSION_ID: 'c', CLAUDE_SESSION_ID: 's' }, () => sessionId()), 'q');
  assert.equal(withEnv({ QODER_SESSION_ID: null, CLAUDE_CODE_SESSION_ID: 'c', CLAUDE_SESSION_ID: 's' }, () => sessionId()), 'c');
  assert.equal(withEnv({ QODER_SESSION_ID: null, CLAUDE_CODE_SESSION_ID: null, CLAUDE_SESSION_ID: 's' }, () => sessionId()), 's');
  assert.equal(withEnv({ QODER_SESSION_ID: null, CLAUDE_CODE_SESSION_ID: null, CLAUDE_SESSION_ID: null }, () => sessionId()), '');

  assert.equal(withEnv({ QODER_PROJECT_DIR: '/w/q', CLAUDE_PROJECT_DIR: '/w/c' }, () => projectDir()), '/w/q');
  assert.equal(withEnv({ QODER_PROJECT_DIR: null, CLAUDE_PROJECT_DIR: '/w/c' }, () => projectDir()), '/w/c');
});

test('a run made on Qoder is measured from its store, and its all-zero usage reads as unmeasured', () => {
  plantQoder();
  plantClaude();
  const by = rows(withEnv({}, () => meter(QS)));
  assert.deepEqual(Object.keys(by).sort(), ['Explore', 'lpk:techlead', 'main session']);
  assert.deepEqual([by['main session'].agentId, by['main session'].label, by['main session'].messages, by['main session'].toolCalls, by['main session'].host],
    [QS, '', 2, 1, 'qoder'], 'one row per API message, each counted once');
  assert.deepEqual(by['main session'].models, ['qfmodel']);
  // Qoder's own agent file name: agent-<type>-<hash>.jsonl.
  assert.deepEqual([by.Explore.agentId, by.Explore.label, by.Explore.messages, by.Explore.toolCalls, by.Explore.host],
    ['aExplore-f56533ee3ef8f18c', 'Probe the Qoder store', 1, 0, 'qoder']);
  assert.equal(by['lpk:techlead'].agentId, 'alpk-techlead-9c2b4d1e0f7a5b83', 'an id read from the file name when its lines carry none');
  for (const r of Object.values(by)) {
    assert.equal(r.recorded, false, `${r.agent}: Qoder records no counts`);
    assert.deepEqual([r.fresh, r.input, r.cacheWrite, r.output, r.cacheRead, r.peakContext], [0, 0, 0, 0, 0, 0]);
    assert.ok(r.first && r.last, `${r.agent}: its own clock is read even when its counts are not`);
  }
  assert.deepEqual(withEnv({}, () => total(meter(QS))), { fresh: 0, cacheRead: 0, messages: 4, recorded: false });
  assert.equal(tokenFigure(0, total(meter(QS)).recorded), TOKENS_UNMEASURED, 'no token total prints for a run the host did not measure');

  // The rule itself, both ways.
  assert.equal(usageRecorded(ZEROS), false);
  assert.equal(usageRecorded({ ...ZEROS, output_tokens: 7 }), true);
  assert.equal(usageRecorded(counts(1, 0, 0, 0)), true);
  assert.equal(usageRecorded({}), false);
  assert.equal(usageRecorded(undefined), false);
  assert.equal(tokenFigure(1735, true), 1735);
  assert.equal(tokenFigure(0, undefined), 0, 'a figure a reader never asked about still prints');
});

test('a run made on Claude Code still reads its real counts from the other root', () => {
  plantQoder();
  plantClaude();
  const by = rows(withEnv({}, () => meter(CS)));
  assert.deepEqual([by['main session'].fresh, by['main session'].cacheRead, by['main session'].messages, by['main session'].peakContext, by['main session'].host],
    [1735, 9030, 2, 10500, 'claude']);
  assert.deepEqual([by['lpk:techlead'].fresh, by['lpk:techlead'].cacheRead, by['lpk:techlead'].agentId, by['lpk:techlead'].messages], [333, 0, 'a1', 1]);
  assert.equal(by['lpk:techlead'].recorded, true, 'a synthetic line\'s counts do not make a transcript measured');
  assert.deepEqual(withEnv({}, () => total(meter(CS))), { fresh: 2068, cacheRead: 9030, messages: 3, recorded: true });

  // The repo's newest session comes from whichever store holds it, not from one root alone.
  const q = join(QODER, 'projects', slugOf(REPO), `${QS}.jsonl`);
  const c = join(CLAUDE, 'projects', slugOf(REPO), `${CS}.jsonl`);
  const touch = (file, iso) => utimesSync(file, new Date(iso), new Date(iso));
  touch(c, '2026-10-24T18:00:00Z');
  touch(q, '2026-10-24T17:00:00Z');
  assert.equal(withEnv({}, () => latestSession(REPO)), CS, 'the newest transcript of the repo\'s slug, in either store');
  touch(q, '2026-10-24T19:00:00Z');
  assert.equal(withEnv({}, () => latestSession(REPO)), QS);
});

test('the transcripts reader finds a session\'s lenses in the Qoder store and labels them', () => {
  plantQoder();
  plantClaude();
  const runs = withEnv({}, () => lensRuns(REPO, QS));
  const by = Object.fromEntries(runs.map((r) => [r.agentType, r]));
  assert.deepEqual(Object.keys(by).sort(), ['Explore', 'lpk:techlead']);
  assert.deepEqual([by['lpk:techlead'].ended, by['lpk:techlead'].range, by['lpk:techlead'].agentId, by['lpk:techlead'].host],
    ['structured', 'a1b2c3d4e5f6..0f9e8d7c6b5a', 'alpk-techlead-9c2b4d1e0f7a5b83', 'qoder']);
  assert.deepEqual([by.Explore.ended, by.Explore.agentId, by.Explore.host], ['end_turn', 'aExplore-f56533ee3ef8f18c', 'qoder']);
  assert.deepEqual(by['lpk:techlead'].structured, { findings: [{ claim: 'x' }] });
  assert.deepEqual(withEnv({}, () => lensRuns(REPO, 'no-such-session')), [], 'a session neither store has');
  // The same reader on the Claude Code store, beside the Qoder one.
  assert.deepEqual(withEnv({}, () => lensRuns(REPO, CS)).map((r) => [r.agentType, r.ended, r.agentId, r.host]), [['lpk:techlead', 'structured', 'a1', 'claude']]);

  // The file name rule both hosts write, and the id it gives.
  assert.equal(agentFile('agent-aExplore-f56533ee3ef8f18c.jsonl'), true);
  assert.equal(agentFile('task-a6c583226d2e6c089.json'), false);
  assert.equal(agentFile('agent-aExplore-f56533ee3ef8f18c.meta.json'), false);
  assert.equal(agentIdOf(join(QODER, 'subagents', 'agent-alpk-techlead-9c2b4d1e0f7a5b83.jsonl')), 'alpk-techlead-9c2b4d1e0f7a5b83');
  assert.equal(agentIdOf('journal.jsonl'), '', 'a file that is no agent transcript names no agent');

  // The session's own files, found in the Qoder store: its two agents, and none of Qoder's other files.
  const found = withEnv({}, () => sessionFiles(QS));
  assert.equal(found.host, 'qoder');
  assert.deepEqual(found.agents.map((f) => f.split('/').pop()).sort(), ['agent-aExplore-f56533ee3ef8f18c.jsonl', 'agent-alpk-techlead-9c2b4d1e0f7a5b83.jsonl']);
});

test('the incremental reader folds a Qoder transcript and calls its tokens unmeasured', () => {
  plantQoder();
  plantClaude();
  const scan = withEnv({}, () => scanSession(QS, readCache(QS)));
  assert.deepEqual(scan.agents.map((a) => `${a.id} ${a.meta.agentType} "${a.workflow}"`).sort(),
    ['aExplore-f56533ee3ef8f18c Explore ""', 'alpk-techlead-9c2b4d1e0f7a5b83 lpk:techlead ""'], 'Qoder\'s names split as the ids they are');
  assert.deepEqual(tokensOf([scan.main, ...scan.agents.map((a) => a.st)].filter(Boolean)), { fresh: 0, cacheRead: 0, recorded: false });
  assert.deepEqual(tokensOf([scan.main]), { fresh: 0, cacheRead: 0, recorded: false });
  const c = withEnv({}, () => { const s = scanSession(CS, readCache(CS)); return tokensOf([s.main, ...s.agents.map((a) => a.st)].filter(Boolean)); });
  assert.deepEqual(c, { fresh: 2068, cacheRead: 9030, recorded: true });
});

test('a session\'s live process is looked for in both hosts\' stores', () => {
  mkdirSync(join(QODER, 'sessions'), { recursive: true });
  write(QODER, `sessions/${process.pid}.json`, JSON.stringify({ pid: process.pid, sessionId: 'qoder-held' }));
  mkdirSync(join(CLAUDE, 'sessions'), { recursive: true });
  write(CLAUDE, `sessions/${process.pid}.json`, JSON.stringify({ pid: process.pid, sessionId: 'claude-held' }));
  assert.equal(withEnv({}, () => sessionPid('qoder-held')), process.pid, 'a Qoder-held run reads as still running');
  assert.equal(withEnv({}, () => sessionPid('claude-held')), process.pid, 'and a Claude Code one as it always did');
  assert.equal(withEnv({}, () => sessionPid('gone')), 0, 'a session neither file names has no process');
});

test('lpk meter measures a Qoder run end to end and reports its tokens as unmeasured', () => {
  plantQoder();
  plantClaude();
  const cli = (session) => {
    const r = spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'meter', '--session', session, '--json'], { cwd: REPO, env: childEnv(), encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    return JSON.parse(r.stdout);
  };
  const q = cli(QS);
  assert.equal(q.total.recorded, false);
  assert.deepEqual([q.total.fresh, q.total.cacheRead], [0, 0], 'nothing is invented for the run');
  assert.deepEqual([...new Set(q.agents.map((a) => a.host))], ['qoder']);
  assert.deepEqual(q.agents.map((a) => [a.agent, a.recorded]).sort(), [['Explore', false], ['lpk:techlead', false], ['main session', false]]);
  const c = cli(CS);
  assert.deepEqual([c.total.recorded, c.total.fresh, c.total.messages], [true, 2068, 3]);
  assert.deepEqual([...new Set(c.agents.map((a) => a.host))], ['claude']);
});
