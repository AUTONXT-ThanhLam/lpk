// `lpk run start|take|worktree|end|status|lane|grant`: the run's life. Start records the lane, the
// scenarios and the checks; a second start in the same session amends the open run and keeps its
// ledger; `take` takes over a run whose session has exited; `end` refuses while a PR of the run conflicts
// with its base, or is a draft the owner asked for ready, until the owner waives it or the run is abandoned.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaultBranch, git, mergeBase } from '../git.mjs';
import { sessionId } from '../host.mjs';
import { repoOf } from '../out.mjs';
import { owed } from '../owed.mjs';
import { appendDecision } from '../records.mjs';
import { cleanRepro } from '../repro.mjs';
import { recordRun } from '../runs.mjs';
import { prLine, prWaiver, prBlocks, runPrs, unwaived } from '../prs.mjs';
import { reap } from '../spawn.mjs';
import { reopenRun } from '../reopen.mjs';
import { currentBranch, endRun, promptsOf, readRun, runDir, runForBranch, runState, sessionPid, startRun, update } from '../run.mjs';
import { cleanTrees, treeOf } from '../slicetree.mjs';
import { linkWorktree } from '../where.mjs';
import { BARS } from '../bar.mjs';
import { briefScenarios, ciLines, parse, pinned, USAGE } from './run-args.mjs';

async function start(repo, o) {
  const target = pinned(repo, o.target || o.base, readRun(repo)?.target) || defaultBranch(repo);
  if (o.lane && !['quick', 'full'].includes(o.lane)) { console.error(`lpk: --lane is quick or full\n${USAGE}`); return 2; }
  if (o.bar && !BARS.includes(o.bar)) { console.error(`lpk: --bar is ${BARS.join(' or ')}\n${USAGE}`); return 2; }
  const pf = new URL('../preflight.mjs', import.meta.url);
  if (existsSync(pf)) {
    const p = await (await import(pf)).preflight(repo, { target, verify: o.verify });
    if (p.refuse) { console.error(`lpk: ${p.refuse}`); return 2; }
    console.log(p.lines.join('\n'));
  }
  const base = target ? mergeBase(repo, target) : '';
  if (!base) { console.error('lpk: no target branch given with --target and none found (origin/HEAD, main, master)'); return 2; }
  const open = readRun(repo);
  const lane = o.lane || open?.lane || 'full';
  const known = (o.requirements.length ? o.requirements : open?.requirements || []).map((q) => q.id);
  const unknown = [...new Set(o.scenarios.flatMap((s) => s.proves || []).filter((id) => !known.includes(id)))];
  if (unknown.length) { console.error(`lpk: --proves names ${unknown.join(', ')}, and the run's requirements are ${known.join(', ') || 'none (--req "<text>" numbers them)'}`); return 2; }
  let scenarios = o.scenarios;
  try { if (!scenarios.length) scenarios = briefScenarios(repo); } catch (e) { console.error(`lpk: ${e.message}`); return 2; }
  const r = startRun(repo, { target, base, lane, laneWhy: o.why ?? open?.laneWhy ?? '', scenarios, requirements: o.requirements, verify: o.verify, verifyFinal: o.verifyFinal, take: o.flags.has('--take'), draftPush: o.flags.has('--draft-push'), bar: o.bar });
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  const run = r.run;
  if (o.lane === 'quick' && !r.took) appendDecision(repo, { what: 'quick lane', why: o.why || 'no reason given' });
  if (o.flags.has('--draft-push')) appendDecision(repo, { what: 'draft pushes granted', why: o.why || 'granted at run start' });
  console.log(`lpk run ${run.id} ${r.took ? 'taken over by this session' : r.amended ? 'amended (ledger and verify kept)' : 'started'} in ${repo} against ${target} (${base.slice(0, 12)}), ${run.lane} lane${run.branch ? `, branch ${run.branch}` : ''}. Bar: ${run.bar || 'production'}.`);
  console.log(`Checks: ${run.verify.map((c) => `\`${c}\``).join(', ')}.${run.verifyFinal?.length ? ` Final checks (\`lpk verify --final\`, once on the committed tree): ${run.verifyFinal.map((c) => `\`${c}\``).join(', ')}.` : ''} Scenarios: ${run.scenarios.length ? run.scenarios.map((s) => `${s.id} ${s.cmd ? `\`${s.cmd}\`${s.expect !== undefined ? ` expecting "${s.expect}"` : ''}` : `(agent-judged) ${s.agentJudged}`}${s.proves ? ` proves ${s.proves.join(', ')}` : ''}`).join('; ') : 'none yet'}.`);
  if (run.requirements?.length) console.log(`Requirements: ${run.requirements.map((q) => `${q.id} ${q.text}`).join('; ')}.`);
  const on = currentBranch(repo);
  const targetName = String(target || '').replace(/^origin\//, '');
  if (on && (on === targetName || ['main', 'master'].includes(on))) console.log(`This checkout is on ${on}, the branch the change merges into: create the change's own branch (\`git switch -c <type>/<name>\`) before the first commit, and \`lpk verify\` there; a commit here is refused.`);
  console.log(`Until \`lpk run end\` the main session commits only a tree with a green \`lpk verify\`; handing over the branch (\`gh pr create\` without --draft, \`gh pr ready\`) waits for \`lpk gates\`. Draft pushes: ${run.granted.draftPush ? 'granted' : 'not granted; ask the owner before the first push'}.`);
  const ci = ciLines(repo);
  console.log(ci.length ? ['CI runs these; each one that checks the code you will touch belongs among the checks:', ...ci].join('\n') : 'CI: no GitHub Actions or GitLab CI steps found; the checks are the repo\'s own test, lint and typecheck commands.');
  return 0;
}

function heldBy(r) {
  const me = sessionId();
  if (!r.session) return 'no session yet: the first hook of a session working here binds it';
  if (r.session === me) return 'this session';
  const pid = sessionPid(r.session);
  return pid ? `session ${r.session}, which still runs (pid ${pid})` : `session ${r.session}, which has exited: \`lpk run take\` continues the run in this session`;
}

function reopen(repo) {
  const r = reopenRun(repo);
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  console.log(`lpk run ${r.run.id} reopened by this session in ${repo}${r.run.branch ? `, branch ${r.run.branch}` : ''}: its scenarios, requirements, findings and the owner's waivers are as it left them. \`lpk gates\` shows where it stands on the current HEAD.`);
  return 0;
}

function worktree(repo, o) {
  const [, path, commit = 'HEAD'] = o.words;
  if (!path || o.words.length > 3) { console.error(USAGE); return 2; }
  const run = readRun(repo);
  if (!run) { console.error(`lpk: no lpk run in ${repo} for the worktree to work in`); return 2; }
  const at = path.includes('/') ? resolve(path) : treeOf(repo, run, path);
  if (!path.includes('/')) mkdirSync(dirname(at), { recursive: true });
  const r = spawnSync('git', ['worktree', 'add', ...(o.branch ? ['-b', o.branch] : ['--detach']), at, commit], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) { console.error(`lpk: git worktree add failed: ${(r.stderr || '').trim()}`); return 1; }
  linkWorktree(at, dirname(run.marker));
  console.log(`worktree ${at} ${o.branch ? `on branch ${o.branch}` : 'detached'} at ${commit}; lpk calls from it work in run ${run.id} (${dirname(run.marker)}).`);
  return 0;
}

export async function main(argv) {
  const o = parse(argv);
  if (o.error) { console.error(`lpk: ${o.error}\n${USAGE}`); return 2; }
  const repo = repoOf(o.repo);
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const [sub, arg] = o.words;
  if (sub === 'start') return start(repo, o);
  if (sub === 'take' && !readRun(repo)) return reopen(repo);
  if (sub === 'take') return start(repo, { ...o, flags: new Set(['--take']) });
  if (sub === 'worktree') return worktree(repo, o);
  if (sub === 'end') {
    const why = o.abandon ?? o.reason;
    // The run's row for runs.jsonl, written while run.json still holds it; a failure here never
    // stops the run from ending.
    const open = readRun(repo);
    if (open) {
      const { prs, errors } = runPrs(repo, open);
      if (prs.length) console.log(`PRs of this run:\n${prs.map((p) => `- ${prLine(p)}`).join('\n')}`);
      if (errors.length) console.error(`lpk: PR state not read: ${errors.join('; ')}`);
      const stuck = why ? [] : unwaived(repo, open, prBlocks(prs, open));
      if (stuck.length) {
        console.error(`lpk: the run stays open: ${stuck.map((b) => `${b.pr.url} (${b.why})`).join('; ')}. Fix each, or the owner releases it with the waiver question: an option labelled \`${prWaiver(stuck[0].pr)}\`. \`lpk run end --abandon "<why>"\` ends the run anyway.`);
        return 1;
      }
    }
    if (open) {
      try { recordRun(repo, { owed: await owed(repo, open).catch((e) => [{ error: e.message }]), ...(why ? { abandon: why } : {}) }); }
      catch (e) { console.error(`lpk: the run's row for runs.jsonl was not written: ${e.message}`); }
    }
    // What the run started outside the repo stops with it: the apps `lpk spawn` started and the
    // repro worktrees. Neither failing keeps the run open.
    const stopped = [];
    try { stopped.push(...(await reap(repo)).filter((x) => x.was === 'stopped' || x.was === 'STILL RUNNING').map((x) => `${x.name || x.pid} ${x.was}`)); } catch (e) { console.error(`lpk: lpk reap failed: ${e.message}`); }
    if (open) {
      try {
        const t = cleanTrees(repo, open);
        if (t.kept.length) console.log(`Worktrees kept because they hold uncommitted work: ${t.kept.join(', ')}.`);
      } catch (e) { console.error(`lpk: the run's worktrees were not removed: ${e.message}`); }
    }
    try { if (open) cleanRepro(repo, open.id); } catch (e) { console.error(`lpk: the repro worktrees were not removed: ${e.message}`); }
    if (stopped.length) console.log(`Apps lpk spawn started: ${stopped.join(', ')}.`);
    const r = endRun(repo, { abandon: why });
    if (r.none) { console.log('lpk: no lpk run is open in this repo; nothing to end.'); return 0; }
    if (r.damaged) { console.log(`lpk: the damaged run file was set aside (${r.damaged}).`); return 0; }
    if (why) appendDecision(repo, { what: `run ${r.run.id} ended before delivery`, why });
    const file = promptsOf(r.run.marker);
    const said = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
    console.log(`lpk run ended${why ? `: ${why}` : ''}. Last verify: ${r.run.verified ? (r.run.verified.green ? 'green' : 'RED') : 'never ran'}. Owner messages during the run: ${said}${said ? `, in ${file} (hand them to lpk:learn)` : ''}. The delivery gates still hold on ${r.run.branches?.join(', ') || 'its branch'}.`);
    return 0;
  }
  if (sub === 'status') {
    const st = runState(repo);
    if (st.error) { console.error(`lpk: ${st.error}`); return 1; }
    const r = st.run;
    console.log(r ? JSON.stringify({ id: r.id, bar: r.bar || 'production', session: r.session || null, heldBy: heldBy(r), target: r.target, branch: r.branch || null, lane: r.lane, laneWhy: r.laneWhy, scenarios: r.scenarios, requirements: r.requirements || [], verify: r.verify, verifyFinal: r.verifyFinal || [], verified: r.verified ? { green: r.verified.green, id: r.verified.id } : null, reviewRange: r.reviewRange || null, granted: r.granted, started: new Date(r.started).toISOString() }, null, 1) : 'no lpk run in this repo');
    return 0;
  }
  if ((sub === 'lane' && arg === 'full') || (sub === 'grant' && ['draft-push', 'ready'].includes(arg))) {
    if (!o.why) { console.error(`lpk: --why "<why>" is required\n${USAGE}`); return 2; }
    const key = arg === 'ready' ? 'ready' : 'draftPush';
    const what = arg === 'ready' ? 'the owner asked for the PRs ready' : 'draft pushes granted';
    const owner = sub === 'grant' ? runForBranch(repo, currentBranch(repo)) : null;
    if (owner?.ended) {
      owner.granted = { ...owner.granted, [key]: true };
      writeFileSync(join(runDir(repo), 'runs', owner.id, 'run.json'), JSON.stringify(owner, null, 1));
      appendDecision(repo, { what, why: o.why });
      console.log(`${what} in run ${owner.id}: ${o.why}`);
      return 0;
    }
    const u = update(repo, (run) => { if (sub === 'lane') Object.assign(run, { lane: 'full', laneWhy: o.why }); else run.granted = { ...run.granted, [key]: true }; });
    if (u.error) { console.error(`lpk: ${u.error}`); return 1; }
    appendDecision(repo, { what: sub === 'lane' ? 'quick lane switched to full' : what, why: o.why });
    console.log(sub === 'lane' ? `run ${u.run.id} is now full lane: ${o.why}` : `${what} in run ${u.run.id}: ${o.why}`);
    return 0;
  }
  console.error(USAGE);
  return 2;
}
