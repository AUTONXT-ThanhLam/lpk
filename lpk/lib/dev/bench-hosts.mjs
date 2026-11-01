import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { configCandidates, slugOf, TOKENS_UNMEASURED } from '../host.mjs';
import { meter, sessionFiles, total } from '../meter.mjs';

export function readStores(runs, skipTranscripts) {
  const hostsOut = [];
  const stores = [];
  // Every store the machine names is reported, including one that holds none of these runs: its
  // verdict on tokens is measured from its own transcripts of the same projects, so a SKIPPED row is a
  // finding, not an absence.
  const runSessions = [...new Set(runs.map((r) => r.session).filter(Boolean))];
  const known = runSessions.map((s) => ({ session: s, where: sessionFiles(s), rows: (() => { try { return meter(s); } catch { return null; } })() })).filter((x) => x.where && x.rows);
  const slugs = new Set(runs.map((r) => r.path).filter(Boolean).map((p) => slugOf(p)));
  for (const c of configCandidates()) {
    const projects = join(c.dir, 'projects');
    if (!existsSync(projects)) { hostsOut.push({ host: c.host, root: projects, sessions: [], transcripts: [], fresh: null, cacheRead: null, tokensAvailable: null, note: 'no transcript store on this machine' }); continue; }
    const mine = known.filter((x) => (x.where.host || '') === c.host);
    const others = [...new Set([...slugs].flatMap((slug) => { try { return readdirSync(join(projects, slug)); } catch { return []; } }))].filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
    const extra = others.slice(0, 4).filter((s) => !mine.some((x) => x.session === s))
      .map((s) => ({ session: s, where: sessionFiles(s, [projects]), rows: (() => { try { return meter(s, [projects]); } catch { return null; } })() }))
      .filter((x) => x.where && x.rows);
    const sample = mine.length ? mine : extra;
    const t = total(sample.flatMap((x) => x.rows));
    hostsOut.push({
      host: c.host, root: projects, ofTheseRuns: mine.length, sessions: sample.map((x) => x.session),
      projectFoldersWithTranscripts: [...slugs].filter((slug) => existsSync(join(projects, slug))).length,
      agents: sample.reduce((x, s) => x + s.rows.length, 0),
      transcripts: sample.flatMap((x) => x.rows.map((r) => ({ agent: r.agent, host: r.host, recorded: r.recorded, fresh: r.recorded ? r.fresh : null, cacheRead: r.recorded ? r.cacheRead : null }))),
      fresh: t.recorded ? t.fresh : null, cacheRead: t.recorded ? t.cacheRead : null,
      tokensAvailable: t.recorded,
      note: t.recorded ? '' : `SKIPPED for cost: ${TOKENS_UNMEASURED} (no usage count in the sampled transcripts is above 0, so a token figure for its runs is unavailable, not 0)${mine.length ? '' : '; no lpk run row names a session in this store'}`,
    });
    if (!t.recorded || skipTranscripts) continue;
    stores.push({ host: c.host, sessions: mine });
  }
  return { hostsOut, stores, known };
}
