import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { agent, ENV, lpk, repoWith, sh, tmp, write } from './gates-env.mjs';
import { runDir } from '../lib/where.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const CH = 'mcp__plugin_lpk_chrome-devtools__';
const NEW = { name: `${CH}new_page`, input: { url: 'http://localhost:3000/' } };
const NAV = { name: 'mcp__chrome-devtools__navigate_page', input: { type: 'url', url: 'http://localhost:3000/' } };
const CLICK = { name: `${CH}click`, input: { uid: '1_4' } };
const shot = (p) => ({ name: `${CH}take_screenshot`, input: { pageId: 1, filePath: p } });
const put = (p) => ({ name: 'Write', input: { file_path: p, content: 'seen' } });
const bash = (command) => ({ name: 'Bash', input: { command } });
const owedText = (fx) => { const r = lpk(fx.repo, fx.S, 'reviews', 'owed'); return r.stdout + r.stderr; };
const range = (repo) => `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
const gate = (repo, S, name) => JSON.parse(lpk(repo, S, 'gates', '--json').stdout).find((r) => r.gate === name);
const marker = (repo, S) => join(runDir(repo, S), 'run.json');
const readRun = (repo, S) => JSON.parse(readFileSync(marker(repo, S), 'utf8'));
const patchRun = (repo, S, fn) => { const run = readRun(repo, S); fn(run); writeFileSync(marker(repo, S), JSON.stringify(run)); };
const proofOf = (repo, S) => join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'proof', readRun(repo, S).id);

function begin(name, specs, { files = { 'src/a.mjs': 'export const a = 1;\n' }, edit = 'src/a.mjs', req = [] } = {}) {
  const S = name;
  const repo = repoWith(name, files);
  const args = ['run', 'start', '--lane', 'quick', '--why', 'x', '--verify', 'true', ...req.flatMap((t) => ['--req', t])];
  const flag = (sp, i, withSurface) => [sp.cmd ? '--scenario' : '--judged', sp.cmd || sp.text, ...(withSurface ? ['--surface', sp.surface, '--entry', sp.entry || '/'] : []), ...(sp.proves ? ['--proves', sp.proves] : [])];
  let r = lpk(repo, S, ...args, ...specs.flatMap((sp, i) => flag(sp, i, false)));
  if (r.status !== 0 && /--surface/.test(r.stderr)) r = lpk(repo, S, ...args, ...specs.flatMap((sp, i) => flag(sp, i, true)));
  ok(r);
  patchRun(repo, S, (run) => {
    run.scenarioFrom = 'flags';
    run.scenarios = run.scenarios.map((s, i) => ({ ...s, surface: specs[i].surface, entry: specs[i].entry || '/', ...(specs[i].cmd ? {} : { leaves: 'screenshot' }) }));
  });
  write(repo, edit, 'export const a = 2;\n');
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-qm', 'Change');
  return { S, repo, dir: proofOf(repo, S) };
}

function prover(c, id, calls, lines, startedMs = Date.now() - 60000) {
  const at = (n) => new Date(startedMs + n * 1000).toISOString();
  const so = { name: 'StructuredOutput', input: { findings: [], results: lines } };
  const entries = [{ type: 'user', message: { role: 'user', content: `Prove ${range(c.repo)}.` }, timestamp: at(0) }];
  [...calls, so].forEach(({ refused, ...t }, i) => {
    entries.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, ...t }], stop_reason: 'tool_use' }, timestamp: at(i + 1) });
    if (refused) entries.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: true, content: [{ type: 'text', text: refused }] }] }, timestamp: at(i + 1) });
  });
  agent(join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-scratch', c.S, 'subagents'), id, 'lpk:prover', entries);
}

const png = (c, name, ageSec = 0) => {
  const p = join(c.dir, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 'png bytes');
  if (ageSec) { const t = new Date(Date.now() - ageSec * 1000); utimesSync(p, t, t); }
  return p;
};
const raised = (fx, agentId) => appendFileSync(join(runDir(fx.repo, fx.S), 'findings.jsonl'), `${JSON.stringify({ ev: 'add', time: new Date().toISOString(), finding: { id: `F${agentId}`, run: readRun(fx.repo, fx.S).id, from: 'lpk:prover', agentId, at: range(fx.repo), claim: 'S1 not proved', repro: 'the screen', kind: 'scenario', severity: 'important' } })}\n`);
const refuse = (call, refused) => ({ ...call, refused });
const pass = (id, evidence) => ({ scenario: id, status: 'PASS', evidence });
const UI = { text: 'the owner sees the total', surface: 'ui', entry: '/ after login' };

const cases = [
  { name: 'evidence is empty', calls: () => [NEW, CLICK], lines: () => [pass('S1', [])], why: /evidence/ },
  { name: 'evidence path is in no tool call', calls: (c) => { png(c, 'a.png'); return [NEW, CLICK]; }, lines: (c) => [pass('S1', [join(c.dir, 'a.png')])], why: /no tool call/ },
  { name: 'evidence file is missing', calls: (c) => [NEW, CLICK, shot(join(c.dir, 'gone.png'))], lines: (c) => [pass('S1', [join(c.dir, 'gone.png')])], why: /missing|not a file/ },
  { name: 'evidence file is older than the Prover start', calls: (c) => [NEW, CLICK, shot(png(c, 'old.png', 3600))], lines: (c) => [pass('S1', [join(c.dir, 'old.png')])], why: /older than/ },
  { name: 'screenshot refused by the Prover workspace roots', calls: (c) => [NEW, CLICK, refuse(shot(png(c, 'g.png')), 'the path is outside the allowed workspace roots')], lines: (c) => [pass('S1', [join(c.dir, 'g.png')])], why: /workspace roots/ },
  { name: 'ui scenario with no click', calls: (c) => [NEW, shot(png(c, 'b.png'))], lines: (c) => [pass('S1', [join(c.dir, 'b.png')])], why: /interact|click/ },
  { name: 'ui scenario with no page opened', calls: (c) => [CLICK, shot(png(c, 'c.png'))], lines: (c) => [pass('S1', [join(c.dir, 'c.png')])], why: /page/ },
  { name: 'a Write text file for a ui scenario', calls: (c) => { const p = join(c.dir, 'notes.txt'); mkdirSync(c.dir, { recursive: true }); writeFileSync(p, 'saw it'); return [NEW, CLICK, put(p)]; }, lines: (c) => [pass('S1', [join(c.dir, 'notes.txt')])], why: /screenshot/ },
  { name: 'FM2 evidence is a string', calls: (c) => [NEW, CLICK, shot(png(c, 'd.png'))], lines: (c) => [pass('S1', join(c.dir, 'd.png'))], why: /array/ },
  { name: 'FM3 evidence outside the proof directory', calls: () => { const p = join(tmp, 'outside.png'); writeFileSync(p, 'x'); return [NEW, CLICK, shot(p)]; }, lines: () => [pass('S1', [join(tmp, 'outside.png')])], why: /proof directory/ },
  { name: 'FM3 evidence that is a symlink', calls: (c) => { const target = png(c, 'real.png'); const p = join(c.dir, 'link.png'); symlinkSync(target, p); return [NEW, CLICK, shot(p)]; }, lines: (c) => [pass('S1', [join(c.dir, 'link.png')])], why: /symlink|regular/ },
  { name: 'FM3 evidence only StructuredOutput names', calls: (c) => { png(c, 'e.png'); return [NEW, CLICK, bash('echo done')]; }, lines: (c) => [pass('S1', [join(c.dir, 'e.png')])], why: /no tool call/ },
  { name: 'FM1 no transcript to read', calls: (c) => { png(c, 'f.png'); return []; }, lines: (c) => [pass('S1', [join(c.dir, 'f.png')])], why: /no transcript to read/ },
];
for (const c of cases) {
  test(c.name.startsWith('FM') ? `${c.name.slice(0, 3)} R3 ${c.name.slice(4)}` : `S2 R3 ${c.name}`, () => {
    const fx = begin(`s2-${c.name.replace(/\W+/g, '-')}`, [UI]);
    prover(fx, 'p1', c.calls(fx), c.lines(fx));
    const r = gate(fx.repo, fx.S, 'scenarios');
    assert.equal(r.holds, false, r.why);
    assert.match(r.why, c.why);
  });
}

test('S2 R3 two ui scenarios each need their own click and screenshot, and no shared path', () => {
  let n = 0;
  const two = (calls, lines) => { const fx = begin(`s2-two-${n++}`, [UI, { ...UI, text: 'the owner sees the tax' }]); prover(fx, 'p1', calls(fx), lines(fx)); return gate(fx.repo, fx.S, 'scenarios'); };
  const sharedClick = two((c) => [NEW, CLICK, shot(png(c, 'a.png')), shot(png(c, 'b.png'))], (c) => [pass('S1', [join(c.dir, 'a.png')]), pass('S2', [join(c.dir, 'b.png')])]);
  assert.equal(sharedClick.holds, false);
  assert.match(sharedClick.why, /S2/);
  assert.doesNotMatch(sharedClick.why, /S1 /);
  const sharedPath = two((c) => [NEW, CLICK, shot(png(c, 'a.png')), CLICK], (c) => [pass('S1', [join(c.dir, 'a.png')]), pass('S2', [join(c.dir, 'a.png')])]);
  assert.match(sharedPath.why, /S2.*another scenario/);
  const own = two((c) => [NAV, CLICK, shot(png(c, 'a.png')), CLICK, shot(png(c, 'b.png'))], (c) => [pass('S1', [join(c.dir, 'a.png')]), pass('S2', [join(c.dir, 'b.png')])]);
  assert.equal(own.holds, true, own.why);
});

test('S2 R3 two scenarios named by their text cannot share one path', () => {
  const fx = begin('s2-text', [UI, { ...UI, text: 'the owner sees the tax' }]);
  const a = png(fx, 'a.png');
  prover(fx, 'p1', [NEW, CLICK, shot(a), CLICK], [pass(UI.text, [a]), pass('the owner sees the tax', [a])]);
  const r = gate(fx.repo, fx.S, 'scenarios');
  assert.match(r.why, /another scenario/);
});

test('S3 R4 a newer Prover FAIL with no finding filed yet still keeps scenarios denied over an older PASS', () => {
  const fx = begin('s3-ungraded', [UI]);
  const a = png(fx, 'a.png');
  prover(fx, 'p1', [NEW, CLICK, shot(a)], [pass('S1', [a])], Date.now() - 120000);
  assert.equal(gate(fx.repo, fx.S, 'scenarios').holds, true);
  prover(fx, 'p2', [NEW, CLICK, shot(a)], [{ scenario: 'S1', status: 'FAIL', evidence: [a] }], Date.now() - 30000);
  const r = gate(fx.repo, fx.S, 'scenarios');
  assert.equal(r.holds, false);
  assert.match(r.why, /S1 .*FAIL/);
});

test('S2 R3 new_page, click and a named .png pass, and a docs-only commit after the Prover keeps the PASS', () => {
  const fx = begin('s2-pass', [UI]);
  prover(fx, 'p1', [NEW, CLICK, shot(png(fx, 'total.png'))], [pass('S1', [join(fx.dir, 'total.png')])]);
  assert.equal(gate(fx.repo, fx.S, 'scenarios').holds, true, gate(fx.repo, fx.S, 'scenarios').why);
  write(fx.repo, 'README.md', 'notes\n');
  sh(fx.repo, 'add', '-A'); sh(fx.repo, 'commit', '-qm', 'Docs');
  assert.equal(gate(fx.repo, fx.S, 'scenarios').holds, true);
});

test('S2 R3 a Bash-written file named in a command passes for a non-screen judged scenario', () => {
  const fx = begin('s2-bash', [{ text: 'the doc names the flag', surface: 'docs', entry: 'README.md' }]);
  const p = png(fx, 'grep.txt');
  prover(fx, 'p1', [bash(`grep -n flag README.md > ${p}`)], [pass('S1', [p])]);
  assert.equal(gate(fx.repo, fx.S, 'scenarios').holds, true, gate(fx.repo, fx.S, 'scenarios').why);
});

test('S3 R4 a Prover FAIL line keeps scenarios denied until a later PASS', () => {
  const fx = begin('s3-fail', [UI]);
  const p = png(fx, 'total.png');
  prover(fx, 'p1', [NEW, CLICK, shot(p)], [{ scenario: 'S1', status: 'FAIL', evidence: [p] }], Date.now() - 120000);
  raised(fx, 'p1');
  const r = gate(fx.repo, fx.S, 'scenarios');
  assert.equal(r.holds, false);
  assert.match(r.why, /S1 .*FAIL/);
  const q = png(fx, 'again.png');
  prover(fx, 'p2', [NEW, CLICK, shot(q)], [pass('S1', [q])], Date.now() - 30000);
  assert.equal(gate(fx.repo, fx.S, 'scenarios').holds, true);
});

test('S3 R4 a NOT PROVED line keeps scenarios denied', () => {
  const fx = begin('s3-np', [UI]);
  prover(fx, 'p1', [NEW], [{ scenario: 'S1', status: 'NOT PROVED', evidence: [] }]);
  raised(fx, 'p1');
  assert.match(gate(fx.repo, fx.S, 'scenarios').why, /S1 .*NOT PROVED/);
});

test('S4 R5 a unit test naming R1 does not prove it while a scenario names it and has no PASS', () => {
  const fx = begin('s4-test', [{ ...UI, proves: 'R1' }], { req: ['the owner sees the total'] });
  write(fx.repo, 'tests/a.test.mjs', "// R1\nimport { test } from 'node:test';\ntest('R1 a is 2', () => {});\n");
  sh(fx.repo, 'add', '-A'); sh(fx.repo, 'commit', '-qm', 'Test');
  ok(lpk(fx.repo, fx.S, 'verify'));
  const r = gate(fx.repo, fx.S, 'requirements');
  assert.equal(r.holds, false, r.why);
  assert.match(r.why, /R1 unproved/);
  const p = png(fx, 'total.png');
  prover(fx, 'p1', [NEW, CLICK, shot(p)], [pass('S1', [p])]);
  assert.equal(gate(fx.repo, fx.S, 'requirements').holds, true);
});

test('S5 R6 a small quick diff with a ui scenario, and a README-only diff with a judged docs scenario, owe the prover', () => {
  const ui = begin('s5-ui', [UI], { files: { 'src/App.tsx': 'export const A = 1;\n' }, edit: 'src/App.tsx' });
  assert.match(owedText(ui), /^- prover on /m);
  const docs = begin('s5-docs', [{ text: 'the readme names the flag', surface: 'docs', entry: 'README.md' }], { files: { 'README.md': 'a\n' }, edit: 'README.md' });
  assert.match(owedText(docs), /^- prover on /m);
  const plain = begin('s5-cmd', [{ cmd: 'true', surface: 'cli' }]);
  assert.doesNotMatch(owedText(plain), /prover/);
});

test('R3 R5 a failure row line PASS with empty evidence is NOT PROVED, and a provedBy test still proves its requirement', () => {
  const fx = begin('fm4-rows', [{ ...UI, proves: 'R1' }], { req: ['the owner sees the total', 'a dead store is reported', 'a bad input is refused'] });
  const p = png(fx, 'total.png');
  write(runDir(fx.repo, fx.S), 'brief.json', JSON.stringify({
    requirements: [{ id: 'R1', text: 'total', source: 'x' }, { id: 'R2', text: 'dead store', source: 'x' }, { id: 'R3', text: 'bad input', source: 'x' }],
    scenarios: [{ id: 'S1', text: UI.text, proves: ['R1'] }],
    failures: [{ id: 'FM1', row: 'store dead', proves: ['R2'], provedBy: 'a Prover line' }, { id: 'FM2', row: 'bad input', proves: ['R3'], provedBy: 'tests/a.test.mjs' }],
  }));
  write(fx.repo, 'tests/a.test.mjs', "import { test } from 'node:test';\ntest('R3 bad input refused', () => {});\n");
  sh(fx.repo, 'add', '-A'); sh(fx.repo, 'commit', '-qm', 'Test');
  ok(lpk(fx.repo, fx.S, 'verify'));
  prover(fx, 'p1', [NEW, CLICK, shot(p)], [pass('S1', [p]), { scenario: 'FM1: store dead', status: 'PASS', evidence: '' }]);
  const r = gate(fx.repo, fx.S, 'requirements');
  assert.equal(r.holds, false);
  assert.match(r.why, /R2 unproved/);
  assert.doesNotMatch(r.why, /R1|R3/);
});

test('S1 R9 an old-shape run without surface or entry is denied at scenarios with the way out', () => {
  const fx = begin('s1-old', [UI]);
  patchRun(fx.repo, fx.S, (run) => { run.scenarios = run.scenarios.map(({ surface, entry, leaves, ...s }) => s); });
  const r = gate(fx.repo, fx.S, 'scenarios');
  assert.equal(r.holds, false);
  assert.match(r.why, /surface/);
  assert.match(r.wayOut, /lpk run start .*--surface .*--entry/);
  patchRun(fx.repo, fx.S, (run) => { run.scenarioFrom = 'brief'; });
  assert.match(gate(fx.repo, fx.S, 'scenarios').wayOut, /brief\.json/);
});

test('S6 R7 swapping a scenario after the first list is named by the plan row', () => {
  const fx = begin('s6-swap', [{ cmd: 'true', surface: 'cli' }, UI]);
  patchRun(fx.repo, fx.S, (run) => { run.scenarioLog = [{ at: Date.now(), scenarios: run.scenarios }]; run.scenarios = [{ ...run.scenarios[0], cmd: 'echo swapped' }, run.scenarios[1]]; });
  const r = gate(fx.repo, fx.S, 'plan');
  assert.match(r.why, /S1/);
  assert.doesNotMatch(r.why, /S2/);
});

test('S2 R3 a surface changed from ui to other after a Prover run needs a new Prover run', () => {
  const fx = begin('s2-changed', [UI]);
  prover(fx, 'p1', [NEW, CLICK, shot(png(fx, 'total.png'))], [pass('S1', [join(fx.dir, 'total.png')])]);
  assert.equal(gate(fx.repo, fx.S, 'scenarios').holds, true);
  patchRun(fx.repo, fx.S, (run) => { run.scenarios[0].surface = 'other'; run.scenariosAt = Date.now(); });
  const r = gate(fx.repo, fx.S, 'scenarios');
  assert.equal(r.holds, false);
  assert.match(r.why, /no Prover run/);
});
