// `lpk push-check`: the PreToolUse hook on Bash for pushes, PR titles and handover (lib/push.mjs).
// Reads the hook JSON on stdin; prints a deny, or nothing.
import { readFileSync } from 'node:fs';
import { decide } from '../push.mjs';

export async function main() {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return 0; }
  const d = await decide(input);
  if (d) console.log(JSON.stringify(d));
  return 0;
}
