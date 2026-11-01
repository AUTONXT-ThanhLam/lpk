// `lpk dev escapes [--reviewer <login>]`: review comments that reached PRs lpk delivered after the run,
// joined by file to what the run changed and what its ledger held; new ones are kept in escapes.jsonl.
import { escapes, escapesFile, recordEscapes } from '../escapes.mjs';
import { capped, parseArgs, repoOf } from '../out.mjs';

const USAGE = 'usage: lpk dev escapes [--reviewer <login>] [--repo <dir> | --all]';

export async function main(argv) {
  const a = parseArgs(argv, ['--reviewer', '--repo'], ['--all']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = a.flags.has('--all') ? '' : repoOf(a.opt('--repo'));
  const reviewer = a.opt('--reviewer') || process.env.LPK_REVIEWER || '';
  let r;
  try { r = escapes({ repo, reviewer }); } catch (e) {
    console.error(`lpk: gh failed (${e.code === 'ENOENT' ? 'not installed' : String(e.stderr || e.message).trim().split('\n')[0]})`);
    return 1;
  }
  const fresh = recordEscapes(r.rows);
  const head = [`${r.rows.length} comment(s) after delivery${reviewer ? ` by ${reviewer}` : ''} on ${repo || 'every repo'}; ${fresh.length} new, kept in ${escapesFile()}`];
  const rows = r.rows.map((e) => `  ${e.repo}#${e.pr} ${e.file}${e.line ? `:${e.line}` : ''} by ${e.by} ${e.at.slice(0, 10)}: ${e.inChange ? 'file in the change' : 'file NOT in the change'}, ${e.ledgerHadFile ? 'ledger had a finding on it' : 'NO ledger finding on it'} | ${e.body.split('\n')[0].slice(0, 140)}`);
  console.log(capped(repo, 'escapes', head, [...rows, ...r.skipped.map((s) => `  skipped ${s}`)]));
  return 0;
}
