import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designRounds } from './phase.mjs';
import { readDecisions, waived } from './records.mjs';
import { runDir } from './run.mjs';

const PASSED = new Set(['pass', 'last']);

export function briefHash(repo) {
  const dir = runDir(repo);
  const parts = dir ? ['brief.md', 'brief.json'].map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null)) : [];
  if (parts.every((p) => p === null) || !parts.length) return null;
  return createHash('sha256').update(parts.map((p) => p ?? '').join('\0')).digest('hex').slice(0, 12);
}

export function briefUnchecked(repo, run) {
  const now = run.lane === 'full' ? briefHash(repo) : null;
  if (!now || waived(repo, run.id, 'gate:brief-check')) return null;
  const rounds = designRounds(readDecisions(repo).filter((d) => d.run === run.id || d.run === null));
  if (rounds.some((r) => PASSED.has(r.verdict.toLowerCase()) && r.brief === now)) return null;
  const last = rounds.at(-1);
  const seen = last ? `the last round (${last.round}: ${last.verdict}) ${last.brief && last.brief !== now ? 'was recorded before the brief changed after it' : 'did not pass'}` : 'no round is recorded';
  return `the Design Brief has not passed a design review round as it stands (${seen}). Run the design review on it (\`design.md\`), record the round with \`lpk decide "design review round <n>: pass, <High>/<Medium>/<Low>"\`, then run \`lpk go\`; or the owner waives it (option \`gate:brief-check\`).`;
}
