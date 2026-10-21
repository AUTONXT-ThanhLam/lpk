export const meta = {
  name: 'design-review',
  description: 'One round of the Design Brief review: the design critic, the plan simulator and the plan tracer read the brief at once, each fresh, and their findings come back merged and rated',
  whenToUse: 'Step 2 of the lpk skill, once per round, until a round returns no High finding',
  phases: [{ title: 'Review', detail: 'design critic, plan simulator and plan tracer at once' }],
}

// args: { repo, base, brief, briefJson, skillDir, sources, precedent, timeBound, baseSuite, round,
//   changed, stallMs }
// - brief, briefJson: paths of the Design Brief and its brief.json.
// - skillDir: the lpk skill's directory, whose step files say how the run goes.
// - sources: paths of the files the brief must trace to: the request, each linked ticket or
//   document, the owner's answers, each saved verbatim.
// - precedent: path of the `lpk precedent` output; baseSuite: the base test suite's measured time.
// - timeBound: the owner's bound on the whole run (default 45 minutes).
// - round: which round this is (1 for the first, and again after a change of approach).
// - changed: the brief's line numbers the previous revision changed; a High on one of them means
//   the design is wrong at its root. Omit it in round 1 and after a change of approach.
// - stallMs: { <angle>: ms }.
// Each angle starts fresh and is never told about earlier rounds, so a finding that comes back is
// raised again on the brief as it stands. Nothing here reads the clock or chance, so
// resumeFromRunId replays every angle that already answered.
const a = args || {}
const missing = ['repo', 'base', 'brief', 'skillDir', 'round'].filter((k) => !a[k])
if (!(a.sources || []).length) missing.push('sources')
if (missing.length) return { error: `lpk:design-review needs ${missing.join(', ')} in args` }
const round = Number(a.round)
const changed = new Set((a.changed || []).map(Number))
const bound = a.timeBound || '45 minutes'
const briefJson = a.briefJson || a.brief.replace(/[^/]*$/, 'brief.json')

const S = { type: 'string' }
const RATED = { type: 'string', enum: ['High', 'Medium', 'Low'] }
const FINDING = { type: 'object', properties: { severity: RATED, lines: { type: 'array', items: { type: 'integer' } }, claim: S, scenario: S, evidence: S, fix: S },
  required: ['severity', 'lines', 'claim', 'evidence', 'fix'] }
const FINDINGS = { type: 'array', items: FINDING }
const CRITIC = { type: 'object', properties: { findings: FINDINGS }, required: ['findings'] }
const STAGE = { type: 'object', properties: { stage: S, minutes: { type: 'number' }, basis: S }, required: ['stage', 'minutes', 'basis'] }
const SIM = { type: 'object', properties: { findings: FINDINGS, stages: { type: 'array', items: STAGE }, totalMinutes: { type: 'number' } }, required: ['findings', 'stages', 'totalMinutes'] }
const ROW = { type: 'object', properties: { source: S, sentence: S, status: { type: 'string', enum: ['kept', 'changed', 'dropped', 'added'] }, lines: { type: 'array', items: { type: 'integer' } } },
  required: ['source', 'sentence', 'status', 'lines'] }
const TRACE = { type: 'object', properties: { findings: FINDINGS, trace: { type: 'array', items: ROW } }, required: ['findings', 'trace'] }

const head = `Review the Design Brief ${a.brief} (read it with \`cat -n\`; cite its line numbers in each finding's lines) and its ${briefJson}.
Repo ${a.repo}, base branch ${a.base}. Nothing has been built yet.
Rate each finding High, Medium or Low as your instructions define them, with its evidence and the smallest change to the brief that removes it. Return no finding you could not support with evidence.`

const ANGLES = [
  { name: 'design-critic', schema: CRITIC,
    ask: `Check the brief against the code and its real behaviour, running what the design relies on.${a.precedent ? ` The \`lpk precedent\` output is in ${a.precedent}.` : ''}` },
  { name: 'plan-sim', schema: SIM,
    ask: `Walk the brief as lpk would run it. The lpk step files are in ${a.skillDir}. The owner's time bound for the whole run is ${bound}.${a.baseSuite ? ` The base test suite took ${a.baseSuite}.` : ''}` },
  { name: 'plan-trace', schema: TRACE,
    ask: `Trace the brief to its sources, each read whole:\n${a.sources.map((p) => `- ${p}`).join('\n')}` },
]

// Each angle once, and once more when it returns nothing or fails; an angle that still has no answer is
// named in `missing`, and the round does not pass without it.
const ask = async (angle) => {
  const opts = { phase: 'Review', agentType: `lpk:${angle.name}`, schema: angle.schema, stallMs: (a.stallMs || {})[angle.name] }
  const first = await agent(`${head}\n${angle.ask}`, { ...opts, label: angle.name }).catch(() => null)
  if (first) return first
  log(`${angle.name} returned no answer; running it once more`)
  return agent(`${head}\n${angle.ask}`, { ...opts, label: `${angle.name}#2` })
}
const answers = await parallel(ANGLES.map((angle) => () => ask(angle)))

const order = { High: 0, Medium: 1, Low: 2 }
const findings = ANGLES.flatMap((angle, i) => ((answers[i] || {}).findings || []).map((f) => ({
  angle: angle.name, ...f, onChanged: (f.lines || []).some((n) => changed.has(n)),
}))).sort((x, y) => order[x.severity] - order[y.severity])
const counts = { High: 0, Medium: 0, Low: 0 }
for (const f of findings) counts[f.severity]++
const absent = ANGLES.filter((_, i) => !answers[i]).map((angle) => angle.name)

// redesign: a High sits on lines the previous revision changed. revise: a High remains.
// incomplete: no High, but an angle never answered. pass: all three answered with no High.
const verdict = findings.some((f) => f.severity === 'High' && f.onChanged) ? 'redesign'
  : counts.High ? 'revise' : absent.length ? 'incomplete' : 'pass'
const sim = answers[1] || {}
const trace = (answers[2] || {}).trace || []
return {
  round,
  verdict,
  counts,
  findings,
  stages: sim.stages || [],
  totalMinutes: sim.totalMinutes ?? null,
  timeBound: bound,
  traced: trace.length,
  untraced: trace.filter((r) => r.status !== 'kept'),
  missing: absent,
}
