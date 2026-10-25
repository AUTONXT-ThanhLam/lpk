// The skill reaches what it names: every step file, agent, workflow and `lpk` command the prompts
// tell an agent to use exists in the plugin, the skill stays short enough to be read whole, and the
// writing rules reach every place lpk writes text a person reads.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'lpk');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const steps = readdirSync(SKILL).filter((f) => f.endsWith('.md'));
const prompts = [
  ...steps.map((f) => [`skills/lpk/${f}`, read('skills', 'lpk', f)]),
  ['skills/learn/SKILL.md', read('skills', 'learn', 'SKILL.md')],
  ...readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => [`agents/${f}`, read('agents', f)]),
  ['README.md', read('README.md')],
];

// The step files SKILL.md sends the session to, by the phrase it uses for them.
const named = (text) => [...text.matchAll(/`([a-z-]+\.md)`\s+in\s+this\s+skill's\s+directory/g)].map((m) => m[1]);

// Commands `bin/lpk` handles itself, and commands that are a module of their own under `lib/cmd`.
const binSource = read('bin', 'lpk');
const inBin = new Set([...binSource.matchAll(/cmd === '([a-z-]+)'/g)].map((m) => m[1]));
const cmdFile = (verb) => join(ROOT, 'lib', 'cmd', `${verb}.mjs`);
const shipped = (verb) => inBin.has(verb) || existsSync(cmdFile(verb));
// The commands the lpk 2.0 plan gives the prompts, each built as `lib/cmd/<verb>.mjs`.
const PLANNED = ['ci', 'cochange', 'doctor', 'escapes', 'fixlines', 'floor', 'gates', 'go', 'handoff', 'meter', 'prove',
  'reap', 'repeat', 'repro', 'report', 'review', 'slot', 'spawn', 'watch'];

// Every `lpk <verb> [<word or --flag>]` a prompt writes in backticks, with the file that writes it.
const uses = prompts.flatMap(([file, text]) => [...text.matchAll(/`lpk ([a-z][a-z-]*)((?: [a-z][a-z-]*| --?[a-z][a-z-]*)?)/g)]
  .map((m) => ({ file, verb: m[1], next: m[2].trim() })));

test('SKILL.md stays short enough to be read whole, and each step file stays within the repo limit', () => {
  const lines = read('skills', 'lpk', 'SKILL.md').split('\n').length;
  assert.ok(lines <= 112, `SKILL.md has ${lines} lines; the cap is 112, and the detail belongs in a step file`);
  for (const f of steps) assert.ok(read('skills', 'lpk', f).split('\n').length <= 150, `skills/lpk/${f} stays within 150 lines`);
});

test('every step file the skill names exists, and every step file is named by SKILL.md', () => {
  for (const [file, text] of prompts) for (const f of named(text)) assert.ok(existsSync(join(SKILL, f)), `${file} names ${f}, which is not in skills/lpk`);
  const fromSkill = new Set(named(read('skills', 'lpk', 'SKILL.md')));
  for (const f of steps.filter((s) => s !== 'SKILL.md')) assert.ok(fromSkill.has(f), `skills/lpk/${f} is never named by SKILL.md, so no run reads it`);
  for (const want of ['understand.md', 'design.md', 'build.md', 'review.md', 'prove.md', 'deliver.md', 'diagnose.md', 'feedback.md', 'slices.md', 'writing.md'])
    assert.ok(fromSkill.has(want), `SKILL.md names ${want}`);
});

test('every agent, workflow, skill and plugin path the prompts name is shipped', () => {
  for (const [file, text] of prompts) {
    for (const [, name] of text.matchAll(/`lpk:([a-z-]+)`/g)) {
      const ok = existsSync(join(ROOT, 'agents', `${name}.md`)) || existsSync(join(ROOT, 'skills', name, 'SKILL.md'))
        || (existsSync(join(ROOT, 'workflows', `${name}.js`)) && read('workflows', `${name}.js`).includes(`name: '${name}'`));
      assert.ok(ok, `${file} names lpk:${name}, which the plugin does not ship`);
    }
    for (const [, p] of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) assert.ok(existsSync(join(ROOT, p)), `${file} points at ${p}`);
  }
});

test('every lpk command the prompts name is one the plan gives them', () => {
  const unknown = uses.filter((u) => !shipped(u.verb) && !PLANNED.includes(u.verb)).map((u) => `${u.file}: lpk ${u.verb}`);
  assert.deepEqual([...new Set(unknown)], [], 'commands neither shipped nor planned');
});

test('every lpk command the prompts name is shipped by the CLI', () => {
  const missing = [...new Set(uses.filter((u) => !shipped(u.verb)).map((u) => u.verb))].sort();
  assert.deepEqual(missing, [], `the prompts name these commands, and lib/cmd/<verb>.mjs does not exist yet: ${missing.join(', ')}`);
});

test('each subcommand and flag the prompts give a shipped command appears in that command\'s code', () => {
  const lib = readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => read('lib', f)).join('\n');
  const absent = [];
  for (const u of uses.filter((x) => x.next && shipped(x.verb))) {
    const source = (existsSync(cmdFile(u.verb)) ? readFileSync(cmdFile(u.verb), 'utf8') : binSource) + lib;
    if (![`'${u.next}'`, `"${u.next}"`, `\`${u.next}\``].some((q) => source.includes(q))) absent.push(`${u.file}: lpk ${u.verb} ${u.next}`);
  }
  assert.deepEqual([...new Set(absent)], []);
});

test('the prompts never ask for the retired hunk-undo run', () => {
  for (const [file, text] of prompts) {
    assert.ok(!text.includes('--hunks'), `${file} still runs lpk mutate --hunks`);
  }
});

test('the writing rules are at most eight and reach every place lpk writes text a person reads', () => {
  const rules = read('skills', 'lpk', 'writing.md').split('\n').filter((l) => /^\d+\. /.test(l));
  assert.ok(rules.length >= 1 && rules.length <= 8, `writing.md holds ${rules.length} rules; the cap is 8`);
  // The brief, commits, findings, the PR body and the report, a bug's commit, and a PR reply.
  for (const f of ['SKILL.md', 'design.md', 'build.md', 'review.md', 'deliver.md', 'diagnose.md', 'feedback.md'])
    assert.ok(named(read('skills', 'lpk', f)).includes('writing.md'), `skills/lpk/${f} points at writing.md`);
  assert.match(read('skills', 'learn', 'SKILL.md'), /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/lpk\/writing\.md/);
});
