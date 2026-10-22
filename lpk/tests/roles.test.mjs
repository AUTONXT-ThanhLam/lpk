// The role table: each agent's model and effort, and which roles cannot edit. A session started
// with another model must not change who builds or who reviews, and a reviewing role must be
// unable to edit a file even where the plugin's hooks do not fire.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');

// The table the plan settled, by measured results: Opus where judgement sets the quality, Sonnet
// where another layer checks the output (building, reviewing, verifying), Haiku for the
// environment. `readOnly` roles never edit.
const TABLE = {
  architect: { model: 'opus', effort: 'high', readOnly: false },
  'design-critic': { model: 'sonnet', effort: 'high', readOnly: true },
  'plan-sim': { model: 'opus', effort: 'high', readOnly: true },
  'plan-trace': { model: 'sonnet', effort: 'high', readOnly: true },
  builder: { model: 'sonnet', effort: 'high', readOnly: false },
  'test-author': { model: 'sonnet', effort: 'high', readOnly: false },
  techlead: { model: 'sonnet', effort: 'high', readOnly: true },
  'bug-hunter': { model: 'sonnet', effort: 'high', readOnly: true },
  security: { model: 'sonnet', effort: 'high', readOnly: true },
  verifier: { model: 'sonnet', effort: 'high', readOnly: true },
  regression: { model: 'sonnet', effort: 'medium', readOnly: true },
  claims: { model: 'sonnet', effort: 'medium', readOnly: true },
  ocr: { model: 'sonnet', effort: 'low', readOnly: true },
  a11y: { model: 'sonnet', effort: 'medium', readOnly: true },
  perf: { model: 'sonnet', effort: 'medium', readOnly: true },
  mutant: { model: 'sonnet', effort: 'medium', readOnly: true },
  designer: { model: 'opus', effort: 'high', readOnly: true },
  prover: { model: 'sonnet', effort: 'high', readOnly: true },
  env: { model: 'haiku', effort: 'medium', readOnly: false },
};

// The frontmatter of an agent file: `key: value` lines between the first two `---` lines.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'an agent file starts with frontmatter');
  return Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([A-Za-z]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
}
const agents = Object.fromEntries(readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => {
  const text = readFileSync(join(AGENTS, f), 'utf8');
  return [f.slice(0, -3), { fm: frontmatter(text), body: text.replace(/^---\n[\s\S]*?\n---\n/, '') }];
}));

test('every agent the plugin ships has a row in the role table, and every row has an agent', () => {
  assert.deepEqual(Object.keys(agents).sort(), Object.keys(TABLE).sort());
});

test('each agent runs on the model and effort its role was given', () => {
  for (const [name, row] of Object.entries(TABLE)) {
    const fm = agents[name]?.fm;
    assert.ok(fm, `agents/${name}.md exists`);
    assert.equal(fm.name, name, `agents/${name}.md names itself ${name}`);
    assert.equal(fm.model, row.model, `${name} runs on ${row.model}`);
    assert.equal(fm.effort, row.effort, `${name} runs at effort ${row.effort}`);
  }
});

test('the reviewing roles cannot edit files, and the roles that write code or tests can', () => {
  for (const [name, row] of Object.entries(TABLE)) {
    const denied = (agents[name]?.fm.disallowedTools || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (row.readOnly) for (const tool of ['Edit', 'NotebookEdit']) assert.ok(denied.includes(tool), `${name} has ${tool} in disallowedTools`);
    else assert.ok(!denied.includes('Edit'), `${name} must be able to edit`);
  }
});

// The roles that drive the lpk Chrome, the verifier among them because it reproduces what the
// browser lenses saw on a page. Every other role carries no browser tool definitions, and no role
// publishes a page, so none carries the Artifact tools.
const BROWSER = new Set(['a11y', 'designer', 'prover', 'env', 'perf', 'verifier']);
test('only the roles that drive a browser carry its tools, and no role carries the Artifact tools', () => {
  for (const [name, { fm }] of Object.entries(agents)) {
    const denied = (fm.disallowedTools || '').split(',').map((t) => t.trim());
    for (const tool of ['Artifact', 'ArtifactComments', 'ArtifactData']) assert.ok(denied.includes(tool), `${name} has ${tool} in disallowedTools`);
    assert.equal(denied.includes('mcp__plugin_lpk_chrome-devtools__*'), !BROWSER.has(name), `${name} ${BROWSER.has(name) ? 'keeps' : 'has no'} chrome-devtools`);
  }
});

test('every agent ends with a short report section, so its reply has a fixed shape', () => {
  for (const [name, { body }] of Object.entries(agents)) {
    const at = body.lastIndexOf('\n## Report\n');
    assert.ok(at >= 0, `${name} has a "## Report" section`);
    assert.ok(!body.slice(at + 1).includes('\n## '), `${name}'s report section is its last section`);
    assert.ok(body.slice(at).split('\n').length <= 20, `${name}'s report section stays within 20 lines`);
  }
});
