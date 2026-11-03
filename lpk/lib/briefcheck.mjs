import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designRounds } from './phase.mjs';
import { readDecisions, waived } from './records.mjs';
import { readRun, runDir } from './run.mjs';

const PASSED = new Set(['pass', 'last']);

const KEYS = ['surface', 'entry', 'leaves'];
function withoutSurface(text) {
  try {
    const brief = JSON.parse(text);
    if (!Array.isArray(brief?.scenarios)) return text;
    return JSON.stringify({ ...brief, scenarios: brief.scenarios.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !KEYS.includes(k)))) });
  } catch { return text; }
}

export function briefHash(repo, run, { raw = false } = {}) {
  const open = runDir(repo);
  const dir = open && run && readRun(repo)?.id !== run.id ? join(open, 'runs', run.id) : open;
  const parts = dir ? ['brief.md', 'brief.json'].map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null)) : [];
  if (!raw && parts[1] !== null && parts[1] !== undefined) parts[1] = withoutSurface(parts[1]);
  if (parts.every((p) => p === null) || !parts.length) return null;
  return createHash('sha256').update(parts.map((p) => p ?? '').join('\0')).digest('hex').slice(0, 12);
}

export function briefUnchecked(repo, run, { go = true } = {}) {
  const now = run.lane === 'full' ? briefHash(repo, run) : null;
  if (!now || (go && waived(repo, run.id, 'gate:brief-check'))) return null;
  const rounds = designRounds(readDecisions(repo).filter((d) => d.run === run.id || d.run === null));
  const before = briefHash(repo, run, { raw: true });
  if (rounds.some((r) => PASSED.has(r.verdict.toLowerCase()) && (r.brief === now || r.brief === before))) return null;
  const last = rounds.at(-1);
  const seen = last ? `the last round (${last.round}: ${last.verdict}) ${last.brief && last.brief !== now ? 'was recorded before the brief changed after it' : 'did not pass'}` : 'no round is recorded';
  const round = 'Run the design review on it (`design.md`) and record the round with `lpk decide "design review round <n>: pass, <High>/<Medium>/<Low>"`';
  return `the Design Brief has not passed a design review round as it stands (${seen}). ${round}${go ? ', then run `lpk go`; or, when no round can be run, the lead waives it: `lpk waive gate:brief-check --why "<why>"`.' : '.'}`;
}
