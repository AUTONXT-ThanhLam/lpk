// The team's own rule files for a change: the instruction files at the repo root, in each folder
// the change touches and in the superproject a submodule sits in, plus the markdown they link to.
// Which rule in them matters to the change is the agent's call.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { superproject } from './git.mjs';

const ROOT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', '.github/copilot-instructions.md'];
const FOLDER_FILES = ['CLAUDE.md', 'AGENTS.md'];
const LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const MAX = 60;

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Relative links in one file that land on a markdown file or folder inside `root`; a folder
// stands for the markdown files directly in it. Each comes with the line that links it.
function linked(file, root) {
  const out = [];
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(LINK)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z][\w+.-]*:/i.test(target)) continue;
    let path = target;
    try { path = decodeURI(target); } catch { /* a bare % is part of the name */ }
    const abs = resolve(dirname(file), path);
    if (relative(root, abs).startsWith('..')) continue;
    const at = text.slice(text.lastIndexOf('\n', m.index) + 1).split('\n')[0].trim();
    if (/\.md$/i.test(abs) && isFile(abs)) out.push({ abs, at });
    else if (isDir(abs)) for (const n of readdirSync(abs).sort()) if (/\.md$/i.test(n) && isFile(join(abs, n))) out.push({ abs: join(abs, n), at });
  }
  return out;
}

// Every folder from the root down to each changed path, the root first.
function folders(paths) {
  const set = new Set(['']);
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }
  return [...set].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

// Names a rule file can use for this change: the checkout's folder name and each changed path
// with its file name, so a file that names one is about this change.
function namesOf(checkout, changed) {
  const names = new Set([basename(checkout)]);
  for (const p of changed) { names.add(p); if (basename(p).length >= 6) names.add(basename(p)); }
  return [...names];
}

// Each file once, with where it came from, the line that links it and the change's names it
// mentions: paths in `repo` relative to it, others absolute. `changed` are relative to `repo`.
export function teamFiles(repo, changed = []) {
  const seen = new Map();
  const add = (abs, from, at = '') => { if (!seen.has(abs) && isFile(abs)) seen.set(abs, { from, at: at.slice(0, 120) }); };
  const roots = [{ root: repo, paths: changed }];
  const { sup, checkout } = superproject(repo);
  if (sup) roots.push({ root: sup, paths: [relative(sup, checkout)] });
  for (const { root, paths } of roots) {
    const own = [];
    for (const f of ROOT_FILES) own.push(join(root, f));
    for (const d of folders(paths).slice(1)) for (const f of FOLDER_FILES) own.push(join(root, d, f));
    for (const f of own.filter(isFile)) add(f, '');
    // Links are followed from the files written for agents; CONTRIBUTING links out to translations and policies.
    for (const f of own.filter((x) => isFile(x) && !/CONTRIBUTING\.md$/.test(x))) for (const l of linked(f, root)) add(l.abs, `linked from ${show(repo, f)}`, l.at);
  }
  const names = namesOf(checkout, changed);
  const all = [...seen].map(([abs, { from, at }]) => {
    const text = readFileSync(abs, 'utf8');
    return { path: show(repo, abs), lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), from, at, names: names.filter((n) => text.includes(n)).slice(0, 4) };
  });
  return { files: all.slice(0, MAX), more: Math.max(0, all.length - MAX) };
}

const show = (repo, abs) => (relative(repo, abs).startsWith('..') ? abs : relative(repo, abs));
