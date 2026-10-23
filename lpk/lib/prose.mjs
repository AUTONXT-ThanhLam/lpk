import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMENT, diffLines } from './floor.mjs';
import { CODE } from './rules.mjs';

const REACH = 3;
const PER_FILE = 10;
const TOTAL = 40;

export function proseBeside(repo, base) {
  const out = [];
  let total = 0;
  for (const f of diffLines(repo, base)) {
    if (!CODE.test(f.path)) continue;
    let text;
    try { text = readFileSync(join(repo, f.path), 'utf8').split('\n'); } catch { continue; }
    const changed = new Set(f.lines.filter((l) => l.side === '+').map((l) => l.n));
    const anchors = new Set(f.lines.map((l) => l.n));
    const near = new Set();
    for (const n of anchors) for (let k = n - REACH; k <= n + REACH; k++) if (k >= 1 && k <= text.length && !changed.has(k) && COMMENT.test(text[k - 1])) near.add(k);
    const sorted = [...near].sort((a, b) => a - b);
    for (const k of sorted.slice(0, Math.min(PER_FILE, TOTAL - total))) out.push(`  ${f.path}:${k}  ${text[k - 1].trim()}`);
    total += Math.min(sorted.length, PER_FILE, TOTAL - total);
    if (sorted.length > PER_FILE) out.push(`  ${f.path}: ${sorted.length - PER_FILE} more`);
  }
  if (!out.length) return [];
  return ['', `comment lines this change left unedited within ${REACH} lines of a changed line; each says something about the code beside it, so check its words still hold:`, ...out];
}
