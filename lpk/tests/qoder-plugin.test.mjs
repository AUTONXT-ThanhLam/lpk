// lpk on Qoder: the two manifests, the host-neutral hooks.json and the marketplace entry, read as
// they are shipped. Each case holds one artifact to a fact measured from the installed Qoder runtime
// and docs.qoder.com/cli/plugins-reference.md + /cli/hooks-reference.md, so a drift fails here first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WS = join(ROOT, '..');
const QODER_MANIFEST = join(ROOT, '.qoder-plugin', 'plugin.json');
const CLAUDE_MANIFEST = join(ROOT, '.claude-plugin', 'plugin.json');
const HOOKS = join(ROOT, 'hooks', 'hooks.json');
const MARKETPLACE = join(WS, '.claude-plugin', 'marketplace.json');

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const rel = (p) => p.replace(ROOT + '/', 'lpk/');

// Tools each host has. Qoder's set was read off this machine: every name below appears as a quoted
// tool name in /opt/Qoder/resources/app.asar.unpacked/node_modules/@qoder-ai/qoder-agent-sdk/dist/
// _worker/qoder-worker-runtime.obf.mjs, while MultiEdit / Artifact / ArtifactComments / ArtifactData
// return zero hits there (Claude Code has them, Qoder does not).
const BOTH = ['Bash', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'Task', 'Agent', 'AskUserQuestion', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite'];
const CLAUDE_ONLY = ['MultiEdit', 'Artifact', 'ArtifactComments', 'ArtifactData'];
const QODER_ONLY = ['SearchWorkspace', 'SearchKnowledge', 'mcp_call', 'query_mcp', 'manage_mcp', 'present_visualization', 'load_workspace_dependencies', 'ImageGen'];

// Hook events and per-hook fields the Qoder loader reads (hooks-reference.md).
const EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Notification', 'PermissionRequest', 'PermissionDenied', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'ConfigChange', 'Setup', 'Elicitation', 'ElicitationResult'];
const HOOK_FIELDS = ['type', 'command', 'args', 'shell', 'timeout', 'async', 'asyncRewake', 'rewakeMessage', 'statusMessage', 'env', 'once', 'matcher', 'sequential', 'if'];
const HOOK_TYPES = ['command', 'http', 'prompt', 'agent'];
// Manifest keys Qoder reads: name required; the rest optional or component keys
// (plugins-reference.md). `logo` is allowed because the manifest shipped inside the installed runtime
// (…/vendor/qoder-security/.qoder-plugin/plugin.json) declares it.
const MANIFEST_KEYS = ['name', 'version', 'displayName', 'description', 'descriptionZh', 'author', 'homepage', 'repository', 'license', 'keywords', 'category', 'tags', 'dependencies', 'commands', 'agents', 'skills', 'outputStyles', 'workflowsPath', 'workflowsPaths', 'hooks', 'mcpServers', 'settings', 'logo'];
const COMPONENT_KEYS = ['commands', 'agents', 'skills', 'outputStyles', 'workflowsPath', 'workflowsPaths', 'hooks', 'mcpServers'];
// Events whose matcher is a tool name. SessionStart matches a source, SubagentStart an agent type.
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'];

// The matcher is alternation at the top level, with `|` inside a group belonging to that group.
function alternatives(matcher) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of matcher) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const isToolName = (alt) => /^[A-Za-z][A-Za-z0-9_]*$/.test(alt);
// Which hook.mjs verb, or which `lpk` subcommand, a command runs.
const verbOf = (command) => command.match(/hook\.mjs" ([a-z-]+)/)?.[1] ?? command.match(/bin\/lpk" ([a-z-]+)/)?.[1] ?? command;
// tool_name matchers, as [event, verb, matcher] so a failure names the shipped entry.
function toolMatchers(hooks) {
  return Object.entries(hooks.hooks).flatMap(([event, entries]) => entries
    .filter((e) => TOOL_EVENTS.includes(event) && e.matcher)
    .map((e) => [event, verbOf(e.hooks[0].command), e.matcher]));
}

// Qoder qualifies a plugin's MCP tools the way Claude Code does: mcp__plugin_<PluginName>_<serverName>__
// <tool> (on this machine: mcp__plugin_Presentations_office__begin_deck). Each part is passed through
// the runtime's name sanitiser, which keeps [A-Za-z0-9_-] and collapses runs of `_`.
const sanitize = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
const mcpToolName = (plugin, server, tool) => `mcp__plugin_${sanitize(plugin)}_${sanitize(server)}__${tool}`;

const SECURE_KEY = /(secret|token|password|passwd|credential|api[-_ ]?key|apikey|access[-_ ]?key|private[-_ ]?key|authorization|cookie|bearer|webhook|session[-_ ]?id)/i;
const SECURE_VALUE = /(Bearer\s|\bsk-[A-Za-z0-9]{8,}\b|\bghp_[A-Za-z0-9]{8,}\b|\bgh[ours]_[A-Za-z0-9]{8,}\b|xox[abps]-|\bAKIA[0-9A-Z]{16}\b|-----BEGIN|:\w+@[\w.-]+\/|Authorization\s*:)/;
function scanLeaves(node, path = '', found = []) {
  if (typeof node === 'string') { if (SECURE_VALUE.test(node)) found.push(`${path} value`); return found; }
  if (Array.isArray(node)) { node.forEach((v, i) => scanLeaves(v, `${path}[${i}]`, found)); return found; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { if (SECURE_KEY.test(k)) found.push(`${path}.${k} key`); scanLeaves(v, `${path}.${k}`, found); }
  }
  return found;
}

// `${CLAUDE_PLUGIN_ROOT}` is substituted by both hosts; the pairs QODER_/CLAUDE_ are equivalent here.
const ROOT_PATHS = /\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g;
const allEntries = (hooks) => Object.entries(hooks.hooks).flatMap(([event, entries]) => entries.map((e) => ({ event, entry: e, hooks: e.hooks })));
// The matcher of the entry running `hook.mjs <verb>`, so a moved entry fails with its own name.
function matcherOf(event, verb) {
  const entry = json(HOOKS).hooks[event]?.find((e) => new RegExp(`hook\\.mjs" ${verb}$`).test(e.hooks[0].command.trim()));
  assert.ok(entry, `hooks.json has no ${event} entry running \`hook ${verb}\``);
  assert.equal(typeof entry.matcher, 'string', `the ${event} \`hook ${verb}\` entry has no matcher`);
  return entry.matcher;
}

test('both plugin manifests ship, and Qoder reads .qoder-plugin before .claude-plugin', () => {
  for (const [label, file] of [['.qoder-plugin/plugin.json', QODER_MANIFEST], ['.claude-plugin/plugin.json', CLAUDE_MANIFEST]]) {
    assert.ok(existsSync(file), `${rel(file)}: ${label} must exist so the plugin name does not fall back to the directory name`);
    assert.equal(typeof json(file), 'object', `${label} must parse as a JSON object`);
  }
});

test('the Qoder manifest carries the same name and version as the Claude one', () => {
  const q = json(QODER_MANIFEST), c = json(CLAUDE_MANIFEST);
  assert.equal(q.name, c.name, 'name differs between .qoder-plugin and .claude-plugin');
  assert.equal(q.version, c.version, 'version differs between .qoder-plugin and .claude-plugin');
  assert.equal(q.name, 'lpk', 'the manifest name is the <PluginName> baked into every mcp__plugin_lpk_ matcher');
  assert.equal(q.name, basename(ROOT), 'the manifest name must equal the plugin directory name on both hosts');
  assert.match(q.version, /^\d+\.\d+\.\d+$/, `${q.version} is not a semver`);
});

test('and the same description, author and license, so neither host shows a different card', () => {
  const q = json(QODER_MANIFEST), c = json(CLAUDE_MANIFEST);
  for (const key of ['description', 'author', 'license']) {
    assert.deepEqual(q[key], c[key], `${key} differs between the two manifests`);
  }
});

test('the Qoder manifest uses only keys the Qoder loader reads', () => {
  const q = json(QODER_MANIFEST);
  const unknown = Object.keys(q).filter((k) => !MANIFEST_KEYS.includes(k));
  assert.deepEqual(unknown, [], `${rel(QODER_MANIFEST)} declares keys Qoder ignores: ${unknown.join(', ')}`);
  if (q.settings !== undefined) assert.deepEqual(Object.keys(q.settings), ['agent'], 'Qoder honours only settings.agent');
});

test('every component path the manifest declares exists on disk', () => {
  const q = json(QODER_MANIFEST);
  for (const key of COMPONENT_KEYS) {
    const value = q[key];
    if (value === undefined) continue;
    for (const p of Array.isArray(value) ? value : [value]) {
      assert.equal(typeof p, 'string', `${key} must name a path or a list of paths, got ${JSON.stringify(p)}`);
      assert.ok(existsSync(join(ROOT, p.replace(/^\.\//, ''))), `${key} points at ${p}, which is not in the plugin`);
    }
  }
});

test('the conventional dirs Qoder auto-discovers are all present, so the manifest needs no component keys', () => {
  for (const p of ['agents', 'skills', join('hooks', 'hooks.json'), 'workflows', 'bin', '.mcp.json']) {
    assert.ok(existsSync(join(ROOT, p)), `${rel(join(ROOT, p))} is missing: the loader would stop finding it by convention`);
  }
  const q = json(QODER_MANIFEST);
  for (const key of ['hooks', 'mcpServers']) {
    assert.equal(q[key], undefined, `${key} already resolves by conventional path; declaring it only adds a way to drift`);
  }
});

test('only .mcp.json is present, since Qoder does not merge it with a sibling mcp.json', () => {
  assert.ok(existsSync(join(ROOT, '.mcp.json')), 'lpk/.mcp.json carries the chrome-devtools and lpk servers');
  assert.ok(!existsSync(join(ROOT, 'mcp.json')), 'lpk/mcp.json also exists: Qoder would load .mcp.json and silently drop it');
});

test('no manifest, nor the hooks file, carries a secret-looking field', () => {
  for (const file of [QODER_MANIFEST, CLAUDE_MANIFEST, MARKETPLACE, HOOKS]) {
    assert.deepEqual(scanLeaves(json(file)), [], `${rel(file)} has credential-looking content`);
  }
});

test('hooks.json parses and registers only events Qoder documents', () => {
  const hooks = json(HOOKS);
  assert.ok(hooks.hooks && typeof hooks.hooks === 'object', 'the file must wrap the hooks in a "hooks" group, as settings.json does');
  const unknown = Object.keys(hooks.hooks).filter((e) => !EVENTS.includes(e));
  assert.deepEqual(unknown, [], `${rel(HOOKS)} registers events Qoder does not list: ${unknown.join(', ')}`);
  for (const [event, entries] of Object.entries(hooks.hooks)) {
    assert.ok(Array.isArray(entries) && entries.length, `${event} must map to a list of entries`);
    for (const entry of entries) assert.ok(Array.isArray(entry.hooks) && entry.hooks.length, `${event} entry must carry a hooks list`);
  }
});

test('every hook uses a type Qoder accepts', () => {
  for (const { event, hooks } of allEntries(json(HOOKS))) {
    for (const hook of hooks) assert.ok(HOOK_TYPES.includes(hook.type), `${event}: hook type ${JSON.stringify(hook.type)} is not one of ${HOOK_TYPES.join('|')}`);
  }
});

test('every hook field is one the Qoder loader reads', () => {
  for (const { event, entry, hooks } of allEntries(json(HOOKS))) {
    assert.deepEqual(Object.keys(entry).filter((k) => !['matcher', 'hooks'].includes(k)), [], `${event}: the entry itself carries unknown keys`);
    for (const hook of hooks) {
      const unknown = Object.keys(hook).filter((k) => !HOOK_FIELDS.includes(k));
      assert.deepEqual(unknown, [], `${event}: unknown hook fields ${unknown.join(', ')} would not reach the loader`);
    }
  }
});

test('every hook keeps a timeout', () => {
  for (const { event, hooks } of allEntries(json(HOOKS))) {
    for (const hook of hooks) {
      assert.equal(typeof hook.timeout, 'number', `${event} ${JSON.stringify(hook.command).slice(0, 60)}: no timeout, so a slow host kills it on the default`);
      assert.ok(hook.timeout > 0 && hook.timeout <= 600, `${event}: timeout ${hook.timeout} is out of range`);
    }
  }
});

test('every command resolves to a file that exists once ${CLAUDE_PLUGIN_ROOT} is substituted', () => {
  for (const { event, hooks } of allEntries(json(HOOKS))) {
    for (const hook of hooks) {
      const paths = [...hook.command.matchAll(ROOT_PATHS)].map((m) => m[1]);
      assert.ok(paths.length, `${event}: ${JSON.stringify(hook.command).slice(0, 60)} reaches no file of the plugin, so which root does it trust?`);
      for (const p of paths) assert.ok(existsSync(join(ROOT, p)), `${event}: ${rel(join(ROOT, p))} does not exist`);
    }
  }
});

test('commands keep ${CLAUDE_PLUGIN_ROOT}, which both hosts substitute, and no host-specific root', () => {
  for (const { event, hooks } of allEntries(json(HOOKS))) {
    for (const hook of hooks) {
      const roots = [...new Set([...hook.command.matchAll(/\$\{[A-Za-z_]*PLUGIN_ROOT\}/g)].map((m) => m[0]))];
      assert.deepEqual(roots, ['${CLAUDE_PLUGIN_ROOT}'], `${event}: ${roots.join(', ')} - only CLAUDE_PLUGIN_ROOT is substituted by both hosts`);
      assert.ok(!/\/home\/|\/Users\/|[A-Z]:\\/.test(hook.command), `${event}: a command pins a machine's path`);
    }
  }
});

test('plugin scripts run through node on PATH or the host runtime placeholder, never a pinned binary', () => {
  for (const { event, hooks } of allEntries(json(HOOKS))) {
    for (const hook of hooks) {
      for (const m of hook.command.matchAll(/(\S+)\s+"?\$\{CLAUDE_PLUGIN_ROOT\}/g)) {
        assert.ok(['node', '${QODER_NODE_RUNTIME}'].includes(m[1]), `${event}: ${m[1]} launches a plugin script; only node from the session PATH, or the host runtime placeholder, may`);
      }
    }
  }
});

test('no matcher names a tool that neither host has', () => {
  for (const [event, verb, matcher] of toolMatchers(json(HOOKS))) {
    for (const alt of alternatives(matcher)) {
      if (!isToolName(alt)) { assert.match(alt, /^mcp__/, `${event} (${verb}): matcher part ${JSON.stringify(alt)} is neither a tool name nor an MCP tool pattern`); continue; }
      assert.ok([...BOTH, ...CLAUDE_ONLY, ...QODER_ONLY].includes(alt), `${event} (${verb}): ${alt} is not a tool either host offers`);
    }
  }
});

test('the tool matchers stay host-neutral: every tool they name exists on both hosts', () => {
  for (const [event, verb, matcher] of toolMatchers(json(HOOKS))) {
    for (const alt of alternatives(matcher)) {
      if (!isToolName(alt)) continue;
      assert.ok(BOTH.includes(alt), `${event} (${verb}): ${alt} is host-only (${CLAUDE_ONLY.includes(alt) ? 'Claude Code has it, Qoder does not' : 'not in the Qoder tool set'}), so it must not be matched`);
    }
  }
});

test('the matchers still reach every tool both hosts do have', () => {
  const pre = matcherOf('PreToolUse', 'pre');
  const post = matcherOf('PostToolUse', 'post');
  for (const tool of ['Bash', 'Read', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'Task']) {
    assert.match(tool, new RegExp(`^(${pre})$`), `the pre matcher must reach ${tool}`);
  }
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash']) {
    assert.match(tool, new RegExp(`^(${post})$`), `the post matcher must reach the writing tool ${tool}`);
  }
  assert.ok(!/MultiEdit/.test(json(HOOKS).hooks.PostToolUse.map((e) => e.matcher ?? '').join('|')), 'a PostToolUse matcher still names MultiEdit, which Qoder never calls');
  assert.match('AskUserQuestion', new RegExp(`^(${matcherOf('PostToolUse', 'waive')})$`));
});

test('Qoder names the lpk MCP tools exactly as the stamp matcher expects', () => {
  const name = json(QODER_MANIFEST).name;
  const servers = Object.keys(json(join(ROOT, '.mcp.json')).mcpServers);
  assert.deepEqual(servers.sort(), ['chrome-devtools', 'lpk'], 'the server names are half of every MCP tool matcher');
  // The `name:` of each entry of the TOOLS array in mcp/lpk.mjs, not the serverInfo name.
  const tools = [...readFileSync(join(ROOT, 'mcp', 'lpk.mjs'), 'utf8').matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].map((m) => m[1]);
  assert.ok(tools.length >= 5 && tools.every((t) => /^finding_/.test(t)), `mcp/lpk.mjs exposes ${tools.join(', ')}`);
  const matcher = matcherOf('PreToolUse', 'stamp');
  for (const tool of tools) {
    const fqn = mcpToolName(name, 'lpk', tool);
    assert.match(fqn, new RegExp(`^(${matcher})$`), `${fqn} is what Qoder calls the tool; the stamp matcher ${matcher} would miss it`);
  }
});

test('a hyphen in a server name survives the MCP name the matcher is written against', () => {
  const name = json(QODER_MANIFEST).name;
  assert.equal(sanitize('chrome-devtools'), 'chrome-devtools', 'the sanitiser keeps `-`, so the matcher cannot be rewritten to chrome_devtools');
  const matcher = matcherOf('PreToolUse', 'pre');
  for (const tool of ['navigate_page', 'new_page']) {
    const fqn = mcpToolName(name, 'chrome-devtools', tool);
    assert.match(fqn, new RegExp(`^(${matcher})$`), `${fqn} must be gated by the pre hook`);
  }
  const prefix = `mcp__plugin_${sanitize(name)}_`;
  for (const m of [...json(HOOKS).hooks.PreToolUse, ...json(HOOKS).hooks.PostToolUse]) {
    if (m.matcher?.includes('plugin_')) assert.ok(m.matcher.startsWith(prefix) || m.matcher.includes(prefix), `${m.matcher} hardcodes a plugin name other than ${name}`);
  }
});

test('connector tools stay matched through a host-neutral mcp__ pattern, not a hardcoded server path', () => {
  const pre = matcherOf('PreToolUse', 'pre');
  for (const tool of ['mcp__atlassian__editJiraIssue', 'mcp__plugin_lpk_atlassian__createConfluencePage', 'mcp__jira__executeWrite']) {
    assert.match(tool, new RegExp(`^(${pre})$`), `${tool} writes outside the repo and must be gated on either host`);
  }
});

test('SessionStart matchers name sources and the SubagentStart matcher names lpk agents', () => {
  const hooks = json(HOOKS);
  const starts = hooks.hooks.SessionStart.map((e) => e.matcher);
  for (const m of starts) {
    for (const alt of alternatives(m)) assert.ok(['startup', 'resume', 'clear', 'compact'].includes(alt), `SessionStart matcher ${JSON.stringify(m)} names ${alt}, not a session source`);
  }
  const agentMatcher = hooks.hooks.SubagentStart[0].matcher;
  for (const file of readdirSync(join(ROOT, 'agents'))) {
    const agentType = `lpk:${basename(file, '.md')}`;
    assert.match(agentType, new RegExp(`^(${agentMatcher})$`), `agent ${agentType} would start without its card`);
  }
});

test('every hook that reads a live run stays inert when there is none, exiting 0', () => {
  const GUARD = '[ -n "$(ls -A "${XDG_STATE_HOME:-$HOME/.local/state}/lpk/active" 2>/dev/null)" ] || exit 0';
  // pre, stamp, trim and subject answer on their own; push-check reads stdin; setup installs gitleaks.
  const exempt = ['pre', 'stamp', 'trim', 'subject', 'push-check', 'setup'];
  for (const { event, hook } of allEntries(json(HOOKS)).flatMap(({ event, hooks }) => hooks.map((h) => ({ event, hook: h })))) {
    const verb = verbOf(hook.command);
    if (exempt.includes(verb)) { assert.ok(!hook.command.includes(GUARD), `${event}: ${verb} guards and reads the run dir twice`); continue; }
    assert.ok(hook.command.startsWith(GUARD), `${event}: the ${verb} hook must open with the inertness guard ${JSON.stringify(GUARD)}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'lpk-qoder-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));
  mkdirSync(join(scratch, 'state'), { recursive: true });
  writeFileSync(join(scratch, 'state', 'empty'), '');
  const guarded = allEntries(json(HOOKS)).flatMap((e) => e.hooks).find((h) => /hook\.mjs" stop/.test(h.command));
  const p = spawnSync('bash', ['-c', guarded.command], { cwd: scratch, env: { ...process.env, HOME: scratch, XDG_STATE_HOME: join(scratch, 'state'), CLAUDE_PLUGIN_ROOT: ROOT }, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'none', cwd: scratch }) });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stdout, '', 'with an empty run dir the hook printed, so a Qoder session without lpk would be interrupted');
});

test('the commit hooks keep their if condition, and only they carry one', () => {
  const hooks = json(HOOKS);
  const withIf = allEntries(hooks).flatMap(({ event, hooks: list }) => list.map((h) => [event, h])).filter(([, h]) => h.if !== undefined);
  assert.equal(withIf.length, 2, `expected the two commit hooks to carry an if, found ${withIf.length}`);
  for (const [event, h] of withIf) {
    assert.equal(h.if, 'Bash(git *commit*)', `${event}: the commit gate's if drifted to ${JSON.stringify(h.if)}`);
    assert.match(h.command, /hook\.mjs" (commit|subject)/, `${event}: an if on ${JSON.stringify(h.command).slice(0, 50)} is not the commit hook's`);
  }
});

test('the marketplace still lists every plugin of the repo at its existing source', () => {
  const market = json(MARKETPLACE);
  assert.deepEqual(market.plugins.map((p) => p.name), ['lpk', 'drawio', 'lpk-mod'], 'a Claude entry was dropped or reordered');
  assert.deepEqual(market.plugins.map((p) => p.source), ['./lpk', './draw', './lpk-mod'], 'a source moved, so the marketplace install breaks');
  for (const p of market.plugins) assert.ok(existsSync(join(WS, p.source)), `${p.source} does not exist`);
});

test('the lpk marketplace entry claims no dependency on a particular CLI', () => {
  const entry = json(MARKETPLACE).plugins.find((p) => p.name === 'lpk');
  assert.ok(!/claude|codex|gemini|cursor/i.test(entry.description), 'the lpk description names an assistant CLI as a dependency');
  const slashed = entry.description.match(/(^|[\s(,])\/[a-z][\w-]*/g) ?? [];
  assert.deepEqual(slashed, [], `the description lists slash commands, which only exist on one host: ${slashed.join(' ')}`);
  assert.ok(/installs?|loads?/i.test(entry.description), 'the entry should say how it loads on a host');
});

test('and names its review lenses by role, each one a shipped agent', () => {
  const entry = json(MARKETPLACE).plugins.find((p) => p.name === 'lpk');
  const roles = { architect: 'architect', 'design critic': 'design-critic', verifier: 'verifier', security: 'security', performance: 'perf', accessibility: 'a11y', regression: 'regression', 'bug hunt': 'bug-hunter' };
  const agents = readdirSync(join(ROOT, 'agents')).map((f) => basename(f, '.md'));
  for (const [phrase, file] of Object.entries(roles)) {
    assert.match(entry.description.toLowerCase(), new RegExp(phrase.replace(/[ *-]/g, '[ -]?')), `the description no longer names the ${phrase} lens`);
    assert.ok(agents.includes(file), `lpk/agents/${file}.md, which the ${phrase} lens is, is gone`);
  }
  assert.ok(existsSync(QODER_MANIFEST) && existsSync(CLAUDE_MANIFEST), `${entry.source} must hold a manifest for each host`);
});
