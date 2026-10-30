// The options of `lpk run` and the facts `lpk run start` reads from the repo: brief scenarios, CI steps, the pinned target.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ciCommands, git } from '../git.mjs';
import { runDir } from '../run.mjs';
export const USAGE = `usage:
  lpk run start --verify "<command>"... [--verify-final "<command>"]... [--lane quick|full --why "<why>"] [--req "<requirement>"]... [--scenario "<command>" [--expect "<text>"] [--proves R1,R2]]... [--judged "<scenario>" [--proves R1]]... [--target <ref>] [--draft-push] [--repo <dir>]
                 (--req numbers R1, R2... in order; --proves names the ones the scenario before it proves.
                  With no --scenario or --judged, the scenarios of brief.json beside run.json are recorded.)
                 (--verify-final names the slow checks that gate delivery but not each commit: \`lpk verify\` runs the --verify ones, \`lpk verify --final\` the others, once, on the committed tree)
                 (--bar production raises the run from the default increment bar to production; it is never lowered)
  lpk run take [--repo <dir>]             (take over a run whose session has exited, or reopen the one that delivered this branch)
  lpk run worktree <name | path> [<commit>] [--branch <name>] [--repo <dir>]
                                          (git worktree add, -b <name> or --detach, at <commit> or HEAD; a bare name is made under the repo's
                                           git directory, lpk/wt/<run>/<name>, and lpk run end removes it when clean;
                                           lpk calls from the new worktree work in this run)
  lpk run end [--abandon "<why>"] [--repo <dir>]
  lpk run status [--repo <dir>]
  lpk run lane full --why "<why>" [--repo <dir>]
  lpk run grant draft-push --why "<the owner's words>" [--repo <dir>]
  lpk run grant ready --why "<the owner's words>" [--repo <dir>]   (the owner asked for the PRs ready: lpk run end then refuses a draft one)`;

const VALUED = new Set(['--verify', '--verify-final', '--lane', '--why', '--scenario', '--expect', '--judged', '--req', '--proves', '--target', '--base', '--repo', '--abandon', '--reason', '--branch', '--bar']);
const BARE = new Set(['--take', '--draft-push']);

// Options in order, so each --expect belongs to the --scenario before it.
export function parse(argv) {
  const o = { words: [], verify: [], verifyFinal: [], scenarios: [], requirements: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BARE.has(a)) { o.flags.add(a); continue; }
    if (!a.startsWith('--')) { o.words.push(a); continue; }
    if (!VALUED.has(a)) return { error: `unknown option ${a}` };
    const v = argv[++i];
    if (v === undefined) return { error: `${a} needs a value` };
    if (a === '--verify') o.verify.push(v);
    else if (a === '--verify-final') o.verifyFinal.push(v);
    else if (a === '--scenario') o.scenarios.push({ id: `S${o.scenarios.length + 1}`, cmd: v });
    else if (a === '--judged') o.scenarios.push({ id: `S${o.scenarios.length + 1}`, agentJudged: v });
    else if (a === '--expect') { const s = o.scenarios.at(-1); if (!s?.cmd || s.expect !== undefined) return { error: '--expect follows the --scenario "<command>" it checks' }; s.expect = v; }
    else if (a === '--req') o.requirements.push({ id: `R${o.requirements.length + 1}`, text: v, source: 'lpk run start --req' });
    else if (a === '--proves') {
      const s = o.scenarios.at(-1);
      if (!s || s.proves) return { error: '--proves follows the --scenario or --judged it belongs to' };
      s.proves = v.split(',').map((x) => x.trim()).filter(Boolean);
      if (!s.proves.length || s.proves.some((x) => !/^R\d+$/.test(x))) return { error: '--proves takes requirement ids, as in --proves R1,R2' };
    }
    else o[a.slice(2)] = v;
  }
  return o;
}

// The scenarios brief.json names, as run.json records them: its ids, so `proves` in the brief and
// the proof records name the same scenario.
export function briefScenarios(repo) {
  const file = join(runDir(repo), 'brief.json');
  const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).scenarios || [] : [];
  return list.map((s, i) => {
    const id = s.id || `S${i + 1}`;
    if (!s.cmd && !s.text) throw new Error(`brief.json scenario ${id} has neither a \`cmd\` nor a \`text\``);
    return { id, ...(s.cmd ? { cmd: s.cmd, ...(s.expect !== undefined ? { expect: s.expect } : {}) } : { agentJudged: s.text }), ...(s.proves ? { proves: s.proves } : {}) };
  });
}

export function ciLines(repo) {
  const jobs = new Map();
  for (const c of ciCommands(repo)) {
    const k = `${c.workflow} ${c.job}`;
    const lines = c.run.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    jobs.set(k, [...(jobs.get(k) || []), (lines.length > 1 ? `[${lines.join(' ; ')}]` : lines[0] || '').slice(0, 240)]);
  }
  return [...jobs].map(([k, v]) => `  ${k}: ${v.join(' ; ')}`);
}

export function pinned(repo, asked, kept) {
  if (!asked) return kept;
  if (asked !== 'HEAD' && asked !== '@') return asked;
  return kept || git(['rev-parse', 'HEAD'], repo).trim();
}
