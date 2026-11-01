import { git } from './git.mjs';
import { baseOf } from './out.mjs';

const lines = (out) => out.split('\n').filter(Boolean);

export function lateFix(repo, finding, ledger) {
  const [from, to] = String(finding.at).split('..');
  if (!from || !to) return null;
  const inRange = new Set(lines(git(['rev-list', `${from}..${to}`], repo)));
  const earlier = ledger.find((x) => x.run === finding.run && x.id !== finding.id && x.state === 'fixed' && inRange.has(x.fixedCommit));
  return earlier ? { id: earlier.id, commit: earlier.fixedCommit } : null;
}

export function lateFixError(finding, late) {
  return `${finding.id} was raised on ${finding.at}, which holds ${late.commit.slice(0, 12)}, the fix of ${late.id}: patching it is a second fix round, and the loop of review, fix and review runs once. `
    + 'The ways out: revert or redesign that fix (`lpk fixlines` names what it rewrote), have the owner defer it (closedBy owner) or waive the findings gate, or take it into a new run.';
}

function addedLines(repo, base, sha) {
  const added = new Set();
  let path = '';
  for (const l of git(['diff', '-U0', '--no-color', base, sha], repo).split('\n')) {
    if (l.startsWith('+++ ')) path = l === '+++ /dev/null' ? '' : l.slice(6);
    const m = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m || !path) continue;
    const from = Number(m[1]);
    for (let n = from; n < from + (m[2] === undefined ? 1 : Number(m[2])); n++) added.add(`${path}:${n}`);
  }
  return added;
}

function hitsAt(repo, rev, pattern, files) {
  if (!files.length) return [];
  return lines(git(['grep', '-n', '-I', '-E', '-e', pattern, rev, '--', ...files], repo)).flatMap((l) => {
    const m = l.slice(rev.length + 1).match(/^(.+?):(\d+):/);
    return m ? [`${m[1]}:${m[2]}`] : [];
  });
}

export function sweepOf(repo, finding, sha, pattern) {
  const text = typeof pattern === 'string' ? pattern.trim() : '';
  if (!text) {
    return { error: `sweep: a git grep -E pattern for the class of defect ${finding.id} is (the form of the defect, not of its fix). lpk runs it over the files the change touches: it must hit before the fix and nowhere on the lines the change adds after it` };
  }
  const base = baseOf(repo);
  if (!base) return { error: 'sweep: no run target and no default branch to take the change from' };
  const files = lines(git(['diff', '--name-only', base, sha], repo));
  const before = hitsAt(repo, `${sha}^`, text, files);
  if (!before.length) return { error: `sweep: no hit before the fix, in ${files.length} file(s) of the change, for ${text} (an invalid extended regex also hits nothing): a pattern that finds nothing before the fix proves nothing about its class` };
  const added = addedLines(repo, base, sha);
  const after = hitsAt(repo, sha, text, files);
  const left = after.filter((h) => added.has(h));
  if (left.length) return { error: `sweep: ${left.length} more place(s) of the same class are on lines this change adds, fix them in the same commit: ${left.slice(0, 12).join(', ')}${left.length > 12 ? ` and ${left.length - 12} more` : ''}` };
  return { sweep: { pattern: text, before: before.length, preexisting: after.filter((h) => !added.has(h)).slice(0, 12) } };
}
