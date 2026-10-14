// The in-loop hooks of an lpk run. After each edit or command, the literal candidates on lines
// added since the last report go back to the model at once; the main session cannot commit a tree,
// or end a turn on source, that has no green `lpk verify`. Outside a run all are silent.
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, runsGit, siblings, top } from './git.mjs';
import { candidates, changeOf, CODE, envWiring, loadRules, TEST } from './rules.mjs';
import { activeRun, notePrompt, runFor, treeOf, writeRun } from './run.mjs';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'lpk', 'SKILL.md');

// The run of the repo the tool touched, else this session's run wherever it is. `claim` false
// takes only a run this session already holds, never an unbound one.
function runOf(input, claim = true) {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const repo = top(file ? dirname(file) : input.cwd || '.');
  const run = repo && runFor(repo, input.session_id, claim);
  if (run) return { repo, run };
  const other = activeRun(input.session_id, claim, input.cwd);
  return other ? { repo: other.repo, run: other } : {};
}

// A subagent shares the session id, so its tool calls reach this hook too: only the main session
// and a builder (on its own worktree) are handed candidates, since the others cannot fix them.
export function afterTool(input) {
  if (input.agent_id && !/(^|:)builder$/.test(input.agent_type || '')) return null;
  const { repo, run } = runOf(input);
  if (!run) return null;
  const files = changeOf(repo, run.base);
  const found = [
    ...candidates(loadRules(repo), files).map((c) => ({ key: `${c.id}|${c.path}|${c.text.trim()}`, line: `${c.id}  ${c.path}:${c.n}  ${c.text.trim().slice(0, 160)}` })),
    ...envWiring(repo, files, siblings(repo)).filter((e) => !e.seen.length)
      .map((e) => ({ key: `env|${e.name}`, line: `deploy-wiring  ${e.at}  ${e.name} is read here and no deploy file mentions it` })),
  ];
  const seen = new Set(run.seen);
  const fresh = found.filter((f) => !seen.has(f.key));
  if (!fresh.length) return null;
  run.seen = [...seen, ...fresh.map((f) => f.key)];
  writeRun(run);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: [
    'lpk check, on lines you just added (each is a place to look, not a verdict; fix it now, or know the one line that says why it is right):',
    ...fresh.map((f) => `- ${f.line}`),
  ].join('\n') } };
}

// Why the run's current state is not verified, or '' when it is. `key` is the part of the tree
// that must match: `tree` (every file) or `source` (non-test code only).
function unverified(repo, run, key) {
  if (!changeOf(repo, run.base).some((f) => CODE.test(f.path) && !TEST.test(f.path))) return '';
  const now = treeOf(repo)[key];
  const v = run.verified;
  if (v && v[key] === now && v.green) return '';
  return !v ? 'no `lpk verify` has run in this lpk run'
    : v[key] !== now ? `the ${key === 'tree' ? 'files' : 'code'} changed after the last \`lpk verify\``
      : `the last \`lpk verify\` failed: ${v.results.filter((x) => x.exit !== 0).map((x) => `\`${x.cmd}\` exit ${x.exit}`).join(', ')}`;
}

// Test-file edits while reviewers read the frozen commit do not hold the turn; the commit gate
// verifies them before they are committed.
export function beforeStop(input) {
  const { repo, run } = runOf(input);
  const why = run && unverified(repo, run, 'source');
  if (!why) return null;
  return { decision: 'block', reason: `lpk: this change is not verified on the current tree (${why}). Run \`lpk verify\` and fix what it reports. If it cannot go green for a reason outside this change, end the run with \`lpk run end --reason "<why>"\` and say so in the report.` };
}

// After the context is compacted or the session resumes, the run's state comes back to the model.
export function onSessionStart(input) {
  const { repo, run } = runOf(input, false);
  if (!run) return null;
  const v = run.verified;
  const now = treeOf(repo).tree;
  const last = !v ? 'never ran' : `${v.green ? 'green' : 'RED'} on ${v.tree === now ? 'the current tree' : 'an older tree (files changed since)'}`;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [
    `lpk: you are inside an lpk run in ${repo}, started ${new Date(run.started).toISOString()}, base ${run.base.slice(0, 12)}.`,
    `Checks: ${run.verify.map((c) => `\`${c}\``).join(', ')}. Last \`lpk verify\`: ${last}.`,
    ...(existsSync(join(run.marker, '..', 'brief.md')) ? [`Design Brief: ${join(run.marker, '..', 'brief.md')}; read it again before going on.`] : []),
    `Carry on with the lpk skill from the step you were in; re-read ${SKILL} if the summary does not say which. The commit, push and end-of-turn gates stay on until \`lpk run end\`.`,
  ].join('\n') } };
}

// Every message the owner sends during the run is kept verbatim for lpk:learn. What the harness
// submits on its own (a background task's notification) is not the owner's: `source` says so where
// Claude Code sends it, and where it does not, the notification's own tag does.
const OWNER = new Set(['user', 'sdk']);
export function onPrompt(input) {
  const { run } = runOf(input, false);
  const machine = input.source ? !OWNER.has(input.source) : /^\s*<task-notification>/.test(input.prompt ?? '');
  if (run && input.prompt && !machine) notePrompt(run, input.prompt);
  return null;
}

// Each agent writes only where its role allows, so a promise in its prompt holds as a fact: a
// builder only in its own worktree (in a main checkout the git directory is the common one), the
// test author only test files, and the reviewing agents nowhere inside a checkout.
const READ_ONLY = /(^|:)(techlead|claims|verifier|design-critic|prover|mutant|ocr|regression)$/;
export function beforeWrite(input) {
  const type = input.agent_type || '';
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!file || !/(^|:)(builder|test-author)$/.test(type) && !READ_ONLY.test(type)) return null;
  let dir = dirname(file);
  while (dir.length > 1 && !existsSync(dir)) dir = dirname(dir);
  const [repo, gitDir, common] = git(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], dir).trim().split('\n');
  if (!repo) return null;
  const rel = relative(repo, file);
  const why = READ_ONLY.test(type) ? `${type} never edits a checkout, and ${file} is in ${repo}. Write scratch files under /tmp or the cache.`
    : /test-author$/.test(type) ? (CODE.test(rel) && !TEST.test(rel) ? `the test author writes only tests, fixtures and e2e scripts, and ${rel} is production code. Report what the code must provide instead.` : '')
      : gitDir === common ? `a builder writes only in its own worktree, and ${file} is in the main checkout. Create one from the branch head (\`git worktree add -b <branch>-<slice> ../<repo>-<slice> HEAD\`) and write there.` : '';
  return why ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: ${why}` } } : null;
}

// Reviewers read what is committed, so the main session commits only a verified tree. Subagents
// (builders committing in their own worktrees) and a commit of staged test files alone pass.
const BARE_COMMIT = /^\s*(cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*&&\s*)?git(\s+-C\s+("[^"]*"|'[^']*'|\S+))?\s+commit(\s+(-m|--message)(\s+|=)("[^"]*"|'[^']*'|[^\s;&|]+))+\s*$/;
export function beforeCommit(input) {
  const cmd = String(input.tool_input?.command || '');
  if (input.agent_id || !runsGit(cmd, 'commit')) return null;
  // Only the run of the repo being committed in (the last `cd <dir>` or `git -C <dir>` before the
  // commit, else the session's directory): a run elsewhere never gates this repo.
  const before = cmd.slice(0, cmd.search(/\bcommit(?![\w-])/));
  const dirs = [...before.matchAll(/(?:^|[;&|(\s])(?:cd|-C)\s+("([^"]*)"|'([^']*)'|([^\s;&|)]+))/g)].map((m) => m[2] ?? m[3] ?? m[4]);
  const repo = top(resolve(input.cwd || '.', dirs.at(-1) ?? '.'));
  const run = repo && runFor(repo, input.session_id);
  if (!run) return null;
  // Staged tests alone commit only through a bare `git commit -m <msg>`: a pathspec, -a, -i or a
  // `git add` in the same command would commit source the staged list does not show.
  const staged = BARE_COMMIT.test(cmd) ? git(['diff', '--cached', '--name-only'], repo).split('\n').filter(Boolean) : [];
  if (staged.length && staged.every((p) => TEST.test(p) || !CODE.test(p))) return null;
  const why = unverified(repo, run, 'tree');
  if (!why) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: commit refused, the tree is not verified (${why}). Run \`lpk verify\`, fix what it reports, then commit. To commit test files alone (acceptance tests before the code), stage only them, then run exactly \`git commit -m <message>\` with nothing before or after it.` } };
}
