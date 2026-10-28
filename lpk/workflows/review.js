export const meta = {
  name: 'review',
  description: 'Review a frozen lpk commit: every lens the lane owes at once (tech lead, /code-review, bug hunter, security, regression, claims, OpenCodeReview, the prover and the rest), one verifier per finding as each lens returns',
  whenToUse: 'Step 4 of the lpk skill, on the committed and verified change after `lpk review start`; with args.delta, the one review of a fix round',
  phases: [{ title: 'Review', detail: 'every owed lens at once' }, { title: 'Verify', detail: 'one verifier per finding, as each lens returns' }],
}

// args: { repo, base, commit, range, lenses, bundle, request, scenarios, failureModes, surface, main,
//   testCmd, e2e, proverGroups, bugGroups, mutantAfterProver, maxParallel, stallMs, lpk, delta }
// - range: the reviewed range exactly as `lpk review start` printed it (<base sha>..<commit sha>).
// - lenses: the lenses the lane owes (`lpk reviews owed`), each one of LENSES below; a lens named
//   twice runs twice.
// - proverGroups: the scenarios and failure rows split into groups that share no page, app state or
//   data (each a text naming its ids); one Prover per group, all at once. Without it one Prover
//   proves every scenario.
// - mutantAfterProver: true when the env agent's report shows the test command and the prover's app
//   share a database or a port. The mutant reruns the tests over and over and must never share
//   either with the prover, so it then starts once the prover has answered; without it, at once.
// - maxParallel: how many agents run at once (`lpk slot`); stallMs: { <lens>|verifier: ms }.
// - lpk: how to call the lpk CLI (default 'lpk'); the code-review relays may run only its
//   `code-review` command.
// - delta: { range, raisedBy, docsOnly } for a fix round: one code review on the delta (none when
//   docsOnly) plus the lenses that raised the fixed findings (their ledger `from`).
// Every finding lands in the run's ledger: lpk agents add theirs with finding_add, `lpk code-review`
// adds its child's. The ledger is the record; what this returns is a summary of it. Nothing here reads
// the clock or chance, so resumeFromRunId replays every lens and verifier that already finished.
const a = args || {}
const LPK = a.lpk || 'lpk'
const missing = ['repo', 'base', 'commit', 'range', 'bundle', 'request', 'scenarios'].filter((k) => !a[k])
if (!a.delta && !(a.lenses || []).length) missing.push('lenses')
if (a.delta && !a.delta.range) missing.push('delta.range')
if (missing.length) return { error: `lpk:review needs ${missing.join(', ')} in args` }
const SCOPE = 'Raise a finding only when a person or a caller meets it on the surface the change touches (a screen, a response, CLI output, data they keep, a message they read), or when it would block the merge: a broken rule marked blocks: high, a hole in security, auth, data, concurrency, migration or permissions, a red CI job or gate, a test that cannot fail on the behaviour it claims to prove, a claim in the PR text or docs that the code contradicts, an undisclosed behaviour change. Style, naming, structure, edge cases no caller reaches and cleanups are not findings.'

const S = { type: 'string' }
const FINDING = { type: 'object', properties: { id: S, file: S, line: { type: 'integer' }, claim: S, repro: S }, required: ['id', 'claim', 'repro'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: FINDING } }, required: ['findings'] }
const MUTANTS = { type: 'object', properties: { findings: { type: 'array', items: { ...FINDING, properties: { ...FINDING.properties, kind: { type: 'string', enum: ['test-gap', 'defect'] } } } } }, required: ['findings'] }
const covered = (key, item) => ({ type: 'object', properties: { findings: FINDINGS.properties.findings, [key]: { type: 'array', items: item } }, required: ['findings', key] })
const BATCH = covered('files', { type: 'object', properties: { path: S, status: { type: 'string', enum: ['reviewed', 'skipped'] }, reason: S }, required: ['path', 'status'] })
const GROUPS = covered('groups', { type: 'object', properties: { id: S, status: { type: 'string', enum: ['reviewed', 'skipped'] }, changes: S }, required: ['id', 'status'] })
// The prover's findings are its FAIL and NOT PROVED results, each carrying its ledger id: no second list.
const PROVED = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { scenario: S, status: { type: 'string', enum: ['PASS', 'FAIL', 'NOT PROVED'] }, evidence: S, id: S, proves: { type: 'array', items: S } }, required: ['scenario', 'status', 'evidence', 'proves'] } }, noticed: { type: 'array', items: S } }, required: ['results'] }
const RECORD = { type: 'object', properties: { record: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } }, required: ['record', 'ids'] }
const PATHS = { type: 'object', properties: { paths: { type: 'array', items: S }, error: S }, required: ['paths'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['confirmed', 'preexisting', 'dropped', 'duplicate', 'unsettled'] },
  evidence: S, basis: { type: 'string', enum: ['not-reproduced', 'disproved'] }, primary: S, born: { type: 'string', enum: ['request', 'design', 'build', 'fix'] }, cause: S, reach: { type: 'string', enum: ['user', 'merge', 'neither'] } }, required: ['verdict', 'evidence'] }

// What is under review. A delta round reviews the fix delta, and everything is stamped with it.
const at = a.delta ? a.delta.range : a.range
const commit = at.split('..')[1]
// The first `<sha>..<sha>` of every lens prompt is the reviewed range: the gates read it there.
const change = `Review range ${at}.
Repo ${a.repo}, base commit ${a.base}, commit under review ${commit}, facts bundle ${a.bundle}.${a.delta ? `
This is the fix delta of the change ${a.range}: review only what the delta changes. The findings already raised on this change are in the ledger (finding_list): do not raise one again; say in a finding when the delta did not fix one you raised.` : ''}
Request: ${a.request}
Acceptance scenarios:
${a.scenarios}${a.failureModes ? `\nFailure-mode table (what the design says happens when each dependency fails, is slow, repeats or grows; the code must match it):\n${a.failureModes}` : ''}
${SCOPE}
Add each finding to the ledger with finding_add (kind and severity; area for security, auth, data, concurrency, migration or permissions; ruleId for a broken rule) and return each with the id the ledger gave it.`

// At most args.maxParallel agents at once. A waiter resumes in its own async context, so the order
// of agent() calls inside each parallel branch, which resume keys on, does not depend on timing.
const gate = ((n) => {
  let active = 0
  const waiting = []
  return async (fn) => {
    if (active >= n) await new Promise((r) => waiting.push(r)); else active++
    try { return await fn() } finally { const w = waiting.shift(); if (w) w(); else active-- }
  }
})(Math.max(1, Number(a.maxParallel) || 16))
const stall = (name) => (a.stallMs && a.stallMs[name]) || undefined
const call = (prompt, opts) => gate(() => agent(prompt, opts))

const typed = (type, schema, ask) => (lens) => (label) => call(`${change}\n${ask}`, { label, phase: 'Review', agentType: `lpk:${type}`, schema, stallMs: stall(lens) })
const codeReview = (lens) => (label) => {
  const cmd = `${LPK} code-review --repo ${a.repo} --model sonnet --effort high${a.delta ? ` --range ${at}` : ''}`
  return call(`${change}\nRun exactly this command, with a Bash timeout of 600000 ms, and wait for it:\n${cmd}\nIts last line names the record file and the ledger ids it added. Return that record path and those ids exactly as printed. If it exits non-zero, also return its error line as error.`,
    { label, phase: 'Review', schema: RECORD, model: 'haiku', effort: 'low', bashCommandClamp: [`Bash(${LPK} code-review *)`], stallMs: stall(lens) || 660000 })
    .then((o) => o && { findings: o.ids.map((id) => ({ id })), record: o.record, error: o.error })
}
const skippedOf = (rows, key, why) => rows.filter((r) => r.status === 'skipped').map((r) => `did not review ${r[key]}${r[why] ? `: ${r[why]}` : ''}`)

// Split an array into groups of at most size items. Returns [] when input is empty.
const batchFiles = (paths, size) => {
  if (!paths.length) return []
  const n = Math.ceil(paths.length / size)
  return Array.from({ length: n }, (_, i) => paths.slice(i * size, (i + 1) * size))
}

// OpenCodeReview's split: ocr picks the reviewable files, each batch of at most ten (four batches
// at most) gets its own reviewer, and a file no batch accounts for comes back as not reviewed.
const ocr = (lens) => async (label) => {
  const p = await call(`Run \`npx -y -p @alibaba-group/open-code-review@1.13.0 ocr delegate preview --format json --repo ${a.repo} --from ${a.base} --to ${commit}\` and return the \`path\` of every entry in \`reviewable_files\`. If the command fails, return no paths and its error.`,
    { label: `${label}:preview`, phase: 'Review', schema: PATHS, model: 'haiku', effort: 'low', bashCommandClamp: ['Bash(npx -y -p @alibaba-group/open-code-review@1.13.0 ocr delegate preview *)'] })
  if (!p || p.error) return { error: `ocr delegate preview failed: ${p ? p.error : 'no answer'}` }
  const paths = [...new Set(p.paths)].sort()
  if (!paths.length) return { findings: [], missed: [] }
  const n = Math.min(4, Math.ceil(paths.length / 10))
  const batchSize = Math.ceil(paths.length / n)
  const batches = batchFiles(paths, batchSize)
  const outs = await parallel(batches.map((b, i) => () =>
    call(`${change}\nReview these files of the commit, each one on its own:\n${b.join('\n')}`, { label: `${label}:${i + 1}`, phase: 'Review', agentType: 'lpk:ocr', schema: BATCH, stallMs: stall(lens) })))
  // A batch that did not answer leaves its files in the not-reviewed list, like a file it skipped.
  const files = outs.flatMap((o) => (o ? o.files : []))
  const done = new Set(files.filter((f) => f.status === 'reviewed').map((f) => f.path))
  const why = new Map(files.filter((f) => f.status === 'skipped').map((f) => [f.path, f.reason]))
  return { findings: outs.flatMap((o) => (o ? o.findings : [])), missed: paths.filter((x) => !done.has(x)).map((x) => `did not review ${x}${why.get(x) ? `: ${why.get(x)}` : ''}`) }
}

// The prover's FAIL and NOT PROVED scenarios are ledger findings. With args.mutantAfterProver it
// runs before the mutant, because they share a database or a port.
let proved
const proverDone = new Promise((r) => { proved = r })
const groups = (a.proverGroups || []).filter(Boolean)
const groupOf = new Map()
const groupFor = (label) => groupOf.get(label.replace(/ \(retry\)$/, ''))

const shardsOf = (groups, from, per, most) => {
  const total = groups.reduce((n, g) => n + g.lines, 0)
  if (groups.length < 2 || total <= from) return []
  const count = Math.min(most, groups.length, Math.ceil(total / per))
  const goal = total / count
  const shards = [[]]
  let sum = 0
  for (const g of groups) {
    if (sum > 0 && sum + g.lines / 2 > goal && shards.length < count) { shards.push([]); sum = 0 }
    shards[shards.length - 1].push(g)
    sum += g.lines
  }
  return shards
}
const shards = a.delta ? [] : shardsOf((a.bugGroups || []).filter((g) => g && g.diff), 600, 500, 4)
const shardOf = new Map()
const shardFor = (label) => shardOf.get(label.replace(/ \(retry\)$/, ''))
const huntAsk = 'Hunt the correctness bugs this commit adds, line by line.'
const prover = (lens) => (label) => (a.surface
  ? call(`${change}${groupFor(label) ? `\nProve only this group; other Provers prove the rest at the same time on the same surface, so leave the data they create alone:\n${groupFor(label)}` : ''}\nProve it on the running surface: ${a.surface}\nMain instance for comparison: ${a.main || 'none'}\nE2E scripts: ${a.e2e || 'none'}\nProof directory: ${a.bundle}/proof\nAdd each FAIL and NOT PROVED scenario to the ledger (kind scenario) and return it in results only, with the id the ledger gave it as its id.`,
    { label, phase: 'Review', agentType: 'lpk:prover', schema: PROVED, stallMs: stall(lens) })
  : Promise.resolve({ error: 'no running surface given in args.surface' }))
  .then((o) => o && { findings: (o.results || []).filter((x) => x.status !== 'PASS').map((x) => ({ id: x.id || '', claim: `${x.scenario}: ${x.status}`, repro: x.evidence })), results: o.results || [], error: o.error })
const waitsForProver = (run) => (lens) => async (label) => { if (a.mutantAfterProver && owed.includes('prover')) await proverDone; return run(lens)(label) }

const ui = (type, ask) => (lens) => (label) => (a.surface ? typed(type, FINDINGS, `${ask}\nRunning UI: ${a.surface}`)(lens)(label) : Promise.resolve({ error: 'no running surface given in args.surface' }))
const LENSES = {
  techlead: typed('techlead', FINDINGS, 'Review this commit as the team\'s tech lead would before approving the merge: return each finding that would block it, with a verdict for every rule whose glob matches a changed file.'),
  'code-review': codeReview,
  'code-reviewer': typed('code-reviewer', FINDINGS, 'Review only this commit\'s diff, against the base\'s REVIEW.md and the request above: name the rule broken, the intent contradicted, the case no test in the diff covers, and the leftover the diff creates.'),
  security: typed('security', FINDINGS, 'Find the security holes an attacker can exploit through this commit.'),
  'bug-hunter': (lens) => (label) => {
    const shard = shardFor(label)
    const only = shard ? `\nHunt only the files of these group diffs; other bug hunters hunt the rest of the commit at the same time, so read another file only to follow a caller or a callee:\n${shard.map((g) => `${g.diff} (${g.files.join(', ')})`).join('\n')}` : ''
    return typed('bug-hunter', FINDINGS, `${huntAsk}${only}`)(lens)(label)
  },
  regression: (lens) => (label) => typed('regression', GROUPS, 'Find what this commit breaks for what already worked on the base, here and in sibling repos.')(lens)(label)
    .then((o) => o && { findings: o.findings, missed: skippedOf(o.groups, 'id', 'changes') }),
  claims: typed('claims', FINDINGS, `Check every claim in words this change makes against its code, the drafted PR body included (in ${a.bundle}).`),
  ocr,
  perf: typed('perf', FINDINGS, `Find what this commit makes slower or hungrier than the base.${a.surface ? `\nRunning app: ${a.surface}` : ''}`),
  'ui-reviewer': ui('ui-reviewer', 'Review mode: what a person meets on each screen this commit changes.'),
  a11y: ui('a11y', 'Check that the screens this commit touches work by keyboard, screen reader, large text, high contrast and reduced motion.'),
  prover,
  mutant: waitsForProver(typed('mutant', MUTANTS, `Command that runs the tests related to the changed files: ${a.testCmd || '(none given: find it in the repo)'}\nAdd each mutant no test catches to the ledger as kind test-gap. If those tests fail or flake on the change itself, add that to the ledger as one defect and return it with kind defect.`)),
}

// A fix round owes one code review on the delta (none for a docs-only delta) and the lenses that
// raised the fixed findings.
const lensOf = (from) => (String(from || '').startsWith('code-review:') ? 'code-review' : String(from || '').replace(/^lpk:/, ''))
const owed = a.delta
  ? [...new Set([...(a.delta.docsOnly ? [] : ['code-review']), ...(a.delta.raisedBy || []).filter((f) => f !== 'main').map(lensOf)])]
  : a.lenses
const unknown = owed.filter((l) => !LENSES[l])
if (unknown.length) return { error: `unknown lens ${unknown.join(', ')}; lenses are ${Object.keys(LENSES).join(', ')}` }
if (a.delta && (a.delta.raisedBy || []).includes('main')) log('findings the session raised itself are re-checked by the session, not by a lens')
const runs = owed.flatMap((lens, i) => {
  const label = owed.indexOf(lens) === i ? lens : `${lens}#${owed.slice(0, i + 1).filter((l) => l === lens).length}`
  if (lens === 'bug-hunter' && shards.length > 1) return shards.map((sh, k) => { shardOf.set(`${label}:${k + 1}`, sh); return { lens, label: `${label}:${k + 1}` } })
  if (lens !== 'prover' || groups.length < 2) return [{ lens, label }]
  return groups.map((g, k) => { groupOf.set(`${label}:${k + 1}`, g); return { lens, label: `${label}:${k + 1}` } })
})
let proversLeft = runs.filter((r) => r.lens === 'prover').length

// A lens that stalls, errors or does not answer runs once more; after that it is ungraded, and
// only the owner's waiver passes it.
async function graded(r) {
  let why = ''
  for (const label of [r.label, `${r.label} (retry)`]) {
    try {
      const out = await LENSES[r.lens](r.lens)(label)
      if (out && !out.error) return out
      // A lens that added some findings and had others refused is not run again: a fresh one would
      // add the same findings a second time. Its ids are verified, the error listed.
      if (out && (out.findings || []).some((f) => f.id)) return { ...out, missed: [...(out.missed || []), `${out.error}; not run again, since its other findings are in the ledger`] }
      why = out ? out.error : 'no answer (an API error, or the agent was skipped)'
    } catch (e) { why = String((e && e.message) || e) }
    if (label === r.label) log(`${r.label}: ${why}; running it once more`)
  }
  return { ungraded: why }
}

// Every verifier has the same options and the same prompt up to the finding, so they share one
// cached prefix; the finding's own text comes last.
const verifyHead = `Repo ${a.repo}, base ${a.base}, commit under review ${commit}, reviewed range ${at}.
Rule on the ledger finding below with finding_verdict: confirmed with born, cause and reach (user, merge or neither), preexisting, unsettled, dropped with its basis (not-reproduced or disproved), or duplicate naming its primary (the earlier findings are in finding_list; a different defect on the same line is not a duplicate). Return the same verdict.
Finding:`
const verify = (lens) => (f) => call(`${verifyHead} ${f.id} from ${lens}${f.claim ? `\n${f.file || ''}${f.line ? `:${f.line}` : ''} ${f.claim}\nReviewer's reproduction: ${f.repro}` : ' (read it with finding_get)'}`,
  { label: `verify:${f.id}`, phase: 'Verify', agentType: 'lpk:verifier', schema: VERDICT, stallMs: stall('verifier') })
  .then((v) => (v ? { id: f.id, lens, ...v } : { id: f.id, lens, verdict: 'none', evidence: 'the verifier did not answer: start another one on it' }))

const results = await pipeline(runs, (r) => graded(r).then((out) => { if (r.lens === 'prover' && --proversLeft === 0) proved(); return out }), (out, r) => {
  if (out.ungraded) return { lens: r.label, ungraded: out.ungraded }
  const fs = out.findings || []
  const ids = fs.filter((f) => f.id).map((f) => f.id)
  const unrecorded = fs.filter((f) => !f.id).map((f) => `${f.file || ''}${f.line ? `:${f.line}` : ''} ${f.claim || ''}`.trim())
  // A surviving mutant's run is its evidence: it is listed, not reproduced again.
  const gap = (f) => r.lens === 'mutant' && f.kind !== 'defect'
  const toVerify = fs.filter((f) => f.id && !gap(f))
  return parallel(toVerify.map((f) => () => verify(r.label)(f))).then((verdicts) => ({
    lens: r.label, ids, verdicts: verdicts.filter(Boolean), unrecorded, missed: out.missed || [],
    ...(out.record ? { record: out.record } : {}), ...(out.results ? { scenarios: out.results } : {}), ...(r.lens === 'mutant' ? { testGaps: fs.filter((f) => f.id && gap(f)).map((f) => f.id) } : {}),
  }))
})
proved()

const done = results.map((x, i) => x || { lens: runs[i].label, ungraded: 'the lens failed inside the workflow' })
const verdicts = done.flatMap((x) => x.verdicts || [])
const is = (...vs) => verdicts.filter((v) => vs.includes(v.verdict))
return {
  range: at,
  confirmed: is('confirmed').filter((v) => v.reach !== 'neither'),
  deferred: is('confirmed').filter((v) => v.reach === 'neither'),
  unsettled: is('unsettled', 'none'),
  preexisting: is('preexisting'),
  dropped: is('dropped', 'duplicate'),
  testGaps: done.flatMap((x) => x.testGaps || []),
  scenarios: done.flatMap((x) => x.scenarios || []),
  ungraded: done.filter((x) => x.ungraded).map((x) => `${x.lens}: ${x.ungraded}`),
  notCovered: done.flatMap((x) => [...(x.missed || []).map((m) => `${x.lens}: ${m}`), ...(x.unrecorded || []).map((u) => `${x.lens} returned a finding it never added to the ledger: ${u}`)]),
  lenses: done.map((x) => ({ lens: x.lens, ...(x.ungraded ? { ungraded: x.ungraded } : { ids: x.ids }), ...(x.record ? { record: x.record } : {}) })),
}
