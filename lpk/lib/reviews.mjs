// The tech lead's past review comments for a repo, fetched from GitHub and kept as JSON lines,
// and the ones that sit on the files a change touches. Fetching and matching paths are exact;
// what a comment means is the agent's call.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { git } from './git.mjs';

export const REVIEWS = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lpk', 'reviews');

// `owner/name` of the repo on GitHub: `git config lpk.slug` when set (a mirror or a clone whose
// origin is elsewhere), else origin's URL; '' when neither names one.
export function slugOf(repo) {
  const set = git(['config', 'lpk.slug'], repo).trim();
  if (set) return set;
  const url = git(['remote', 'get-url', 'origin'], repo).trim();
  return url.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)?.[1] || '';
}

const fileOf = (slug) => join(REVIEWS, `${slug.replace('/', '__')}.jsonl`);
const gh = (args) => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })).flat();

export function readReviews(slug) {
  const f = fileOf(slug);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Appends the reviewer's inline comments and review bodies made since the last fetch.
export function fetchReviews(repo, reviewer) {
  const slug = slugOf(repo);
  if (!slug) return { error: 'the repo has no GitHub origin' };
  mkdirSync(REVIEWS, { recursive: true });
  const cursorFile = `${fileOf(slug)}.${reviewer.replace(/[^\w.-]/g, '_')}.since`;
  const since = existsSync(cursorFile) ? readFileSync(cursorFile, 'utf8').trim() : '2000-01-01T00:00:00Z';
  const now = new Date().toISOString();
  const stored = readReviews(slug);
  const known = new Set(stored.map((c) => c.id));
  const mine = new Set();
  // Each batch is kept as it arrives, so a fetch cut short keeps what it read; the next one skips it.
  const fresh = [];
  const save = (items) => { if (items.length) appendFileSync(fileOf(slug), items.map((c) => `${JSON.stringify(c)}\n`).join('')); fresh.push(...items); };
  const inline = [];
  for (const c of gh([`repos/${slug}/pulls/comments?since=${since}&per_page=100`]))
    if (c.user?.login === reviewer && (mine.add(c.id), !known.has(c.id)))
      inline.push({ id: c.id, pr: Number(c.pull_request_url.split('/').pop()), url: c.html_url, path: c.path, line: c.line ?? c.original_line, hunk: (c.diff_hunk || '').split('\n').slice(-6).join('\n'), body: c.body, author: reviewer, at: c.created_at });
  save(inline);
  // Pull requests newest-updated first, page by page, until one was last updated before `since`.
  const prs = [];
  for (let page = 1; ; page++) {
    const batch = JSON.parse(execFileSync('gh', ['api', `repos/${slug}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }));
    prs.push(...batch.filter((p) => p.updated_at >= since).map((p) => p.number));
    if (batch.length < 100 || batch.some((p) => p.updated_at < since)) break;
  }
  prs.forEach((n, k) => {
    if (k % 50 === 0) process.stderr.write(`lpk: reading reviews of ${prs.length} pull requests on ${slug}: ${k} done\n`);
    save(gh([`repos/${slug}/pulls/${n}/reviews?per_page=100`]).filter((r) => r.user?.login === reviewer && r.body?.trim() && (mine.add(r.id), !known.has(r.id)))
      .map((r) => ({ id: r.id, pr: n, url: r.html_url, path: '', line: null, hunk: '', body: r.body, author: reviewer, state: r.state, at: r.submitted_at })));
  });
  if (stored.some((c) => !c.author && mine.has(c.id))) writeFileSync(fileOf(slug), readReviews(slug).map((c) => `${JSON.stringify(!c.author && mine.has(c.id) ? { ...c, author: reviewer } : c)}\n`).join(''));
  writeFileSync(cursorFile, now);
  return { slug, fresh, total: known.size + fresh.length, file: fileOf(slug) };
}

// Past comments on these paths, then on other files in the same directories.
export function precedent(repo, paths) {
  const slug = slugOf(repo);
  const all = slug ? readReviews(slug) : [];
  const same = all.filter((c) => paths.includes(c.path));
  const dirs = new Set(paths.map((p) => dirname(p)));
  const near = all.filter((c) => c.path && !paths.includes(c.path) && (dirs.has(dirname(c.path)) || paths.some((p) => basename(p) === basename(c.path))));
  return { slug, count: all.length, same, near };
}
