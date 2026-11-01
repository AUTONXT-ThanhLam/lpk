import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, lpk, repoWith, sh, tmp, write } from './verbs-env.mjs';
import { stubBin } from './stub.mjs';

const CLAUDE = ENV.CLAUDE_CONFIG_DIR;
const DATA = join(ENV.XDG_DATA_HOME, 'lpk');
const PROJECT = join(CLAUDE, 'projects', '-work-repo');
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const RUN = '20261021100000-m1';
let worlds = 0;

const msg = (id, model, [input, cacheWrite, cacheRead, output], at, extra = {}) => ({
  type: 'assistant', timestamp: at,
  message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output, ...extra } },
});
const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';

function world({ main = [], agents = {}, wallMs = 600000, records = [] }) {
  rmSync(join(CLAUDE, 'projects'), { recursive: true, force: true });
  const repo = repoWith(`measure-repo-${worlds++}`, { 'a.txt': 'a\n' });
  write(PROJECT, 's1.jsonl', jsonl(main));
  for (const [name, { type, rows }] of Object.entries(agents)) {
    write(PROJECT, `s1/subagents/agent-${name}.jsonl`, jsonl(rows));
    write(PROJECT, `s1/subagents/agent-${name}.meta.json`, JSON.stringify({ agentType: type }));
  }
  mkdirSync(join(repo, '.git', 'lpk'), { recursive: true });
  writeFileSync(join(repo, '.git', 'lpk', 'records.jsonl'), jsonl(records));
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, 'runs.jsonl'), jsonl([{ id: RUN, repo: 'work-repo', path: repo, session: 's1', lane: 'full', started: '2026-10-21T10:00:00.000Z', recorded: '2026-10-21T11:00:00.000Z', wallMs, yield: {}, agents: {}, lenses: {}, files: [] }]));
  return repo;
}
const bench = (...args) => { const r = lpk(tmp, 'dev', 'bench', ...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const json = () => JSON.parse(bench('--json'));

test('the tokens inside the run windows and the ones outside them add up to what the host says the session used', () => {
  world({
    main: [
      msg('before', SONNET, [50, 0, 500, 5], '2026-10-21T09:00:00Z'),
      msg('inside', SONNET, [100, 0, 1000, 10], '2026-10-21T10:01:00Z'),
      msg('after', SONNET, [200, 0, 2000, 20], '2026-10-21T11:00:00Z'),
    ],
    agents: { fork: { type: 'lpk:techlead', rows: [msg('inside', SONNET, [100, 0, 1000, 10], '2026-10-21T10:01:00Z'), msg('own', SONNET, [10, 0, 100, 1], '2026-10-21T10:02:00Z')] } },
  });
  const j = json();
  const host = j.hosts.find((h) => h.host === 'claude');
  assert.equal(j.tokens.inRuns.fresh + j.tokens.outsideRuns.fresh, host.fresh, 'fresh: inside + outside is the host headline');
  assert.equal(j.tokens.inRuns.cacheRead + j.tokens.outsideRuns.cacheRead, host.cacheRead, 'cache reads: the same');
  assert.equal(j.tokens.outsideRuns.fresh, 275, 'the message before the run and the one after it are shown, not left out');
  const by = Object.fromEntries(j.agents.map((a) => [a.agent, a]));
  assert.equal(by['lpk:techlead'].fresh, 11, 'a message a fork replays from the main transcript is the main transcript\'s, not counted twice');
  assert.equal(by['main session'].fresh, 110);
});

test('the text report says how many tokens were spent outside the run windows', () => {
  world({ main: [msg('inside', SONNET, [100, 0, 1000, 10], '2026-10-21T10:01:00Z'), msg('after', SONNET, [200, 0, 2000, 20], '2026-10-21T11:00:00Z')] });
  const line = bench().split('\n').find((l) => /outside/i.test(l) && /tokens/i.test(l));
  assert.ok(line, 'a line about tokens outside the windows');
  assert.match(line, /220/);
});

test('cost follows the model and the kind of token, and an unpriced model has no figure', () => {
  const same = [1000, 0, 0, 1000];
  world({
    main: [msg('lead', SONNET, [0, 0, 0, 1], '2026-10-21T10:00:30Z')],
    agents: {
      opus: { type: 'role:opus', rows: [msg('o', OPUS, same, '2026-10-21T10:01:00Z')] },
      sonnet: { type: 'role:sonnet', rows: [msg('s', SONNET, same, '2026-10-21T10:01:00Z')] },
      deepseek: { type: 'role:other', rows: [msg('d', 'deepseek-flash', same, '2026-10-21T10:01:00Z')] },
      reads: { type: 'role:input', rows: [msg('i', SONNET, [2000, 0, 0, 0], '2026-10-21T10:01:00Z')] },
      writes: { type: 'role:output', rows: [msg('w', SONNET, [0, 0, 0, 2000], '2026-10-21T10:01:00Z')] },
      exact: { type: 'role:exact', rows: [msg('e', SONNET, [0, 0, 0, 1000000], '2026-10-21T10:01:00Z')] },
      short: { type: 'role:fiveminutes', rows: [msg('c5', SONNET, [0, 1000000, 0, 0], '2026-10-21T10:01:00Z')] },
      long: { type: 'role:onehour', rows: [msg('c1', SONNET, [0, 1000000, 0, 0], '2026-10-21T10:01:00Z', { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000000 } })] },
    },
  });
  const by = Object.fromEntries(json().agents.map((a) => [a.agent, a]));
  assert.ok(by['role:opus'].usd > by['role:sonnet'].usd, 'at equal token counts the dearer model costs more');
  assert.ok(by['role:output'].usd > by['role:input'].usd, 'at equal token counts an output token costs more than an input one');
  assert.equal(by['role:exact'].usd, 10, 'a million sonnet output tokens are ten dollars');
  assert.ok(by['role:onehour'].usd > by['role:fiveminutes'].usd, 'a cache write held an hour costs more than one held five minutes');
  assert.equal(by['role:other'].usd, null, 'a model with no known price has no cost figure, not 0');
  assert.equal(by['role:other'].unpriced, 1);
  assert.equal(by['role:other'].fresh, 2000, 'its token counts are still reported');
  const order = json().agents.map((a) => a.agent);
  assert.equal(order.at(-1), 'role:other', 'a row with no cost figure sorts after the priced ones');
});

test('a cache write held an hour is never priced above the cache write the message recorded', () => {
  world({ main: [msg('odd', SONNET, [0, 100, 0, 0], '2026-10-21T10:01:00Z', { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000000 } })] });
  assert.ok(json().tokens.inRuns.usd < 0.001, 'a hundred cache-write tokens cost less than a tenth of a cent');
});

test('a lens run by the CLI has tokens but no cost figure, because its record carries no model split', () => {
  world({
    main: [msg('lead', SONNET, [1, 0, 0, 1], '2026-10-21T10:01:00Z')],
    records: [{ at: '2026-10-21T10:01:00Z', run: RUN, kind: 'code-review', model: 'sonnet', range: 'a..b', exit: 0, findings: 0, ids: [], durationMs: 1000, tokens: { fresh: 700, cacheRead: 900 } }],
  });
  const j = json();
  const row = j.cliLensRuns.find((c) => c.lens === 'code-review:sonnet');
  assert.equal(row.fresh, 700);
  assert.equal(row.usd, null);
});

const ghStub = `import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('repos/')) || '';
const since = (url.match(/since=([^&]+)/) || [])[1] || '2000-01-01T00:00:00Z';
const comment = (id, login, at) => ({ id, user: { login }, pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7', html_url: 'https://github.com/acme/app/pull/7#r' + id, path: 'a.txt', line: 1, diff_hunk: '', body: 'note ' + id, created_at: at });
const all = [comment(1, 'lead', '2026-10-01T00:00:00Z'), comment(2, 'other', '2026-10-02T00:00:00Z')];
const write = (v) => process.stdout.write(JSON.stringify(v));
if (url.includes('/pulls/comments')) write([all.filter((c) => c.created_at >= since)]);
else if (url.includes('/reviews')) write([[{ id: 9, user: { login: 'lead' }, html_url: 'https://github.com/acme/app/pull/7#rv9', body: 'looks good', state: 'COMMENTED', submitted_at: '2026-10-03T00:00:00Z' }]]);
else write([{ number: 7, updated_at: '2026-10-03T00:00:00Z' }].filter((p) => p.updated_at >= since));
`;

test('a stored review says who wrote it, and fetching one reviewer does not hide another\'s earlier comments', () => {
  const repo = repoWith('measure-reviews', { 'a.txt': 'a\n' });
  sh(repo, 'config', 'lpk.slug', 'acme/app');
  stubBin(join(tmp, 'bin'), 'gh', ghStub);
  assert.equal(lpk(repo, 'reviews', 'fetch', '--reviewer', 'lead').status, 0);
  assert.equal(lpk(repo, 'reviews', 'fetch', '--reviewer', 'other').status, 0);
  const rows = readFileSync(join(ENV.XDG_DATA_HOME, 'lpk', 'reviews', 'acme__app.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.id, r.author]).sort((x, y) => x[0] - y[0]), [[1, 'lead'], [2, 'other'], [9, 'lead']]);
});

test('a review stored before authors were recorded gets its author when its reviewer fetches again', () => {
  const repo = repoWith('measure-legacy', { 'a.txt': 'a\n' });
  sh(repo, 'config', 'lpk.slug', 'acme/app');
  stubBin(join(tmp, 'bin'), 'gh', ghStub);
  const file = join(ENV.XDG_DATA_HOME, 'lpk', 'reviews', 'acme__app.jsonl');
  rmSync(join(ENV.XDG_DATA_HOME, 'lpk', 'reviews'), { recursive: true, force: true });
  mkdirSync(join(ENV.XDG_DATA_HOME, 'lpk', 'reviews'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ id: 1, pr: 7, url: 'u', path: 'a.txt', line: 1, hunk: '', body: 'note 1', at: '2026-10-01T00:00:00Z' })}\n`);
  assert.equal(lpk(repo, 'reviews', 'fetch', '--reviewer', 'lead').status, 0);
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.filter((r) => r.id === 1).map((r) => r.author), ['lead'], 'the one stored row, now with its author');
});
