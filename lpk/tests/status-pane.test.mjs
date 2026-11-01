import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lpk, repoWith, sh, write } from './gates-env.mjs';
import { notePrompt, readRun } from '../lib/run.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };

function buildRun(name, session) {
  const repo = repoWith(name, { 'src/api.mjs': '1\n', 'src/ui.tsx': '1\n' });
  write(repo, '.git/lpk/brief.md', '# Brief\n');
  write(repo, '.git/lpk/brief.json', JSON.stringify({ slices: [{ name: 'api', files: ['src/api.mjs'] }, { name: 'ui', files: ['src/ui.tsx'] }] }));
  ok(lpk(repo, session, 'run', 'start', '--verify', 'true', '--req', 'The KPI tile shows the total'));
  write(repo, 'src/api.mjs', '2\n');
  sh(repo, 'commit', '-qam', 'Build the api slice');
  return repo;
}

test('the status says what lpk is doing, what is done and what is next, for the pane and the band alike', () => {
  const S = 'pane-facts';
  const repo = buildRun('pane-facts', S);
  const s = JSON.parse(ok(lpk(repo, S, 'status', '--json')));
  assert.match(s.view.doing[0], /^Build: ● api {2}○ ui$/);
  assert.deepEqual(s.view.done, ['steps: Understand, Design', 'slices landed 1/2: api']);
  assert.deepEqual(s.view.next, ['slices waiting: ui', 'then Review › Fix › Prove › Deliver']);
  const text = ok(lpk(repo, S, 'status'));
  assert.match(text, /\ndone: steps: Understand, Design · slices landed 1\/2: api\nnext: slices waiting: ui · then Review › Fix › Prove › Deliver\n$/);
});

test('the report lists the owner\'s words verbatim beside the requirements, and says so when none were recorded', () => {
  const S = 'pane-report';
  const repo = buildRun('pane-report', S);
  assert.match(lpk(repo, S, 'report').stdout, /Owner words during the run: none recorded/);
  notePrompt(readRun(repo), 'Show the total in a tile.\nMake it blue.');
  notePrompt(readRun(repo), 'Also export it as CSV, see v0.5.0');
  const out = lpk(repo, S, 'report').stdout;
  assert.match(out, /Owner words during the run \(2\)/);
  assert.match(out, /\n1\. Show the total in a tile\.\n {3}Make it blue\.\n2\. Also export it as CSV, see v0\.5\.0\n/);
  assert.match(out, /\| R1 \| The KPI tile shows the total \|/);
});
