const FILLED = ['surface', 'entry', 'leaves'];
const core = (s) => JSON.stringify([s.id, s.cmd ?? null, s.agentJudged ?? null, s.expect ?? null, s.proves ?? null]);
const set = (v) => v !== undefined && v !== '';

export function scenariosMoved(before, after) {
  if (before.length !== after.length) return true;
  return after.some((s, i) => core(s) !== core(before[i]) || FILLED.some((k) => set(before[i][k]) && s[k] !== before[i][k]));
}

export function scenarioLogFor(open, scenarios, now = Date.now()) {
  const log = [...(open?.scenarioLog || (open?.scenarios?.length ? [{ at: open.started, scenarios: open.scenarios }] : []))];
  const last = log.at(-1)?.scenarios;
  if (scenarios.length && (!last || scenarioChanges({ scenarioLog: [{ scenarios: last }], scenarios }).length)) log.push({ at: now, scenarios });
  return log;
}

export function fillFrom(open, scenarios) {
  return scenarios.map((s) => {
    const was = (open?.scenarios || []).find((o) => o.id === s.id);
    return was ? { ...Object.fromEntries(FILLED.filter((k) => set(was[k]) && !set(s[k])).map((k) => [k, was[k]])), ...s } : s;
  });
}

export const FIELDS = FILLED;

const label = (s) => (s.cmd ? `\`${s.cmd}\`` : s.agentJudged);

export function scenarioChanges(run) {
  const first = run.scenarioLog?.[0]?.scenarios;
  if (!first) return [];
  const now = run.scenarios || [];
  const gone = first.filter((f) => !now.some((s) => s.id === f.id)).map((f) => `${f.id} is missing since the first list (${label(f)})`);
  const differ = now.flatMap((s) => {
    const f = first.find((x) => x.id === s.id);
    if (!f) return [`${s.id} was added after the first list (${label(s)})`];
    const keys = ['cmd', 'agentJudged', 'expect', 'proves', ...FILLED].filter((k) => JSON.stringify(s[k] ?? null) !== JSON.stringify(f[k] ?? null));
    return keys.length ? [`${s.id} differs from the first list in ${keys.join(', ')}: ${label(f)} became ${label(s)}`] : [];
  });
  return [...differ, ...gone];
}
