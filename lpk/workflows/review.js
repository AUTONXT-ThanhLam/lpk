export const meta = {
  name: 'review',
  description: 'Review a frozen lpk commit: tech lead, regression, /code-review, /security-review, OpenCodeReview, claims, the designer, mutants and the prover at once, then one verifier per finding',
  whenToUse: 'Step 6 of the lpk skill, on the committed and verified change',
  phases: [{ title: 'Review', detail: 'tech lead, regression, /code-review, /security-review, OpenCodeReview and claims at once; prover, then mutants' }, { title: 'Verify', detail: 'reproduce each finding' }],
}

// args: { repo, base, commit, bundle, request, scenarios, failureModes, surface, main, ui, testCmd, e2e }
// testCmd runs the tests related to the changed files (vitest related, jest --findRelatedTests ...).
const a = args || {}
const need = ['repo', 'base', 'commit', 'bundle', 'request', 'scenarios', 'testCmd']
const missing = need.filter((k) => !a[k])
if (missing.length) return { error: `lpk:review needs ${missing.join(', ')} in args` }

const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  path: { type: 'string' }, line: { type: 'integer' }, claim: { type: 'string' }, repro: { type: 'string' } },
  required: ['path', 'claim', 'repro'] } } }, required: ['findings'] }
const PATHS = { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } }, required: ['paths'] }
const BATCH = { type: 'object', properties: { findings: FINDINGS.properties.findings, files: { type: 'array', items: { type: 'object', properties: {
  path: { type: 'string' }, status: { type: 'string', enum: ['reviewed', 'skipped'] }, reason: { type: 'string' } }, required: ['path', 'status'] } } },
  required: ['findings', 'files'] }
const GROUPS = { type: 'object', properties: { findings: FINDINGS.properties.findings, groups: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, status: { type: 'string', enum: ['reviewed', 'skipped'] }, changes: { type: 'string' } }, required: ['id', 'status'] } } },
  required: ['findings', 'groups'] }
const PROVED = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: {
  scenario: { type: 'string' }, status: { type: 'string', enum: ['PASS', 'FAIL', 'NOT RUN'] }, evidence: { type: 'string' } },
  required: ['scenario', 'status', 'evidence'] } }, noticed: { type: 'array', items: { type: 'string' } } }, required: ['results', 'noticed'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['CONFIRMED', 'PRE-EXISTING', 'DROPPED', 'DUPLICATE', 'UNSETTLED'] },
  evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['verdict', 'evidence'] }

const change = `Repo ${a.repo}, base commit ${a.base}, commit under review ${a.commit}, facts bundle ${a.bundle}.
Request: ${a.request}
Acceptance scenarios:
${a.scenarios}${a.failureModes ? `\nFailure-mode table (what the design says happens when each dependency fails, is slow, repeats or grows; the code must match it):\n${a.failureModes}` : ''}`
const opts = (label, agentType, schema) => ({ label, phase: 'Review', agentType, schema })

// OpenCodeReview's split: ocr picks the reviewable files, each batch of at most ten (four batches
// at most) gets its own reviewer, and a file no reviewer accounts for comes back as unreviewed.
const ocr = async () => {
  const p = await agent(`Run \`npx -y -p @alibaba-group/open-code-review@1.13.0 ocr delegate preview --format json --repo ${a.repo} --from ${a.base} --to ${a.commit}\` and return the \`path\` of every entry in \`reviewable_files\`. If the command fails, return no paths and its error.`, { ...opts('ocr:preview', undefined, PATHS), model: 'haiku', effort: 'low' })
  if (!p || p.error) return { findings: [], missed: [`ocr delegate preview failed: ${p ? p.error : 'no answer'}`] }
  const paths = [...new Set(p.paths)].sort()
  const n = Math.min(4, Math.ceil(paths.length / 10))
  const size = Math.ceil(paths.length / n)
  const batches = Array.from({ length: n }, (_, i) => paths.slice(i * size, (i + 1) * size))
  const outs = await parallel(batches.map((b, i) => () => agent(`${change}\nReview these files of the commit, each one on its own:\n${b.join('\n')}`, opts(`ocr:${i + 1}`, 'lpk:ocr', BATCH))))
  const files = outs.flatMap((o) => (o ? o.files : []))
  const done = new Set(files.filter((f) => f.status === 'reviewed').map((f) => f.path))
  const skipped = new Map(files.filter((f) => f.status === 'skipped').map((f) => [f.path, f.reason]))
  return {
    findings: outs.flatMap((o) => (o ? o.findings : [])),
    missed: paths.filter((x) => !done.has(x)).map((x) => `did not review ${x}${skipped.get(x) ? `: ${skipped.get(x)}` : ''}`),
  }
}

const reviewers = [
  { name: 'techlead', run: () => agent(`${change}\nReview this commit as the team's tech lead would before approving the merge. Return the findings that would block it, each with its reproduction, the unconfirmed ones included.`, opts('techlead', 'lpk:techlead', FINDINGS)) },
  // A group the regression reviewer skipped comes back unreviewed, as a file no ocr batch read does.
  { name: 'regression', run: () => agent(`${change}\nFind what this commit breaks for what already worked on the base, here and in sibling repos.`, opts('regression', 'lpk:regression', GROUPS))
    .then((o) => o && { findings: o.findings, missed: o.groups.filter((g) => g.status === 'skipped').map((g) => `did not review ${g.id}${g.changes ? `: ${g.changes}` : ''}`) }) },
  { name: 'code-review', run: () => agent(`${change}\nRun \`lpk code-review --repo ${a.repo} --base ${a.base} --out ${a.bundle}/cr1\` with a Bash timeout of 600000 ms and wait for it. Read the JSON file it names and return every finding in it, with the file, line, what is wrong and the failure scenario it gives as repro. Return an empty list if it found nothing; if the command fails, return one finding with path "lpk code-review" and its error as the claim.`, { ...opts('code-review', undefined, FINDINGS), model: 'haiku', effort: 'medium' }) },
  { name: 'security', run: () => agent(`${change}\nRun \`lpk code-review --security --repo ${a.repo} --base ${a.base} --out ${a.bundle}/sec1\` with a Bash timeout of 600000 ms and wait for it. Read the markdown file it names and return each vulnerability in it as a finding: its file and line, what is wrong as the claim, and its exploit scenario as repro. Return an empty list if it reports none; if the command fails, return one finding with path "lpk code-review" and its error as the claim.`, { ...opts('security', undefined, FINDINGS), model: 'haiku', effort: 'low' }) },
  { name: 'ocr', run: ocr },
  { name: 'claims', run: () => agent(`${change}\nCheck every claim in words this change makes against its code.`, opts('claims', 'lpk:claims', FINDINGS)) },
  // The designer reviews the screens the change touches on the running UI, in review mode.
  ...(a.ui && a.surface ? [{ name: 'designer', run: () => agent(`${change}\nReview mode. Running UI: ${a.surface}\nScreens the change touches: ${a.ui}\nProof directory: ${a.bundle}/design`, opts('designer', 'lpk:designer', FINDINGS)) }] : []),
]
// The mutant runs the tests over and over: after the prover, so the two never share a database or port.
const mutant = { name: 'mutant', run: () => agent(`${change}\nCommand that runs the tests related to the changed files: ${a.testCmd}\nReturn each mutant no test catches as a finding: path and line of the mutated code, the behaviour it breaks as the claim, the mutant diff and the missing test as repro.`, opts('mutant', 'lpk:mutant', FINDINGS)) }

// Every finding gets its own verifier, which first compares it with the findings already sent to
// one: reviewers often report the same defect, and a duplicate needs no second reproduction.
const sent = []
const verify = async (f, from) => {
  if (f.path === 'lpk code-review') return { ...f, from, verdict: 'NO ANSWER', evidence: f.claim }
  if (from === 'mutant') return { ...f, from, verdict: 'CONFIRMED', evidence: 'lpk mutate applied the mutant and the tests still passed' }
  const earlier = sent.slice()
  sent.push(`${f.path}${f.line ? `:${f.line}` : ''}: ${f.claim}`)
  return agent(`Repo ${a.repo}, commit ${a.commit}, base ${a.base}. Finding from ${from}:
${f.path}${f.line ? `:${f.line}` : ''}: ${f.claim}
Reviewer's reproduction: ${f.repro}
${earlier.length ? `Findings already being verified:\n${earlier.map((e, i) => `${i + 1}. ${e}`).join('\n')}\nIf this one is the same defect as one of them (same cause; the same fix would remove both), answer DUPLICATE naming its number, without reproducing it. A different defect on the same line is not a duplicate.` : ''}`, { label: `verify:${from}:${f.path}`, phase: 'Verify', agentType: 'lpk:verifier', schema: VERDICT })
    .then((v) => ({ ...f, from, ...(v || { verdict: 'UNVERIFIED', evidence: 'the verifier did not answer: reproduce it yourself' }) }))
}
const unchecked = (r, why) => ({ path: r.name, claim: why, from: r.name, verdict: 'NO ANSWER', evidence: why })
const check = (r) => r.run().then((out) => out
  ? parallel((out.findings || []).map((f) => () => verify(f, r.name))).then((v) => [...v, ...(out.missed || []).map((m) => unchecked(r, m))])
  : [unchecked(r, `${r.name} did not answer`)])

const proving = (a.surface
  ? agent(`Commit ${a.commit} of ${a.repo}. Prove it on the running surface: ${a.surface}
Main instance for comparison: ${a.main || 'none'}
Acceptance scenarios:
${a.scenarios}
Failure-mode table:
${a.failureModes || '(none given)'}
E2E scripts: ${a.e2e || 'none'}
Proof directory: ${a.bundle}/proof`, opts('prover', 'lpk:prover', PROVED))
  : Promise.resolve({ results: [], noticed: ['no running surface given: the session proves the scenarios itself'] }))
  .then((p) => p || { results: [], noticed: ['the prover did not answer: prove the scenarios yourself'] })

const [reviewed, [proved, mutants]] = await Promise.all([
  parallel(reviewers.map((r) => () => check(r))),
  proving.then((p) => check(mutant).then((m) => [p, m])),
])
const all = [...reviewed.filter(Boolean).flat(), ...(mutants || [])].filter(Boolean)
const by = (...vs) => all.filter((f) => vs.includes(f.verdict))
return {
  confirmed: by('CONFIRMED'),
  unverified: by('UNVERIFIED', 'UNSETTLED'),
  preexisting: by('PRE-EXISTING'),
  dropped: by('DROPPED', 'DUPLICATE'),
  prover: proved,
  noAnswer: by('NO ANSWER').map((f) => `${f.from}: ${f.evidence}`),
}
