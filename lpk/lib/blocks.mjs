import { loadRules } from './rules.mjs';

export function belowHigh(repo, f, area) {
  if (f.kind !== 'rule' || !f.ruleId || area) return null;
  const rule = loadRules(repo).find((r) => r.id === f.ruleId);
  return rule && rule.blocks !== 'high' ? rule : null;
}

export const belowHighError = (f, rule) => `${f.id} cites a rule below high: ${rule.id} is marked blocks: ${rule.blocks}, so it blocks no merge and reach is neither`;
