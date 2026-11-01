import { git } from './git.mjs';
import { patchesOf } from './patches.mjs';
import { CODE, TEST } from './rules.mjs';

function numstat(repo, sha) {
  const t = git(['show', '-M', '--numstat', '-z', '--format=', sha], repo).split('\0').filter(Boolean);
  const rows = [];
  for (let i = 0; i < t.length; i++) {
    const [n, , p] = t[i].split('\t');
    if (p === '') { rows.push([n, t[i + 2]]); i += 2; } else rows.push([n, p]);
  }
  return rows;
}

function addedBy(repo, sha) {
  const rows = numstat(repo, sha);
  const added = (re) => rows.filter(([n, p]) => n !== '-' && Number(n) > 0 && p && re(p)).map(([, p]) => p);
  return { code: added((p) => CODE.test(p) && !TEST.test(p)), tests: added((p) => TEST.test(p)) };
}

export function testsFirstGate(repo, run) {
  const commits = git(['log', '--reverse', '--no-merges', '--format=%h', `${patchesOf(repo, run.target).base}..HEAD`], repo).split('\n').filter(Boolean);
  const by = commits.map((c) => ({ c, ...addedBy(repo, c) }));
  const code = by.findIndex((x) => x.code.length);
  const test = by.findIndex((x) => x.tests.length);
  const late = code >= 0 && test > code;
  return {
    holds: !late,
    read: `${commits.length} commits since the base; first code ${code >= 0 ? by[code].c : 'none'}, first test ${test >= 0 ? by[test].c : 'none'}`,
    why: late ? `${by[code].c} adds code (${by[code].code.slice(0, 3).join(', ')}) before the first test, ${by[test].c} (${by[test].tests.slice(0, 3).join(', ')})` : '',
    wayOut: 'commit the failing test first: reorder the commits (a rebase of your own unpushed work) so the test is no later than the code it covers',
  };
}
