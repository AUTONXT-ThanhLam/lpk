// An lpk run: run.json in the run directory of the checkout that started it (where.mjs), which its
// builders' worktrees share. It names the session that holds it, the branch it delivers, its lane and scenarios, the
// checks that define "verified" and the last verify. A run ends only by `lpk run end`; its file
// moves under runs/<id>/, where the delivery gates still find it by its branch.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { archiveLedger } from './findings.mjs';
import { git, top } from './git.mjs';
import { sessionId } from './host.mjs';
import { gone, heirs, sessionPid } from './sessions.mjs';
import { ACTIVE, activeFile, checkout, markerOf, parse, registered, runDir, startDir, worktreeOf } from './where.mjs';

export { codeOfCommit, treeOf } from './tree.mjs';
export { verify } from './verify.mjs';
export { ACTIVE, markerOf, runDir };
export { exitedRuns, sessionPid } from './sessions.mjs';

const DAY = 24 * 3600 * 1000;
export const runState = (repo, session) => parse(markerOf(repo, session));
export const readRun = (repo, session) => runState(repo, session).run;

export function writeRun(run) {
  const { marker, ...data } = run;
  mkdirSync(join(marker, '..'), { recursive: true });
  // Written aside and renamed, so a hook reading at the same moment never sees half a file.
  const tmp = `${marker}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, marker);
}

// The run this hook call belongs to: unbound (the first hook binds it to its session) or bound to
// this session. An unbound run older than a day is ignored; `bind` false leaves it alone.
export const runFor = (repo, session, bind = true) => claim(readRun(repo, session), session, bind);

function claim(r, session, bind = true) {
  if (!r || (!r.session && Date.now() - r.started > DAY)) return null;
  if (r.session && session && r.session !== session) return gone(r.session, session) ? adopt(r, session) : null;
  if (!r.session && !bind) return null;
  if (!r.session && session) { r.session = session; writeRun(r); }
  return r;
}

export function adopt(run, session) {
  run.previous = [...(run.previous || []), run.session];
  run.session = session;
  writeRun(run);
  return run;
}

// This session's newest run in any repo, for a hook called from a directory outside it.
export function activeRun(session, bind = true, cwd = '') {
  const runs = registered().map(({ file, run: r }) => {
    if (r && (r.session || Date.now() - r.started <= DAY)) return r;
    rmSync(file, { force: true });
    return null;
  }).filter(Boolean);
  const above = (r) => cwd && (r.repo === cwd || r.repo.startsWith(`${cwd.replace(/\/$/, '')}/`));
  const mine = runs.filter((r) => (r.session ? r.session === session : above(r))).sort((a, b) => b.started - a.started);
  let pick = bind ? mine[0] : mine.find((r) => r.session);
  if (!pick) { const only = heirs(session, top(cwd)); if (only.length === 1) pick = only[0]; }
  return claim(pick, session, bind);
}

// The run this checkout delivers: the open one, else the ended run of the current branch.
export function runHere(repo) {
  const st = runState(repo);
  if (st.error) throw new Error(st.error);
  return st.run || runForBranch(repo, currentBranch(repo));
}

// Runs that ended, newest first, each as its runs/<id>/run.json left it.
export function endedRuns(repo) {
  const dir = join(runDir(repo), 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => parse(join(dir, id, 'run.json')).run).filter((r) => r?.ended).sort((a, b) => b.endedAt - a.endedAt);
}

// The run that delivers `branch`: a run that noted it (the open one first, then the newest ended
// one), else the open run for any branch but its target, however the work reached that branch. The
// open run notes such a branch, so the gates still hold on it after `lpk run end`. Gates key on
// this, so they hold for any session.
export function runForBranch(repo, branch) {
  const holder = worktreeOf(repo, branch);
  if (holder && checkout(holder)?.own !== checkout(repo)?.own) return runForBranch(holder, branch);
  const st = runState(repo);
  if (st.error) throw new Error(st.error);
  const open = st.run;
  if (open?.branches?.includes(branch)) return open;
  const ended = endedRuns(repo).find((r) => r.branches?.includes(branch));
  if (ended) return ended;
  if (!open || !branch || branch === short(open.target)) return null;
  open.branches = [...(open.branches || []), branch];
  writeRun(open);
  return open;
}

export const currentBranch = (repo) => git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repo).trim();
const short = (ref) => String(ref || '').replace(/^(refs\/(heads|remotes)\/)?(origin\/)?/, '');
// The branch the run is on, kept when it is not the target branch itself.
export function noteBranch(repo, run) {
  const b = currentBranch(repo);
  if (!b || b === short(run.target) || run.branches.includes(b)) return false;
  run.branches.push(b);
  run.branch = b;
  return true;
}

// Starts a run, or with an open one: amends it when it is this session's (same id, ledger and
// verify kept), takes it with `take` when its session's process is gone, else refuses.
export function startRun(repo, { target, base, lane = 'full', laneWhy = '', scenarios = [], requirements = [], verify = [], take = false, draftPush = false }) {
  const marker = startDir(repo) && join(startDir(repo), 'run.json');
  if (!marker) return { error: 'not inside a git repository' };
  const st = parse(marker), me = sessionId();
  if (st.error) return { error: st.error };
  const open = st.run;
  if (open && open.session && open.session !== me) {
    if (!take) return { error: `a run of session ${open.session} is open in this repo since ${new Date(open.started).toISOString()}; \`lpk run start --take\` takes it over once that session has exited, \`lpk run end\` ends it` };
    const pid = sessionPid(open.session);
    if (pid) return { error: `session ${open.session} still runs (pid ${pid}); --take only takes a run whose session has exited` };
    return { run: adopt(open, me), took: true };
  }
  if (take && !open) return { error: 'no open run to take' };
  if (!verify.length && !open) return { error: 'name at least one check with --verify "<command>": the commands CI runs for this change' };
  const run = open || { v: 2, id: `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}`, repo, started: Date.now(), branches: [], seen: [], reviewRange: '', previous: [], granted: { draftPush: false } };
  Object.assign(run, { marker, target, base, lane, laneWhy, ...(me ? { session: me } : {}) });
  if (scenarios.length || !open) {
    // A Prover that started before the scenarios changed proved other ones (proof.mjs proverResults).
    if (open && JSON.stringify(scenarios) !== JSON.stringify(open.scenarios || [])) run.scenariosAt = Date.now();
    run.scenarios = scenarios;
  }
  if (requirements.length || !open) run.requirements = requirements;
  if (verify.length) { if (open && verify.join('\n') !== (open.verify || []).join('\n')) delete run.verified; run.verify = verify; }
  if (draftPush) run.granted = { ...run.granted, draftPush: true };
  noteBranch(repo, run);
  mkdirSync(dirname(marker), { recursive: true });
  if (!open) leaveLedger(repo);
  writeRun(run);
  if (!open) writeFileSync(promptsOf(marker), '');
  mkdirSync(ACTIVE, { recursive: true });
  writeFileSync(activeFile(marker), marker);
  return { run, amended: Boolean(open) };
}

// A ledger the last run left moves under that run's id before a new run starts empty.
function leaveLedger(repo) {
  if (!existsSync(join(runDir(repo), 'findings.jsonl'))) return;
  const r = archiveLedger(repo, endedRuns(repo)[0]?.id || `before-${Date.now()}`);
  if (r.error) throw new Error(r.error);
}

// What the owner wrote during the run, one JSON line per message, for lpk:learn.
export const promptsOf = (marker) => join(marker, '..', 'prompts.jsonl');
export function notePrompt(run, prompt) {
  writeFileSync(promptsOf(run.marker), `${JSON.stringify({ at: new Date().toISOString(), prompt })}\n`, { flag: 'a' });
}

export function update(repo, fn) {
  const st = runState(repo);
  if (!st.run) return { error: st.error || 'no lpk run in this repo' };
  fn(st.run);
  writeRun(st.run);
  return { run: st.run };
}

// Never refuses: no run says so, a damaged run.json is set aside, an open run moves under runs/<id>/
// with when and why it ended. Its ledger stays where it is until the next run starts.
export function endRun(repo, { abandon } = {}) {
  const marker = markerOf(repo);
  const st = runState(repo);
  if (marker) rmSync(activeFile(marker), { force: true });
  if (!st.run && !st.error) return { none: true };
  const dir = join(runDir(repo), 'runs', st.run ? st.run.id : `damaged-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  if (!st.run) { renameSync(marker, join(dir, 'run.json.damaged')); return { damaged: st.error }; }
  for (const f of ['brief.md', 'brief.json']) if (existsSync(join(marker, '..', f))) renameSync(join(marker, '..', f), join(dir, f));
  const { marker: _, ...run } = st.run;
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...run, ended: new Date().toISOString(), endedAt: Date.now(), ...(abandon ? { abandon } : {}) }, null, 1));
  rmSync(marker, { force: true });
  return { run: st.run, abandon };
}
