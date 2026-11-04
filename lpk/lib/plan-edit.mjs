import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { planFile, plansDir } from './plan.mjs';

const find = (plan, id) => plan.items.findIndex((i) => i.id === id);
const missing = (plan, id) => ({ error: `no item ${id} in plan ${plan.name}` });

export function reorder(plan, id, before) {
  if (id === before) return { error: `${id} cannot move before itself` };
  if (find(plan, id) < 0) return missing(plan, id);
  if (find(plan, before) < 0) return missing(plan, before);
  const [item] = plan.items.splice(find(plan, id), 1);
  plan.items.splice(find(plan, before), 0, item);
  return { item };
}

export function remove(plan, id, why) {
  const at = find(plan, id);
  if (at < 0) return missing(plan, id);
  if (plan.items[at].status === 'done') return { error: `${id} is done: a done item is not removed` };
  const [item] = plan.items.splice(at, 1);
  const entry = { id, title: item.title, why, at: new Date().toISOString() };
  plan.removed = [...(plan.removed ?? []), entry];
  return { entry };
}

export function completeIfFinished(plan, say = console.log) {
  const removed = plan.removed ?? [];
  const finished = plan.items.length ? plan.items.every((i) => i.status === 'done') : removed.length > 0;
  if (!finished) return false;
  mkdirSync(join(plansDir(), 'done'), { recursive: true });
  renameSync(planFile(plan.name), join(plansDir(), 'done', `${plan.name}.json`));
  rmSync(join(plansDir(), `${plan.name}.nudge`), { force: true });
  const count = removed.length ? `, ${removed.length} removed` : '';
  say(`plan ${plan.name} is complete: ${plan.items.length ? 'every item is done' : 'no item left'}${count}`);
  for (const r of removed) say(`  removed ${r.id} ${r.title}: ${r.why}`);
  return true;
}
