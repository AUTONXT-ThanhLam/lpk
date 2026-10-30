import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { waived } from './records.mjs';
import { promptsOf } from './run.mjs';

const FIELDS = 'number,url,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName';
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const gh = (args, cwd) => JSON.parse(execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || 'null');

export function runPrs(repo, run) {
  const found = new Map();
  const errors = [];
  const take = (list) => { for (const p of list || []) found.set(p.url, p); };
  for (const b of run.branches || []) {
    try { take(gh(['pr', 'list', '--head', b, '--state', 'open', '--json', FIELDS], repo)); } catch (e) { errors.push(`${b}: ${String(e.stderr || e.message).trim()}`); }
  }
  const file = promptsOf(run.marker);
  const said = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const url of new Set(said.match(PR_URL) || [])) {
    if (found.has(url)) continue;
    try { take([gh(['pr', 'view', url, '--json', FIELDS], repo)]); } catch (e) { errors.push(`${url}: ${String(e.stderr || e.message).trim()}`); }
  }
  return { prs: [...found.values()], errors };
}

export const prLine = (p) => `${p.url}: ${p.state === 'OPEN' ? (p.isDraft ? 'draft' : 'ready') : p.state.toLowerCase()}, mergeable ${p.mergeable}, ${p.mergeStateStatus === 'BEHIND' ? `behind ${p.baseRefName}` : `not behind ${p.baseRefName}`}`;

export function prBlocks(prs, run) {
  const out = [];
  for (const p of prs) {
    if (p.state !== 'OPEN') continue;
    if (p.mergeable === 'CONFLICTING') out.push({ pr: p, why: `it conflicts with ${p.baseRefName}` });
    else if (p.isDraft && run.granted?.ready) out.push({ pr: p, why: 'it is still a draft, and the owner asked for it ready' });
  }
  return out;
}

export const prWaiver = (p) => `pr:${p.url}`;
export const unwaived = (repo, run, blocks) => blocks.filter((b) => !waived(repo, run.id, prWaiver(b.pr)));
