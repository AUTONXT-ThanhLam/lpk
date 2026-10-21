// PreToolUse hook on Bash. Every push keeps today's checks: a PR title over the subject bound, merge
// commits, subjects CI rejects, committed secrets. On the branch of an lpk run (any session, also
// after `lpk run end`), the delivery gates act at handover: `gh pr create` without --draft/-d,
// `gh pr ready`, a `gh api` call naming ready_for_review or markPullRequestReadyForReview, and any
// push to a branch the run already handed over. Before handover a push of the run's branch needs a
// green verify of its code, and either the gates holding or the owner's grant of draft pushes.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { commits, defaultBranch, git, runsGit, top } from './git.mjs';
import { failing, gates } from './gates.mjs';
import { handover, pushedBranches, readyBranch } from './handover.mjs';
import { appendRecord, readRecords, waived } from './records.mjs';
import { endedRuns, markerOf, readRun, runForBranch } from './run.mjs';
import { codeOfCommit } from './tree.mjs';
import { gitleaks } from './tools.mjs';

export const MAX_SUBJECT = 72;

// The commits a push would publish: what the upstream lacks, else what the default branch lacks.
export function pushRange(repo) {
  const up = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repo).trim();
  if (up) return `${up}..HEAD`;
  const def = defaultBranch(repo);
  return def ? `${def}..HEAD` : '';
}

export function problems(repo, range) {
  const out = [];
  for (const c of commits(repo, range)) {
    if (c.length > MAX_SUBJECT) out.push(`${c.sha} subject is ${c.length} characters (max ${MAX_SUBJECT}): "${c.subject}"`);
    if (/\\n/.test(c.subject)) out.push(`${c.sha} subject holds a literal \\n: "${c.subject}"`);
    if (c.merge) out.push(`${c.sha} is a merge commit; rebase onto the target branch instead (linear history)`);
  }
  const [from] = range.split('..');
  const bin = gitleaks();
  const gl = bin ? spawnSync(bin, ['git', '--no-banner', '--log-opts', `${from}..HEAD`, '--exit-code', '3', '--redact', '--report-format', 'json', '--report-path', '-'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }) : {};
  if (gl.status === 3) {
    let found = [];
    try { found = JSON.parse(gl.stdout); } catch { /* the count below still says a secret was found */ }
    out.push(`gitleaks found ${found.length || 'a'} secret(s) in ${range}:${found.slice(0, 12).map((f) => `\n  ${String(f.Commit).slice(0, 12)} ${f.File}:${f.StartLine} ${f.RuleID}`).join('')}`);
  }
  return out;
}

// Only the plain forms `git push ...` and `git -C <dir> push ...` say for certain which repo is
// pushed; any other form is refused with the way to run it, rather than guessed at.
const PLAIN_PUSH = /^\s*git(\s+-C\s+("([^"]*)"|'([^']*)'|([^\s"';&|`$()]+)))?\s+push\b[^;&|`$()\n]*$/;
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const WAIVE = 'The owner can let the calls this gate cannot decide through for the rest of the open run: the waiver question with an option labelled `gate:error`, or /lpk-waive gate:error.';

// A PR title becomes the squash commit's subject on the default branch, so it is held to the same
// bound. Only a title passed literally to a command that starts `gh pr create|edit` is measured.
function prTitle(cmd) {
  const args = [...cmd.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/g)].map((m) => ({ text: m[1] ?? m[2] ?? m[3], bare: m[3] !== undefined }));
  if (args.length < 3 || args[0].text !== 'gh' || args[1].text !== 'pr' || !/^(create|edit)$/.test(args[2].text)) return null;
  for (let i = 3; i < args.length; i++) {
    const a = args[i];
    if (a.bare && /^(&&|\|\|?|;|&)$/.test(a.text)) return null;
    if (a.bare && /^(--title|-t)$/.test(a.text)) return args[i + 1]?.text ?? null;
    if (a.bare && a.text.startsWith('--title=')) return a.text.slice(8) || args[i + 1]?.text || null;
  }
  return null;
}

// The rows that do not hold, as one deny, or null when the gates hold.
async function gated(repo, run, what, { ci }) {
  const rows = await gates(repo, run, { ci });
  const bad = failing(rows);
  if (!bad.length) return null;
  return deny(`lpk: ${what} on ${run.branch || 'this branch'} is refused: the delivery gates of run ${run.id} do not hold.\n${bad.map((r) => `- ${r.gate}: ${r.why}${r.wayOut ? ` → ${r.wayOut}` : ''}`).join('\n')}\n\`lpk gates\` shows what each read.`);
}

// Whether this repo has a run, open, damaged or ended: only then do the gates act in it.
const hasRuns = (repo) => existsSync(markerOf(repo)) || endedRuns(repo).length > 0;
const handedOver = (repo, run, branch) => readRecords(repo, { run: run.id }).some((r) => r.kind === 'handover' && r.branch === branch);

async function onHandover(input, h) {
  const repo = top(h.dir || input.cwd || '.');
  if (!repo) return null;
  if (h.kind === 'api') return hasRuns(repo) ? deny('lpk: mark the PR ready with `gh pr ready <branch>`, so the delivery gates can tell which branch it hands over.') : null;
  const branch = (h.kind === 'ready' ? readyBranch(repo, h.ref) : h.branch) || git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repo).trim();
  const run = branch && runForBranch(repo, branch);
  if (!run) return null;
  // The gates read the checkout the branch stands in, its uncommitted files included.
  const wt = git(['worktree', 'list', '--porcelain'], repo).split('\n\n').map((b) => [b.match(/^worktree (.+)$/m)?.[1], b.match(/^branch refs\/heads\/(.+)$/m)?.[1]]).find(([, b]) => b === branch)?.[0];
  if (!wt) return deny(`lpk: check out ${branch} in a worktree first, so the delivery gates can read what it hands over.`);
  const d = await gated(wt, { ...run, branch }, h.kind === 'ready' ? '`gh pr ready`' : '`gh pr create` without --draft', { ci: h.kind === 'ready' });
  if (!d) appendRecord(wt, { kind: 'handover', run: run.id, branch, head: git(['rev-parse', 'HEAD'], wt).trim(), exit: 0, how: h.kind });
  return d;
}

async function onPush(input, cmd) {
  const plain = cmd.match(PLAIN_PUSH);
  if (!plain) return deny('lpk: run the push as a command of its own, so the guard can check the commits it publishes: `git push [args]` from the repo, or `git -C <dir> push [args]`.');
  const repo = git(['rev-parse', '--show-toplevel'], plain[3] ?? plain[4] ?? plain[5] ?? input.cwd).trim();
  if (!repo) return null;
  // Deleting a remote branch publishes no commit.
  if (/\s(--delete|-d)(\s|$)/.test(cmd)) return null;
  for (const branch of pushedBranches(repo, cmd)) {
    const run = runForBranch(repo, branch);
    if (!run) continue;
    if (handedOver(repo, run, branch)) { const d = await gated(repo, { ...run, branch }, 'a push to a branch handed over for review', { ci: false }); if (d) return d; continue; }
    const code = (ref) => codeOfCommit(repo, ref).code;
    const base = git(['merge-base', run.target, 'HEAD'], repo).trim();
    if (code('HEAD') !== code(base || run.base) && !(run.verified?.green && run.verified.code === code('HEAD'))) {
      return deny('lpk: this push publishes code no green `lpk verify` was recorded for: the last verify failed, or the code it ran on differs from HEAD (an edit or a rebase since, or a code file left uncommitted). Commit or remove the stray code files, run `lpk verify` until it is green, commit, then push.');
    }
    if (!run.granted?.draftPush && await gated(repo, { ...run, branch }, 'push', { ci: false })) {
      return deny(`lpk: the owner has not granted draft pushes in this repo, and the delivery gates of run ${run.id} do not hold yet. Ask the owner before the first push; on their yes, \`lpk run grant draft-push --why "<their words>"\`, then push.`);
    }
  }
  const range = pushRange(repo);
  const found = range ? problems(repo, range) : [];
  return found.length ? deny(`lpk: this push would publish commits CI or the reviewer rejects. Fix them (reword or squash with an interactive-free rebase), then push again.\n- ${found.join('\n- ')}`) : null;
}

export async function decide(input) {
  const cmd = String(input?.tool_input?.command || '');
  const title = prTitle(cmd);
  if (title && title.length > MAX_SUBJECT) return deny(`lpk: the PR title is ${title.length} characters (max ${MAX_SUBJECT}); it becomes the squash commit's subject. Shorten it: "${title}"`);
  const h = handover(cmd);
  const pushes = runsGit(cmd, 'push');
  if (!h && !pushes) return null;
  // Inside a run a gate's own error denies, naming it; elsewhere nothing here throws.
  try {
    if (h) { const d = await onHandover(input, h); if (d) return d; }
    return pushes ? await onPush(input, cmd) : null;
  } catch (e) {
    const repo = top(input.cwd || '.');
    if (repo && !hasRuns(repo)) return null;
    // The owner's waiver of `gate:error` in the open run lets through every call the gate cannot decide.
    let run = null;
    try { run = repo && readRun(repo); } catch { /* an unreadable run cannot carry a waiver */ }
    if (run && waived(repo, run.id, 'gate:error')) return null;
    return deny(`lpk: the delivery gate could not decide: ${String(e.message || e).split('\n')[0]}. ${WAIVE}`);
  }
}
