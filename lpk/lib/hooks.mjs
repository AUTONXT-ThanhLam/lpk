// The in-loop hooks of an lpk run. After each edit or command, the literal candidates on lines
// added since the last report, and the tests the change deleted or skipped, go back to the model as
// hints; the end of a turn on unverified source is told, never held; the main session cannot commit
// a tree that has no green `lpk verify`. Outside a run all are silent.
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { allCandidates } from './ast.mjs';
import { commits, git, mergeBase, runsGit, siblings, top } from './git.mjs';
import { MAX_SUBJECT, pushRange } from './push.mjs';
import { changeOf, CODE, envWiring, loadRules, TEST } from './rules.mjs';
import { readRecords } from './records.mjs';
import { activeRun, markerOf, notePrompt, runFor, runState, treeOf, writeRun } from './run.mjs';

export { writeGuard as beforeWrite } from './safety.mjs';
export { resumeCard as onSessionStart } from './card.mjs';

// The run of the repo the tool touched, else this session's run wherever it is. `claim` false
// takes only a run this session already holds, never an unbound one.
export function runOf(input, claim = true) {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const repo = top(file ? dirname(file) : input.cwd || '.');
  const run = repo && runFor(repo, input.session_id, claim);
  if (run) return { repo, run };
  const other = activeRun(input.session_id, claim, input.cwd);
  return other ? { repo: other.repo, run: other } : {};
}

// Whether the call is inside a run, read so that a damaged run file still counts: a run file of the
// repo the session is in, or a live run this session holds.
export function inRun(input) {
  const repo = top(input.cwd || '.');
  if (repo && existsSync(markerOf(repo))) return true;
  try { return Boolean(activeRun(input.session_id, false, input.cwd)); } catch { return false; }
}


// Where the run's change starts: the base it recorded, else where HEAD left its target branch.
export const baseOf = (repo, run) => run.base || (run.target ? mergeBase(repo, run.target) : '');

// The run's records file, through its own module.
export const records = () => import('./records.mjs');

// Test files the change deletes, test lines it removes, and skip or focus markers it adds: each is a
// place where the suite may have stopped checking something. A fixed list, printed as a hint.
export const SKIPS = /\.(skip|only|todo)\(|\b(xit|xdescribe|xtest|fit|fdescribe)\(|@pytest\.mark\.(skip|xfail)|\bpytest\.skip\(|@unittest\.skip|\bt\.Skip(Now|f)?\(|#\[ignore\]|@Ignore\b|@Disabled\b/;
export function testLoss(files) {
  return files.filter((f) => TEST.test(f.path)).flatMap((f) => [
    ...(f.status === 'deleted' ? [{ key: `gone|${f.path}`, line: `test-deleted  ${f.path} is deleted` }]
      : f.removed ? [{ key: `cut|${f.path}|${f.removed}`, line: `test-lines-removed  ${f.path}: ${f.removed} line(s) removed from the base` }] : []),
    ...f.added.filter((a) => SKIPS.test(a.text)).map((a) => ({ key: `skip|${f.path}|${a.text.trim()}`, line: `test-skipped  ${f.path}:${a.n}  ${a.text.trim().slice(0, 160)}` })),
  ]);
}

// The candidates on the change (literal pattern matches, env names no deploy file mentions, and the
// test losses above) that are not in `seen`, the keys of those already reported to this agent.
// Returns the text it reads, at most SHOW of them ('' when none is new), and `seen` with the shown
// ones added, so the rest come back on the next call.
const SHOW = 15;
export function freshCandidates(repo, base, seen = [], sibs = siblings(repo), only) {
  const files = changeOf(repo, base);
  const found = [
    ...allCandidates(repo, loadRules(repo), files, only).cands.map((c) => ({ key: `${c.id}|${c.path}|${c.text.trim()}`, line: `${c.id}  ${c.path}:${c.n}  ${c.text.trim().slice(0, 160)}` })),
    ...envWiring(repo, files, sibs).filter((e) => !e.seen.length)
      .map((e) => ({ key: `env|${e.name}`, line: `deploy-wiring  ${e.at}  ${e.name} is read here and no deploy file mentions it` })),
    ...testLoss(files),
  ];
  const old = new Set(seen);
  const fresh = found.filter((f) => !old.has(f.key));
  const shown = fresh.slice(0, SHOW);
  const text = shown.length ? [
    'lpk check, on lines you just added (each is a place to look, not a verdict; fix it now, or know the one line that says why it is right):',
    ...shown.map((f) => `- ${f.line}`),
    ...(fresh.length > SHOW ? [`${fresh.length - SHOW} more: run lpk check`] : []),
  ].join('\n') : '';
  return { text, seen: [...new Set([...old, ...shown.map((f) => f.key)])] };
}

// A subagent shares the session id, so its tool calls reach this hook too: only the main session
// and a builder (on its own worktree) are handed candidates, since the others cannot fix them.
export function afterTool(input) {
  if (input.agent_id && !/(^|:)(builder|designer)$/.test(input.agent_type || '')) return null;
  const { repo, run } = runOf(input);
  if (!run) return null;
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const edited = file ? [relative(repo, resolve(input.cwd || '.', file))] : undefined;
  const { text, seen } = freshCandidates(repo, baseOf(repo, run), run.seen, siblings(repo), edited);
  if (!text) return null;
  run.seen = seen;
  writeRun(run);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } };
}

// Why the run's current state is not verified, or '' when it is. `key` is the part of the tree
// that must match: `tree` (every file) or `source` (non-test code only).
function unverified(repo, run, key) {
  if (!changeOf(repo, baseOf(repo, run)).some((f) => CODE.test(f.path) && !TEST.test(f.path))) return '';
  const now = treeOf(repo)[key];
  const v = run.verified;
  if (v && v[key] === now && v.green) return '';
  return !v ? 'no `lpk verify` has run in this lpk run'
    : v[key] !== now ? `the ${key === 'tree' ? 'files' : 'code'} changed after the last \`lpk verify\``
      : `the last \`lpk verify\` failed: ${(v.results ?? []).filter((x) => x.exit !== 0).map((x) => `\`${x.cmd}\` exit ${x.exit}`).join(', ')}`;
}

// The end of a turn on source no green verify covers is told, not held: the delivery gates hold at
// handover, and a turn may end to wait for the owner or a background agent. It is said once per
// stop (`stop_hook_active` means this stop already continued on a hook's word), and once per tree
// and reason, so a lead waiting on builders is not woken again until the tree changes.
export function beforeStop(input) {
  if (input.stop_hook_active === true) return null;
  const { repo, run } = runOf(input);
  const why = run && unverified(repo, run, 'source');
  if (!why) return null;
  const told = `${treeOf(repo).tree}|${why}`;
  if (run.stopTold === told) return null;
  run.stopTold = told;
  writeRun(run);
  return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `lpk: this change is not verified on the current tree (${why}). Before it is handed over, run \`lpk verify\` and fix what it reports.` } };
}

const GENERAL = new Set([undefined, '', 'general-purpose', 'claude']);
const refuse = (why) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } });
export function spawnRule(input) {
  if (!/^(Agent|Task)$/.test(input.tool_name || '')) return null;
  const type = input.tool_input?.subagent_type;
  const { repo, run } = runOf(input, false);
  if (!run) return null;
  if (GENERAL.has(type)) return refuse('lpk: this session holds an lpk run, and a general agent works without its rules on the lead\'s model; give the task to `lpk:staff`, or to the lpk agent whose job it is.');
  if (type !== 'lpk:builder' || run.lane !== 'full' || !existsSync(join(dirname(run.marker), 'brief.json')) || readRecords(repo, { run: run.id }).some((r) => r.kind === 'go')) return null;
  return refuse('lpk: no builder before go: this run has a Design Brief but no `lpk go`; end its review, and run `lpk go` when the owner says go.');
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

// Reviewers read what is committed, so the main session commits only a verified tree. Subagents
// (builders committing in their own worktrees) and a commit of staged test files alone pass.
const BARE_COMMIT = /^\s*(cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*&&\s*)?git(\s+-C\s+("[^"]*"|'[^']*'|\S+))?\s+commit(\s+(-m|--message)(\s+|=)("[^"]*"|'[^']*'|[^\s;&|]+))+\s*$/;
export function beforeCommit(input) {
  const cmd = String(input.tool_input?.command || '');
  if (input.agent_id || !runsGit(cmd, 'commit')) return null;
  // Only the run of the repo being committed in (the last `cd <dir>` or `git -C <dir>` before the
  // commit, else the session's directory): a run elsewhere never gates this repo.
  const repo = commitRepo(input);
  const run = repo && runFor(repo, input.session_id);
  // A run file that is there but cannot be read is an error of the gate, not the absence of a run.
  const damaged = !run && repo && runState(repo).error;
  if (damaged) throw new Error(damaged);
  if (!run) return null;
  // The run delivers a branch its target can merge: a commit on the target itself would put the
  // change where the review, the rollback and the PR cannot see it as its own.
  const branch = git(['branch', '--show-current'], repo).trim();
  const target = String(run.target || '').replace(/^origin\//, '');
  if (branch && (branch === target || ['main', 'master'].includes(branch))) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: commit refused, this run delivers a branch and ${branch} is the base it merges into. Create the change's branch first (\`git switch -c <type>/<name>\`), commit there, and \`lpk verify\` there so the run names it.` } };
  }
  // Staged tests alone commit only through a bare `git commit -m <msg>`: a pathspec, -a, -i or a
  // `git add` in the same command would commit source the staged list does not show.
  const staged = BARE_COMMIT.test(cmd) ? git(['diff', '--cached', '--name-only'], repo).split('\n').filter(Boolean) : [];
  if (staged.length && staged.every((p) => TEST.test(p) || !CODE.test(p))) return null;
  const why = unverified(repo, run, 'tree');
  if (!why) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: commit refused, the tree is not verified (${why}). Run \`lpk verify\`, fix what it reports, then commit. To commit staged test files alone, run exactly \`git commit -m <message>\` with nothing before or after it.` } };
}

function commitRepo(input) {
  const cmd = String(input.tool_input?.command || '');
  const before = cmd.slice(0, cmd.search(/\bcommit(?![\w-])/));
  const dirs = [...before.matchAll(/(?:^|[;&|(\s])(?:cd|-C)\s+("([^"]*)"|'([^']*)'|([^\s;&|)]+))/g)].map((m) => m[2] ?? m[3] ?? m[4]);
  return top(resolve(input.cwd || '.', dirs.at(-1) ?? '.'));
}

export function afterCommit(input) {
  if (!runsGit(String(input.tool_input?.command || ''), 'commit')) return null;
  const repo = commitRepo(input);
  const range = repo && pushRange(repo);
  const long = range ? commits(repo, range).filter((c) => c.length > MAX_SUBJECT) : [];
  if (!long.length) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `lpk: a push refuses a commit subject over ${MAX_SUBJECT} characters. Shorten it now, while it is unpushed (\`git commit --amend\` for HEAD):${long.map((c) => `\n- ${c.sha} (${c.length}): "${c.subject}"`).join('')}` } };
}
