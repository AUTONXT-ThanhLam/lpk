// What a shell command hands over, read from a fixed list of forms: `gh pr create` without
// --draft/-d, `gh pr ready` (not --undo), a `gh api` call naming ready_for_review or
// markPullRequestReadyForReview; and which branches a `git push` publishes. Any other form is not
// a handover; the list is a tripwire, not a parser of every shell.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { git } from './git.mjs';

const READY_API = /ready_for_review|markPullRequestReadyForReview/;

// Words of a command with here-document bodies dropped: a quoted string is one word, and each
// shell operator is a word of its own (`op`).
function words(cmd) {
  const text = String(cmd || '').replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, '\n');
  return [...text.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(&&|\|\||[;|&\n()])|([^\s"';&|()]+)/g)]
    .map((m) => (m[3] !== undefined ? { op: m[3] } : { text: m[1] ?? m[2] ?? m[4], bare: m[4] !== undefined }));
}

function segments(cmd) {
  const out = [[]];
  for (const w of words(cmd)) if (w.op) out.push([]); else out.at(-1).push(w);
  return out.filter((s) => s.length);
}

const flag = (args, ...names) => args.some((a) => a.bare && names.includes(a.text));
const value = (args, long, shortName) => {
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (t === long || t === shortName) return args[i + 1]?.text;
    if (t.startsWith(`${long}=`)) return t.slice(long.length + 1);
  }
  return undefined;
};

// { kind: 'create'|'ready'|'api', branch?, dir? } for the first handover in the command, or null.
export function handover(cmd) {
  let dir;
  for (const seg of segments(cmd)) {
    let i = 0;
    while (seg[i]?.bare && /^\w+=/.test(seg[i].text)) i++;
    const w = seg.slice(i);
    if (w[0]?.text === 'cd' && w[1]) { dir = resolve(dir || '.', w[1].text); continue; }
    if (w[0]?.text !== 'gh') continue;
    if (w[1]?.text === 'api' && READY_API.test(w.map((x) => x.text).join(' '))) return { kind: 'api', dir };
    const pr = w.findIndex((x, k) => k < 4 && x.text === 'pr');
    if (pr < 0) continue;
    const sub = w[pr + 1]?.text, args = w.slice(pr + 2);
    if (sub === 'create' && !flag(args, '--draft', '-d', '--draft=true')) return { kind: 'create', branch: value(args, '--head', '-H'), dir };
    if (sub === 'ready' && !flag(args, '--undo')) {
      const pos = args.filter((a, k) => !a.text.startsWith('-') && !['-R', '--repo'].includes(args[k - 1]?.text));
      return { kind: 'ready', ref: pos[0]?.text, dir };
    }
  }
  return null;
}

// The branch a `gh pr ready <ref>` names: a branch name as given, a number or URL through `gh`.
export function readyBranch(repo, ref) {
  if (!ref) return '';
  if (!/^(\d+|https?:\/\/.+)$/.test(ref)) return ref;
  return execFileSync('gh', ['pr', 'view', ref, '--json', 'headRefName', '-q', '.headRefName'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}

const VALUED = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
// The local branches a plain `git push` publishes: the refspecs' sources, every branch for
// --all or --mirror, else the current branch.
export function pushedBranches(repo, cmd) {
  const w = segments(cmd).find((s) => s.some((x) => x.text === 'push'));
  if (!w) return [];
  const args = w.slice(w.findIndex((x) => x.text === 'push') + 1);
  if (flag(args, '--all', '--mirror', '--branches')) return git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repo).split('\n').filter(Boolean);
  const pos = args.filter((a, k) => !a.text.startsWith('-') && !VALUED.has(args[k - 1]?.text)).map((a) => a.text);
  const current = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repo).trim();
  if (pos.length < 2) return current ? [current] : [];
  return pos.slice(1).flatMap((spec) => {
    // The local side names the branch, as runs know it; an empty one deletes the remote branch.
    const name = spec.replace(/^\+/, '').split(':')[0];
    if (!name || name.startsWith('refs/tags/')) return [];
    const b = name.replace(/^refs\/heads\//, '');
    return [b === 'HEAD' ? current : b];
  }).filter(Boolean);
}
