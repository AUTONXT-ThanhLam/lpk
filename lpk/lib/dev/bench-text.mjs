import { capped } from '../out.mjs';
import { est } from './bench-context.mjs';

const n = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const usd = (x) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(2)}`);
const ms = (x) => (x === null || x === undefined ? 'n/a' : `${(x / 1000).toFixed(1)}s`);

export function render(out, repo) {
  const head = [`bench: ${out.runs.distinct} distinct runs of ${out.runs.recorded} rows in runs.jsonl (${out.runs.snapshotRowsCollapsed} snapshot rows folded; ${Object.entries(out.runs.lanes).map(([k, v]) => `${k} ${v}`).join(', ')}); ledgers on disk for ${out.runs.withLedger} runs, absent for ${out.runs.withoutLedger}; transcripts of ${out.runs.withTranscripts} runs`];
  const lensRows = ['lens | raised | fixed | confirmed | dropped | dup | preexist | uniq | tokens fixed | fresh tokens | cache reads | USD | wall'];
  for (const l of out.lenses) lensRows.push(`  ${l.lens} | ${l.raised} | ${l.fixed} | ${l.confirmed} | ${l.dropped} | ${l.duplicate} | ${l.preexisting} | ${l.unique} | ${n(l.tokensPerFixed)} | ${n(l.fresh)} | ${n(l.cacheRead)} | ${usd(l.usd)} | ${ms(l.ms)}`);
  const tk = out.tokens;
  const tokenRows = tk.inRuns ? [
    `  tokens spent inside the run windows: fresh ${n(tk.inRuns.fresh)}, cache reads ${n(tk.inRuns.cacheRead)}, ${usd(tk.inRuns.usd)}${tk.inRuns.unpriced ? ` (${n(tk.inRuns.unpriced)} messages of a model with no price)` : ''}`,
    `  tokens spent outside the run windows (before, between, after): fresh ${n(tk.outsideRuns.fresh)}, cache reads ${n(tk.outsideRuns.cacheRead)}, ${usd(tk.outsideRuns.usd)}${tk.outsideRuns.unpriced ? ` (${n(tk.outsideRuns.unpriced)} messages of a model with no price)` : ''}`,
    '  USD is list price per model and token kind (cache writes 1.25x, or 2x when held an hour); a row with a model whose price is unknown, and a CLI lens run, shows n/a',
  ] : [`  ${tk.note}`];
  const hostRows = out.hosts.map((h) => `  host ${h.host}: ${h.ofTheseRuns ?? 0} of these runs' sessions, ${h.agents ?? 0} transcript(s) read; fresh tokens ${h.tokensAvailable ? n(h.fresh) : 'UNAVAILABLE (SKIPPED)'}, cache reads ${h.tokensAvailable ? n(h.cacheRead) : 'SKIPPED'}. ${h.note}`);
  const cliRows = ['  CLI lens runs (from the records, the only cost a headless child leaves):', ...out.cliLensRuns.map((c) => `  ${c.lens}: ${c.runs} runs, ${c.findingsReturned} findings returned, ${c.exitNonzero} nonzero exit, ${ms(c.ms)} wall, fresh ${n(c.fresh)}, cache reads ${n(c.cacheRead)}`)];
  const wallRows = ['  wall, longest runs first (critical path vs the sum of the lenses in it):', ...[...out.wall.runs].sort((x, y) => (y.criticalPathMs || 0) - (x.criticalPathMs || 0)).slice(0, 12).map((r) => `  ${r.id} ${r.repo} [${r.lane}] ledger:${r.ledger}: run wall ${ms(r.wallMs)} (owner idle ${ms(r.ownerIdleMs)}, working ${ms(r.workingMs)}), critical path ${ms(r.criticalPathMs)}, lens sum ${ms(r.lensMsSum)}, long pole ${r.longPole || 'n/a'}, findings ${r.findings} fixed ${r.fixed}`)];
  const bornRows = [
    '  where defects were born (the spend that follows: request+design is cheaper to fix than build+fix):',
    `  ${out.born.note}`,
    ...(out.born.ruled ? [`  before the build (request, design): ${['request', 'design'].reduce((x, k) => x + (out.born.counts[k] || 0), 0)}, in it or after (build, fix): ${['build', 'fix'].reduce((x, k) => x + (out.born.counts[k] || 0), 0)}`] : []),
  ];
  const ctx = out.context;
  const ctxRows = [
    '  always-on context (bytes, token estimate at 4 bytes/token):',
    `  resident: skill descriptions ${n(ctx.skillDescriptionBytes)} B / ~${n(est(ctx.skillDescriptionBytes))} tok across ${ctx.resident.skills.length} skill(s); agent descriptions ${n(ctx.agentDescriptionBytes)} B / ~${n(est(ctx.agentDescriptionBytes))} tok across ${ctx.resident.agents.length} agent(s); hooks.json ${n(ctx.hooksJsonBytes)} B; plugin.json ${n(ctx.pluginJsonBytes)} B`,
    `  only on invoke: skill bodies ${n(ctx.onInvoke.skillBodies)} B / ~${n(est(ctx.onInvoke.skillBodies))} tok, agent bodies ${n(ctx.onInvoke.agentBodies)} B / ~${n(est(ctx.onInvoke.agentBodies))} tok`,
    `  measured in the scanned sessions' main transcripts: hook advice ${n(ctx.measured.adviceLines)} lines ${n(ctx.measured.adviceBytes)} B, skill injections ${n(ctx.measured.skillInjectLines)} lines ${n(ctx.measured.skillInjectBytes)} B over ${n(ctx.measured.mainTranscriptBytes)} B of main transcript`,
  ];
  console.log(capped(repo, 'bench', head, [
    ...hostRows, ...tokenRows, '', 'yield and cost per lens:', ...lensRows, ...cliRows, '', ...bornRows, '', ...wallRows, ...ctxRows,
    ...(out.missing.ledger.length ? ['', `ledgers not on disk (${out.missing.ledger.length}):`, ...out.missing.ledger.map((x) => `  ${x}`)] : []),
    ...(out.runs.unrecordedLedgers.length ? ['', `ledgers with no run row (${out.runs.unrecordedLedgers.length}), so not counted above:`, ...out.runs.unrecordedLedgers.map((x) => `  ${x.run}: ${x.findings} findings, ${x.fixed} fixed`)] : []),
  ]));
}
