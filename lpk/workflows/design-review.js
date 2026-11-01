export const meta = {
  name: 'design-review',
  description: 'One round of the Design Brief review: one design critic checks the whole brief on seven focuses; a later round checks that its open Highs are closed, on the changed lines',
  whenToUse: 'Step 2 of the lpk skill, once per round, at most three rounds',
  phases: [{ title: 'Review', detail: 'the angles of this round at once' }],
}

// args: { repo, base, brief, briefJson, sources, precedent, words, round, changed, open, coverage, stallMs }
// - brief, briefJson: paths of the Design Brief and its brief.json.
// - sources: paths of the files the brief must trace to: the request, each linked ticket or
//   document, the owner's answers, each saved verbatim.
// - precedent: path of the `lpk precedent` output.
// - round: which round this is (1 for the first, and again after a change of approach); from round 3
//   on, a round that still has a High is the last.
// - changed: the brief's line numbers the previous revision changed; the round reviews only these and
//   what they reach, and an open High still open on one of them means the design is wrong at its root. Required from round 2 on (empty when the revision only deleted
//   lines); omitted in round 1, which is also the round after a change of approach.
// - open: the previous round's High findings as it returned them. Required from round 2 on: the critic
//   checks that they are closed and reviews the changed lines.
// - stallMs: { <role>: ms }; design-critic's applies.
// Round 1 starts fresh. A High whose evidence is only [inferred] is rated Medium, and the critic keeps
// every High and at most three other findings: a revision answers Highs only. Nothing here reads the
// clock or chance, so resumeFromRunId replays an answer already given.
const a = args || {}
const BRIEF_WORDS = 5000
const missing = ['repo', 'base', 'brief', 'round', 'words'].filter((k) => !a[k])
if (!(a.sources || []).length) missing.push('sources')
const round = Number(a.round)
if (round >= 2 && !Array.isArray(a.changed)) missing.push('changed (the brief\'s lines the previous revision changed)')
if (round >= 2 && !Array.isArray(a.open)) missing.push('open (the previous round\'s High findings)')
if (missing.length) return { error: `lpk:design-review needs ${missing.join(', ')} in args` }
if (Number(a.words) > BRIEF_WORDS) return { error: `lpk:design-review: the brief has ${a.words} words (wc -w); cut it to ${BRIEF_WORDS} or fewer before the round` }
const changed = new Set((a.changed || []).map(Number))
const briefJson = a.briefJson || a.brief.replace(/[^/]*$/, 'brief.json')

const S = { type: 'string' }
const RATED = { type: 'string', enum: ['High', 'Medium', 'Low'] }
const BASIS = { type: 'string', enum: ['ran', 'read', 'inferred'] }
const FINDING = { type: 'object', properties: { severity: RATED, lines: { type: 'array', items: { type: 'integer' } }, cause: S, claim: S, scenario: S, evidence: S, basis: BASIS, fix: S, stillOpen: { type: 'boolean' } },
  required: ['severity', 'lines', 'cause', 'claim', 'evidence', 'basis', 'fix'] }
const FINDINGS = { type: 'array', items: FINDING }
const CRITIC = { type: 'object', properties: { findings: FINDINGS }, required: ['findings'] }

const scope = changed.size
  ? `Review only the brief's lines ${[...changed].sort((x, y) => x - y).join(', ')}, which were just rewritten, and what they reach: the callers, rows, states, scenarios, tests, stages and trace rows that depend on them. Leave every other line as it stands, and cite a line outside them only where a finding on them reaches it.`
  : 'Review the whole brief.'
const head = `Review the Design Brief ${a.brief} (read it with \`cat -n\`; cite its line numbers in each finding's lines) and its ${briefJson}.
Repo ${a.repo}, base branch ${a.base}. Nothing has been built yet.
${scope}
Rate each finding High, Medium or Low as your instructions define them, with its evidence and the smallest change to the brief that removes it. Return no finding you could not support with evidence. Set basis to ran (a command you ran shows it), read (a path:line you read shows it) or inferred; an inferred High counts as Medium. Return every High, and at most your three most useful Medium or Low findings: Mediums go to the builders as notes, never into a revision.
Give each finding its cause: the property of the design it breaks, worded so that every other place that could break the same property can be found from it (for example "only a document's current run may change its row", not "the reindex route raises the attempt twice").`

const FOCUS = {
  state: 'every durable value the design writes (database rows and columns, queue keys and jobs, files on disk): who writes it, is each transition guarded, and what happens when two writers, a retry, a replay, a re-delivered or late job, or a crash between two steps interleave. Separate stores share no transaction: walk each multi-step operation step by step and name the state left behind when it stops after each step.',
  failures: 'for each dependency and each new key, column or state, what happens when it is unreachable, slow, half-open, failing with an unexpected error type, garbled, unset, repeated or growing: what each route, worker and periodic pass does, what the user sees, what an anonymous caller can learn, and what is left behind. Follow every error path to where it is caught.',
  main: 'everything main accepted, served, allowed or did (in the request or in a job after it) that this design refuses, changes, delays or moves elsewhere, including its cost and latency; every entry point that reaches the changed state (routes, tools, boot, scripts, delete, restore, re-run); and every record the design creates: is it removed or resolved on every path that ends its owner?',
  proof: 'the route to proof (each scenario names the test, command or screen that shows it; each test drives the entry point its user meets, in a suite CI runs, and can fail for the property it proves); the repo\'s rules (`lpk rules --all --repo <repo>` and the team rule files it names) and any blocker in the `lpk precedent` output that the design repeats; and whether a different design is clearly more correct or less risky.',
  sources: `every sentence of the request, the tickets and documents it links and the owner's answers, each read whole (${a.sources.join(', ')}): which requirement or scenario carries it; list what the brief drops, changes or adds without a source.${a.coverage ? ` The brief's scenario and failure rows prove none of these requirement ids (a fact, not a finding: do not spend a finding on it; check that the brief's other rows are right): ${a.coverage.split('\n').filter(Boolean).join(', ')}.` : ''}`,
  reuse: 'each mechanism the design builds (a loop, lock, retry, queue, poller, cache, event stream, table, script, component), including those taken from the owner\'s or the tech lead\'s design: does the repo, the public API of an installed dependency at its installed version, the standard library or the platform already do it? Read the dependency\'s types or docs where it is installed and run the replacement before you say so. Name rule `reuse-first` on each such finding.',
  unsaid: 'each thing the builder must decide that the brief does not: who writes each file, row and value, the key of each cache or lock, each flag and default, each name two parts must agree on, the unit and the empty, missing or repeated input of each field, and each "the X" the brief uses without saying which X when there are two. List each as a question the brief should answer, with the line that leaves it open and the two readings a builder could take.'
}
const critic = { name: 'design-critic', type: 'design-critic', schema: CRITIC,
  ask: `Check the brief against the code and its real behaviour, running what the design relies on.${a.precedent ? ` The \`lpk precedent\` output is in ${a.precedent}.` : ''}\nYour focuses, each answered as deep as it goes:\n${Object.entries(FOCUS).map(([focus, questions]) => `- ${focus}: ${questions}`).join('\n')}` }

// The critic once, and once more when it returns nothing or fails; with no answer it is named in
// `missing`, and the round does not pass without it.
const ask = async (angle) => {
  const opts = { phase: 'Review', agentType: `lpk:${angle.type}`, schema: angle.schema, stallMs: (a.stallMs || {})[angle.type] }
  const first = await agent(`${head}\n${angle.ask}`, { ...opts, label: angle.name }).catch(() => null)
  if (first) return first
  log(`${angle.name} returned no answer; running it once more`)
  return agent(`${head}\n${angle.ask}`, { ...opts, label: `${angle.name}#2` })
}
const open = a.open || []
const closeAsk = `\nThe previous round raised these High findings. For each, check on the brief as it stands whether it is closed, and return it again, as High with stillOpen true, only when it is not; a new finding has stillOpen false:\n${open.map((f) => `- lines ${(f.lines || []).join(', ')}: ${f.claim} (cause: ${f.cause || 'unstated'})`).join('\n')}`
if (round >= 2 && !open.length) return { error: `lpk:design-review round ${round} has no open High; pass the previous round's High findings as it returned them` }
const answer = await ask(round >= 2 ? { ...critic, ask: critic.ask + closeAsk } : critic)

const order = { High: 0, Medium: 1, Low: 2 }
const rated = (f) => (f.severity === 'High' && f.basis === 'inferred' ? { ...f, severity: 'Medium', demoted: true } : f)
const all = ((answer || {}).findings || []).map(rated).sort((x, y) => order[x.severity] - order[y.severity])
const findings = [...all.filter((f) => f.severity === 'High'), ...all.filter((f) => f.severity !== 'High').slice(0, 3)]
  .map((f) => ({ angle: critic.name, ...f, onChanged: (f.lines || []).some((n) => changed.has(n)) }))
const counts = { High: 0, Medium: 0, Low: 0 }
for (const f of findings) counts[f.severity]++
const absent = answer ? [] : [critic.name]

// last: round 3 or later and a High remains. redesign: an open High is still open on lines the revision
// changed, so the fix failed where it was made. revise: a High remains, new ones on changed lines
// included. incomplete: no High, but the critic never answered. pass: it answered with no High.
const verdict = counts.High && round >= 3 ? 'last'
  : findings.some((f) => f.severity === 'High' && f.stillOpen && f.onChanged) ? 'redesign'
    : counts.High ? 'revise' : absent.length ? 'incomplete' : 'pass'
return { round, verdict, counts, findings, missing: absent }
