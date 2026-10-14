// PreToolUse hook on Bash: refuse a PR title over the subject bound, and before a `git push`,
// commits that CI or the reviewer will reject on exact facts (subject length, merge commits,
// committed secrets), and during an lpk run code that no green `lpk verify` was recorded for (a
// rebase changes it after the last verify).
import { spawnSync } from 'node:child_process';
import { commits, defaultBranch, git, runsGit } from './git.mjs';
import { codeOfCommit, runFor } from './run.mjs';
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
  // When gitleaks is installed (`lpk setup` fetches it), each secret it finds is named by commit,
  // file, line and rule.
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

// A PR title becomes the squash commit's subject on the default branch, so it is held to the same
// bound. Only a title passed literally to a command that starts `gh pr create|edit` is measured,
// read argument by argument up to the first shell operator; any other form is let through.
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

export function decide(input) {
  const cmd = String(input?.tool_input?.command || '');
  const title = prTitle(cmd);
  if (title && title.length > MAX_SUBJECT) return deny(`lpk: the PR title is ${title.length} characters (max ${MAX_SUBJECT}); it becomes the squash commit's subject. Shorten it: "${title}"`);
  if (!runsGit(cmd, 'push')) return null;
  const plain = cmd.match(PLAIN_PUSH);
  if (!plain) return deny('lpk: run the push as a command of its own, so the guard can check the commits it publishes: `git push [args]` from the repo, or `git -C <dir> push [args]`.');
  const dir = plain[3] ?? plain[4] ?? plain[5] ?? input.cwd;
  const repo = git(['rev-parse', '--show-toplevel'], dir).trim();
  if (!repo) return null;
  // Deleting a remote branch publishes no commit.
  if (/\s(--delete|-d)(\s|$)/.test(cmd)) return null;
  const run = runFor(repo, input.session_id);
  const code = (ref) => codeOfCommit(repo, ref).code;
  if (run && code('HEAD') !== code(run.base) && !(run.verified?.green && run.verified.code === codeOfCommit(repo, 'HEAD').code)) {
    return deny('lpk: this push publishes code no green `lpk verify` was recorded for: the last verify failed, or the code it ran on differs from HEAD (an edit or a rebase since, or a code file left uncommitted). Commit or remove the stray code files, run `lpk verify` until it is green, commit, then push.');
  }
  const range = pushRange(repo);
  if (!range) return null;
  const found = problems(repo, range);
  if (!found.length) return null;
  return deny(`lpk: this push would publish commits CI or the reviewer rejects. Fix them (reword or squash with an interactive-free rebase), then push again.\n- ${found.join('\n- ')}`);
}
