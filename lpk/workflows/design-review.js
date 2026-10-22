export const meta = {
  name: 'design-review',
  description: 'One round of the Design Brief review: round 1 runs five design critics (one focus each), the plan simulator and the plan tracer at once; a later round reruns only the angles whose High is still open, on the changed lines',
  whenToUse: 'Step 2 of the lpk skill, once per round, at most three rounds',
  phases: [{ title: 'Review', detail: 'the angles of this round at once' }],
}

// args: { repo, base, brief, briefJson, skillDir, sources, precedent, timeBound, baseSuite, round,
//   changed, open, stallMs }
// - brief, briefJson: paths of the Design Brief and its brief.json.
// - skillDir: the lpk skill's directory, whose step files say how the run goes.
// - sources: paths of the files the brief must trace to: the request, each linked ticket or
//   document, the owner's answers, each saved verbatim.
// - precedent: path of the `lpk precedent` output; baseSuite: the base test suite's measured time.
// - timeBound: the owner's bound on the whole run (default 45 minutes).
// - round: which round this is (1 for the first, and again after a change of approach); from round 3
//   on, a round that still has a High is the last.
// - changed: the brief's line numbers the previous revision changed; the round reviews only these and
//   what they reach, and an open High from a design focus still open on one of them means the design
//   is wrong at its root. Required from round 2 on (empty when the revision only deleted
//   lines); omitted in round 1, which is also the round after a change of approach.
// - open: the previous round's High findings as it returned them (each with its angle). Required from
//   round 2 on. Only the angles named in it run again: each checks that its Highs are closed and
//   reviews the changed lines; an angle with no open High keeps its earlier answer.
// - stallMs: { <role>: ms }, one per agent role (the five critics share design-critic's).
// Round 1 angles start fresh. A design critic's High whose evidence is only [inferred] is rated Medium, and each angle
// keeps every High and at most three other findings: a revision answers Highs only. Nothing here reads
// the clock or chance, so resumeFromRunId replays every angle that already answered.
const a = args || {}
const missing = ['repo', 'base', 'brief', 'skillDir', 'round'].filter((k) => !a[k])
if (!(a.sources || []).length) missing.push('sources')
const round = Number(a.round)
if (round >= 2 && !Array.isArray(a.changed)) missing.push('changed (the brief\'s lines the previous revision changed)')
if (round >= 2 && !Array.isArray(a.open)) missing.push('open (the previous round\'s High findings)')
if (missing.length) return { error: `lpk:design-review needs ${missing.join(', ')} in args` }
const changed = new Set((a.changed || []).map(Number))
const bound = a.timeBound || '45 minutes'
const briefJson = a.briefJson || a.brief.replace(/[^/]*$/, 'brief.json')

const S = { type: 'string' }
const RATED = { type: 'string', enum: ['High', 'Medium', 'Low'] }
const BASIS = { type: 'string', enum: ['ran', 'read', 'inferred'] }
const FINDING = { type: 'object', properties: { severity: RATED, lines: { type: 'array', items: { type: 'integer' } }, cause: S, claim: S, scenario: S, evidence: S, basis: BASIS, fix: S, stillOpen: { type: 'boolean' } },
  required: ['severity', 'lines', 'cause', 'claim', 'evidence', 'basis', 'fix'] }
const FINDINGS = { type: 'array', items: FINDING }
const CRITIC = { type: 'object', properties: { findings: FINDINGS }, required: ['findings'] }
const STAGE = { type: 'object', properties: { stage: S, minutes: { type: 'number' }, basis: S }, required: ['stage', 'minutes', 'basis'] }
const SIM = { type: 'object', properties: { findings: FINDINGS, stages: { type: 'array', items: STAGE }, totalMinutes: { type: 'number' } }, required: ['findings', 'stages', 'totalMinutes'] }
const ROW = { type: 'object', properties: { source: S, sentence: S, status: { type: 'string', enum: ['kept', 'changed', 'dropped', 'added'] }, lines: { type: 'array', items: { type: 'integer' } } },
  required: ['source', 'sentence', 'status', 'lines'] }
const TRACE = { type: 'object', properties: { findings: FINDINGS, trace: { type: 'array', items: ROW } }, required: ['findings', 'trace'] }

const scope = changed.size
  ? `Review only the brief's lines ${[...changed].sort((x, y) => x - y).join(', ')}, which were just rewritten, and what they reach: the callers, rows, states, scenarios, tests, stages and trace rows that depend on them. Leave every other line as it stands, and cite a line outside them only where a finding on them reaches it.`
  : 'Review the whole brief.'
const head = `Review the Design Brief ${a.brief} (read it with \`cat -n\`; cite its line numbers in each finding's lines) and its ${briefJson}.
Repo ${a.repo}, base branch ${a.base}. Nothing has been built yet.
${scope}
Rate each finding High, Medium or Low as your instructions define them, with its evidence and the smallest change to the brief that removes it. Return no finding you could not support with evidence. Set basis to ran (a command you ran shows it), read (a path:line you read shows it) or inferred; a design critic's inferred High counts as Medium. Return every High, and at most your three most useful Medium or Low findings: Mediums go to the builders as notes, never into a revision.
Give each finding its cause: the property of the design it breaks, worded so that every other place that could break the same property can be found from it (for example "only a document's current run may change its row", not "the reindex route raises the attempt twice").`

const FOCUS = {
  state: 'every durable value the design writes (database rows and columns, queue keys and jobs, files on disk): who writes it, is each transition guarded, and what happens when two writers, a retry, a replay, a re-delivered or late job, or a crash between two steps interleave. Separate stores share no transaction: walk each multi-step operation step by step and name the state left behind when it stops after each step.',
  failures: 'for each dependency and each new key, column or state, what happens when it is unreachable, slow, half-open, failing with an unexpected error type, garbled, unset, repeated or growing: what each route, worker and periodic pass does, what the user sees, what an anonymous caller can learn, and what is left behind. Follow every error path to where it is caught.',
  main: 'everything main accepted, served, allowed or did (in the request or in a job after it) that this design refuses, changes, delays or moves elsewhere, including its cost and latency; every entry point that reaches the changed state (routes, tools, boot, scripts, delete, restore, re-run); and every record the design creates: is it removed or resolved on every path that ends its owner?',
  proof: 'the route to proof (each scenario names the test, command or screen that shows it; each test drives the entry point its user meets, in a suite CI runs, and can fail for the property it proves); the repo\'s rules (`lpk rules --all --repo <repo>` and the team rule files it names) and any blocker in the `lpk precedent` output that the design repeats; and whether a different design is clearly more correct or less risky.',
  reuse: 'each mechanism the design builds (a loop, lock, retry, queue, poller, cache, event stream, table, script, component), including those taken from the owner\'s or the tech lead\'s design: does the repo, the public API of an installed dependency at its installed version, the standard library or the platform already do it? Read the dependency\'s types or docs where it is installed and run the replacement before you say so. Name rule `reuse-first` on each such finding.',
}
const ANGLES = [
  ...Object.entries(FOCUS).map(([focus, questions]) => ({ name: `design-critic:${focus}`, type: 'design-critic', schema: CRITIC,
    ask: `Check the brief against the code and its real behaviour, running what the design relies on.${a.precedent ? ` The \`lpk precedent\` output is in ${a.precedent}.` : ''}\nYour focus: answer only these questions, as deep as they go, and leave every other question to the other critics: ${questions}` })),
  { name: 'plan-sim', schema: SIM,
    ask: `Walk the brief as lpk would run it. The lpk step files are in ${a.skillDir}. The owner's time bound for the whole run is ${bound}.${a.baseSuite ? ` The base test suite took ${a.baseSuite}.` : ''}` },
  { name: 'plan-trace', schema: TRACE,
    ask: `Trace the brief to its sources, each read whole:\n${a.sources.map((p) => `- ${p}`).join('\n')}` },
]

// Each angle once, and once more when it returns nothing or fails; an angle that still has no answer is
// named in `missing`, and the round does not pass without it.
const ask = async (angle) => {
  const type = angle.type || angle.name
  const opts = { phase: 'Review', agentType: `lpk:${type}`, schema: angle.schema, stallMs: (a.stallMs || {})[type] }
  const first = await agent(`${head}\n${angle.ask}`, { ...opts, label: angle.name }).catch(() => null)
  if (first) return first
  log(`${angle.name} returned no answer; running it once more`)
  return agent(`${head}\n${angle.ask}`, { ...opts, label: `${angle.name}#2` })
}
const open = a.open || []
const closing = (angle) => open.filter((f) => f.angle === angle.name)
const RUN = round >= 2 ? ANGLES.filter((angle) => closing(angle).length) : ANGLES
if (!RUN.length) return { error: `lpk:design-review round ${round} has no open High naming an angle (${ANGLES.map((x) => x.name).join(', ')}); pass the previous round's High findings as it returned them` }
const closeAsk = (angle) => `\nThe previous round raised these High findings from your angle. For each, check on the brief as it stands whether it is closed, and return it again, as High with stillOpen true, only when it is not; a new finding has stillOpen false:\n${closing(angle).map((f) => `- lines ${(f.lines || []).join(', ')}: ${f.claim} (cause: ${f.cause || 'unstated'})`).join('\n')}`
const ran = await parallel(RUN.map((angle) => () => (round >= 2 ? ask({ ...angle, ask: angle.ask + closeAsk(angle) }) : ask(angle))))
const answers = ANGLES.map((angle) => (RUN.includes(angle) ? ran[RUN.indexOf(angle)] : { findings: [] }))

const order = { High: 0, Medium: 1, Low: 2 }
const rated = (f) => (f.severity === 'High' && f.basis === 'inferred' ? { ...f, severity: 'Medium', demoted: true } : f)
const kept = (angle, list) => {
  const all = (angle.type === 'design-critic' ? list.map(rated) : list).sort((x, y) => order[x.severity] - order[y.severity])
  return [...all.filter((f) => f.severity === 'High'), ...all.filter((f) => f.severity !== 'High').slice(0, 3)]
}
const findings = ANGLES.flatMap((angle, i) => kept(angle, (answers[i] || {}).findings || []).map((f) => ({
  angle: angle.name, ...f, onChanged: (f.lines || []).some((n) => changed.has(n)),
}))).sort((x, y) => order[x.severity] - order[y.severity])
const counts = { High: 0, Medium: 0, Low: 0 }
for (const f of findings) counts[f.severity]++
const absent = RUN.filter((angle) => !answers[ANGLES.indexOf(angle)]).map((angle) => angle.name)

// last: round 3 or later and a High remains. redesign: a design focus's open High is still open on
// lines the revision changed, so the fix failed where it was made. revise: a High remains, new ones on
// changed lines included. incomplete: no High, but an angle never answered.
// pass: every angle answered with no High.
const DESIGN = new Set(['state', 'failures', 'main', 'reuse'].map((focus) => `design-critic:${focus}`))
const verdict = counts.High && round >= 3 ? 'last'
  : findings.some((f) => f.severity === 'High' && f.stillOpen && f.onChanged && DESIGN.has(f.angle)) ? 'redesign'
    : counts.High ? 'revise' : absent.length ? 'incomplete' : 'pass'
const answerOf = (name) => answers[ANGLES.findIndex((angle) => angle.name === name)] || {}
const sim = answerOf('plan-sim')
const trace = answerOf('plan-trace').trace || []
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
