import { randomInt } from 'node:crypto';
import { readdirSync } from 'node:fs';

export const pairOrder = (draw = randomInt) => (draw(2) === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']);

export function nextRun(outDir, task, arms) {
  let top = 0;
  for (const name of readdirSync(outDir)) {
    for (const arm of arms) {
      const prefix = `${task}-${arm}-`;
      const rest = name.startsWith(prefix) ? name.slice(prefix.length) : '';
      if (/^\d+$/.test(rest)) top = Math.max(top, Number(rest));
    }
  }
  return top + 1;
}
