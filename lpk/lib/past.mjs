import { basename, dirname } from 'node:path';
import { readLedger } from './findings.mjs';
import { loadRules, LEARNED } from './rules.mjs';
import { ledgers } from './yield.mjs';

const REAL = ['confirmed', 'fixed', 'deferred'];
const CAP = 10;
const one = (s) => String(s || '').split('\n')[0].slice(0, 120);

export function pastFindings(repo, files) {
  if (!files.length) return [];
  const rows = [];
  for (const file of ledgers(repo).filter((f) => basename(dirname(dirname(f))) === 'runs')) {
    let findings = [];
    try { findings = readLedger(repo, file).findings; } catch { continue; }
    const run = basename(dirname(file));
    for (const f of findings) if (REAL.includes(f.state) && files.includes(f.file)) rows.push(`${run} ${f.id} ${f.state} ${f.file}:${f.line} ${one(f.claim)}`);
  }
  return rows;
}

export function pastLines(repo, files) {
  const past = pastFindings(repo, files);
  const learned = loadRules(repo).filter((r) => String(r.source).startsWith(LEARNED));
  return [
    ...(past.length ? [`past findings on these files (${past.length}${past.length > CAP ? `, last ${CAP}` : ''}):`, ...past.slice(-CAP).map((l) => `  ${l}`)] : []),
    ...(learned.length ? [`learned rules (${learned.length}; \`lpk rules --id <id>\` prints one):`, ...learned.slice(0, 15).map((r) => `  ${r.id}${r.title ? `: ${r.title}` : ''}`)] : []),
  ];
}
