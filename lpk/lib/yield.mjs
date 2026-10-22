import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { idsOf, LEARNED_AST, ruleFiles } from './ast.mjs';
import { readLedger } from './findings.mjs';
import { checkout, runDir } from './where.mjs';

const COLS = ['confirmed', 'fixed', 'deferred', 'dropped', 'duplicate', 'preexisting', 'open'];
const ls = (dir) => { try { return readdirSync(dir); } catch { return []; } };

function ledgers(repo) {
  const at = checkout(repo);
  if (!at) return [];
  const dirs = new Set([runDir(repo), join(at.common, 'lpk'), ...ls(join(at.common, 'worktrees')).map((w) => join(at.common, 'worktrees', w, 'lpk'))]);
  return [...dirs].flatMap((d) => [
    ...(existsSync(join(d, 'findings.jsonl')) ? [join(d, 'findings.jsonl')] : []),
    ...ls(join(d, 'runs')).flatMap((r) => ls(join(d, 'runs', r)).filter((n) => /^findings(\.\d+)?\.jsonl$/.test(n)).map((n) => join(d, 'runs', r, n))),
  ]);
}

export function ruleYield(repo) {
  const learned = new Set(ruleFiles(LEARNED_AST).flatMap(idsOf));
  const rows = new Map([...learned].map((id) => [id, Object.fromEntries(COLS.map((c) => [c, 0]))]));
  const unreadable = [];
  const files = ledgers(repo);
  for (const file of files) {
    let findings = [];
    try { findings = readLedger(repo, file).findings; } catch (e) { unreadable.push(e.message); continue; }
    for (const f of findings) {
      if (!f.ruleId) continue;
      if (!rows.has(f.ruleId)) rows.set(f.ruleId, Object.fromEntries(COLS.map((c) => [c, 0])));
      rows.get(f.ruleId)[COLS.includes(f.state) ? f.state : 'open'] += 1;
    }
  }
  const prune = [...rows].filter(([id, r]) => learned.has(id) && r.dropped >= 3 && !r.confirmed && !r.fixed && !r.deferred).map(([id]) => id);
  return { rows, learned, prune, ledgers: files.length, unreadable };
}

export function yieldText(repo) {
  const y = ruleYield(repo);
  const w = Math.max(4, ...[...y.rows.keys()].map((id) => id.length));
  return [
    `Findings that cite a rule, by state, from ${y.ledgers} run ledger(s) of ${repo}. "learned ast" marks a rule with a pattern in ${LEARNED_AST}.`,
    `${'rule'.padEnd(w)}  ${COLS.join('  ')}  learned ast`,
    ...[...y.rows].sort(([a], [b]) => a.localeCompare(b)).map(([id, r]) => `${id.padEnd(w)}  ${COLS.map((c) => String(r[c]).padStart(c.length)).join('  ')}  ${y.learned.has(id) ? 'yes' : ''}`),
    '',
    `prune (learned ast rules with 3 or more dropped and none confirmed, fixed or deferred): ${y.prune.join(', ') || 'none'}`,
    ...y.unreadable.map((u) => `unreadable: ${u}`),
  ].join('\n');
}

function moveInto(from, dir) {
  mkdirSync(dir, { recursive: true });
  const name = basename(from);
  let to = join(dir, name);
  for (let n = 1; existsSync(to); n += 1) to = join(dir, name.replace(/(\.ya?ml)$/, `.${n}$1`));
  renameSync(from, to);
  return to;
}

export function pruneText(repo) {
  const y = ruleYield(repo);
  if (!y.prune.length) return 'lpk rules --prune: no learned ast rule has 3 or more dropped findings and none confirmed, fixed or deferred.';
  const moved = [];
  for (const id of y.prune) {
    for (const f of ruleFiles(LEARNED_AST).filter((x) => idsOf(x).includes(id))) moved.push(`${f} -> ${moveInto(f, join(LEARNED_AST, 'disabled'))}`);
    for (const ext of ['yml', 'yaml']) {
      const t = join(LEARNED_AST, 'tests', `${id}-test.${ext}`);
      if (existsSync(t)) moved.push(`${t} -> ${moveInto(t, join(LEARNED_AST, 'disabled', 'tests'))}`);
    }
  }
  return ['lpk rules --prune: moved to disabled/ (no longer scanned or tested):', ...moved.map((m) => `  ${m}`)].join('\n');
}
