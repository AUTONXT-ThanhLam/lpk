// The team of a session as the owner reads it: each agent by job title, what it works on, whether
// it still runs, how long it has run and its latest tool call. Every field is read from the
// transcripts (lib/scan.mjs); none is what an agent says about itself.

// Job titles by agent type. A type not listed reads as its own name, spaced and capitalised.
const TITLES = {
  builder: 'Builder', techlead: 'Tech lead', verifier: 'Verifier', prover: 'Prover', 'design-critic': 'Design critic',
  'plan-sim': 'Plan simulator', 'plan-trace': 'Plan tracer', 'bug-hunter': 'Bug hunter', security: 'Security reviewer',
  regression: 'Regression reviewer', claims: 'Claims checker', ocr: 'OpenCodeReview', mutant: 'Mutation tester',
  'test-author': 'Test author', designer: 'Designer', a11y: 'Accessibility reviewer', perf: 'Performance reviewer',
  env: 'Environment', Explore: 'Explorer', Plan: 'Planner', 'general-purpose': 'Helper', 'claude-code-guide': 'Guide',
};
// A workflow agent started without a type is a relay for a CLI lens; its label names the lens.
const RELAYS = [[/^code-review/, 'Code reviewer'], [/^security-review/, 'Security reviewer'], [/^ocr/, 'OpenCodeReview']];

export function titleOf(type, label = '') {
  if (type === 'workflow-subagent' || !type) return RELAYS.find(([re]) => re.test(label))?.[1] || 'Workflow agent';
  const key = type.split(':').pop();
  if (TITLES[key]) return TITLES[key];
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Agent';
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FINDING = /(?<![\w-])(F\d+)(?![\w-])/;

// What an agent works on: for a Builder the first slice its label names, else its prompt, for a Verifier the
// finding id its label or prompt names, else its label (the Agent tool's description or the
// workflow's label).
export function whatOf({ type, label, prompt }, slices = []) {
  const key = String(type || '').split(':').pop();
  if (key === 'builder' || key === 'test-author') {
    // The label (the Agent tool's description) names one slice; a prompt may name several.
    for (const text of [label, prompt]) {
      const hits = slices.map((s) => ({ s, at: String(text || '').search(new RegExp(`(?<![\\w-])${escape(s)}(?![\\w-])`)) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
      if (hits.length) return { what: `slice ${hits[0].s}`, slice: hits[0].s };
    }
  }
  if (key === 'verifier') { const m = FINDING.exec(label) || FINDING.exec(prompt); if (m) return { what: m[1], finding: m[1] }; }
  return { what: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
}

const ms = (t) => (t ? Date.parse(t) : NaN);
// An agent that wrote no line (no tool call, no result, no message) for this long is stalled.
export const STALL_MS = 5 * 60_000;

// How an agent stands. A subagent is finished when Claude Code marked its meta file finished, or a
// task notification or tool result in the main transcript reported it; a workflow agent when its
// workflow's journal holds its result. Either is finished when its transcript ends its turn or
// returns structured output, failed when it ends on an API error or a notification says it failed,
// stopped when a notification says it was stopped or killed.
export function stateOf(a, main, done) {
  const note = main?.notes?.[a.id];
  if (note === 'failed') return 'failed';
  if (note && note !== 'completed') return 'stopped'; // stopped or killed on purpose: no failure
  if (a.st.end === 'error') return 'failed';
  if (a.meta.finished || note === 'completed' || done.has(a.id) || a.st.end === 'end_turn' || a.st.end === 'structured') return 'finished';
  return 'running';
}

const stall = (last, now) => (now - ms(last) > STALL_MS ? { stalledMs: now - ms(last) } : {});

// One row per agent that started at or after `since` (ms), oldest first; the Captain (the main
// session) first of all when its transcript is here.
export function crew(scan, { since = 0, now = Date.now(), slices = [] } = {}) {
  if (!scan) return [];
  const rows = [];
  if (scan.main) {
    const m = scan.main;
    rows.push({ id: 'main', title: 'Captain', type: 'main', what: m.asks.length ? 'asking the owner' : '', state: m.waiting ? 'waiting' : 'running',
      startedAt: m.first, elapsedMs: 0, action: m.action, lastAt: m.last, ...(m.waiting ? {} : stall(m.last, now)) });
  }
  for (const a of scan.agents) {
    const started = ms(a.st.first);
    if (!(started >= since)) continue;
    const type = a.meta.agentType || '';
    const label = a.meta.description || '';
    const state = stateOf(a, scan.main, scan.done);
    const end = state === 'running' ? now : ms(a.st.last);
    const note = scan.main?.notes?.[a.id];
    const reason = state === 'failed' ? a.st.error || `ended ${note}` : '';
    rows.push({ id: a.id, title: titleOf(type, label), type, ...whatOf({ type, label, prompt: a.st.prompt }, slices),
      ...(a.workflow ? { workflow: a.workflow, workflowPhase: a.meta.workflowPhase || '' } : {}),
      state, ...(reason ? { reason } : {}), ...(state === 'running' ? stall(a.st.last, now) : {}),
      startedAt: a.st.first, elapsedMs: Math.max(0, end - started), action: a.st.action, lastAt: a.st.last });
  }
  return rows.sort((x, y) => (x.id === 'main' ? -1 : y.id === 'main' ? 1 : ms(x.startedAt) - ms(y.startedAt)));
}

// The time the run worked, in ms: the union of every working span of the main session and of the
// team's agents (lib/scan.mjs leaves out the waits on the owner), cut at `since`. A file still at
// work adds the span from its last line to now, unless it has been stalled for STALL_MS, when it
// counts up to its last line only. The spans are sorted by start and swept once: a span that
// starts before the current one ends extends it, else the current one is added and a new one starts.
export function activeMs(scan, team, { since = 0, now = Date.now() } = {}) {
  if (!scan) return 0;
  const running = new Set(team.filter((r) => r.state === 'running' && !r.stalledMs).map((r) => r.id));
  const files = [...(scan.main ? [{ id: 'main', st: scan.main }] : []), ...scan.agents.filter((a) => team.some((r) => r.id === a.id))];
  const spans = files.flatMap(({ id, st }) => [...st.spans, ...(running.has(id) && st.last ? [[ms(st.last), now]] : [])]);
  let total = 0, cur = null;
  for (const [a0, b] of spans.map(([x, y]) => [Math.max(x, since), y]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0])) {
    if (cur && a0 <= cur[1]) cur[1] = Math.max(cur[1], b);
    else { if (cur) total += cur[1] - cur[0]; cur = [a0, b]; }
  }
  return total + (cur ? cur[1] - cur[0] : 0);
}
