// The role table: each agent's effort, and which roles cannot edit. A session started with another
// model must not change who builds or who reviews, so no agent names a model: it inherits the
// session's. A reviewing role must be unable to edit a file even where the plugin's
// hooks do not fire.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');

// The effort the plan settled for each role, by measured results, and whether the role ever edits.
// The model is deliberately absent: an agent that names one runs the same model on a session started
// on another, which is exactly what makes a review depend on who happened to start the session.
const TABLE = {
  architect: { effort: 'high', readOnly: false },
  'design-critic': { effort: 'high', readOnly: true },
  builder: { effort: 'high', readOnly: false },
  techlead: { effort: 'high', readOnly: true },
  'code-reviewer': { effort: 'high', readOnly: true },
  'bug-hunter': { effort: 'high', readOnly: true },
  security: { effort: 'high', readOnly: true },
  verifier: { effort: 'high', readOnly: true },
  regression: { effort: 'medium', readOnly: true },
  claims: { effort: 'medium', readOnly: true },
  ocr: { effort: 'low', readOnly: true },
  a11y: { effort: 'medium', readOnly: true },
  perf: { effort: 'medium', readOnly: true },
  mutant: { effort: 'medium', readOnly: true },
  designer: { effort: 'high', readOnly: false },
  'ui-reviewer': { effort: 'high', readOnly: true },
  prover: { effort: 'high', readOnly: true },
  env: { effort: 'medium', readOnly: false },
  staff: { effort: 'high', readOnly: false },
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

test('no agent names a model, so each inherits the session model, and each names its role effort', () => {
  for (const [name, row] of Object.entries(TABLE)) {
    const fm = agents[name]?.fm;
    assert.ok(fm, `agents/${name}.md exists`);
    assert.equal(fm.name, name, `agents/${name}.md names itself ${name}`);
    assert.ok(!('model' in fm), `agents/${name}.md declares no model: on a session started with another model a declared one would review on it`);
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
const BROWSER = new Set(['a11y', 'designer', 'ui-reviewer', 'prover', 'env', 'perf', 'verifier']);
test('only the roles that drive a browser carry its tools, and no role carries the Artifact tools', () => {
  for (const [name, { fm }] of Object.entries(agents)) {
    const denied = (fm.disallowedTools || '').split(',').map((t) => t.trim());
    for (const tool of ['Artifact', 'ArtifactComments', 'ArtifactData']) assert.ok(denied.includes(tool), `${name} has ${tool} in disallowedTools`);
    assert.equal(denied.includes('mcp__plugin_lpk_chrome-devtools__*'), !BROWSER.has(name), `${name} ${BROWSER.has(name) ? 'keeps' : 'has no'} chrome-devtools`);
  }
});

const DEFERS_TOOLS = new Set(['designer', 'ui-reviewer']);
test('each agent names the tools it carries, because every unused tool is paid for in each of its turns', () => {
  for (const [name, row] of Object.entries(TABLE)) {
    if (DEFERS_TOOLS.has(name)) { assert.ok(!('tools' in agents[name].fm), `${name} loads the Skill tool and the browser: a list would load all 26 browser tools into every turn, while no list defers them behind ToolSearch`); continue; }
    const tools = (agents[name].fm.tools || '').split(',').map((t) => t.trim()).filter(Boolean);
    assert.ok(tools.length > 0, `${name} lists its tools`);
    for (const need of ['Bash', 'Read', 'Grep', 'Glob']) assert.ok(tools.includes(need), `${name} carries ${need}`);
    assert.equal(tools.includes('Edit'), !row.readOnly && !['env'].includes(name), `${name} ${row.readOnly ? 'cannot' : 'can'} edit`);
    assert.equal(tools.some((t) => t.startsWith('mcp__plugin_lpk_chrome-devtools__')), BROWSER.has(name), `${name} browser tools`);
    assert.ok(tools.includes('mcp__plugin_lpk_lpk__*') || !/finding_(add|verdict|list|get|fixed)/.test(agents[name].body), `${name} reaches the ledger tools its body names`);
    assert.ok(tools.every((t) => /^(Bash|Read|Grep|Glob|Write|Edit|Skill|SendMessage|WebFetch|WebSearch|Monitor|mcp__[a-z_-]+__([a-z_]+|\*))$/.test(t)), `${name} names only known tools`);
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

const section = (body, title) => {
  const at = body.indexOf(`\n## ${title}`);
  assert.ok(at >= 0, `a "## ${title}" section exists`);
  const rest = body.slice(at + 1);
  const end = rest.indexOf('\n## ', 1);
  return end < 0 ? rest : rest.slice(0, end);
};
test('the designer who builds a screen and the ui-reviewer who judges it hold the same principles and tells', () => {
  for (const title of ['Principles', 'The generated-UI tells (each one is a finding)']) {
    assert.equal(section(agents['ui-reviewer'].body, title), section(agents.designer.body, title), title);
  }
});
