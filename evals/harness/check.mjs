// Stop hook: run the hidden checks of the case this workspace belongs to, write verdict.txt.
// The case id sits inside .git, where the scaffold put it, so the agent never needs to see it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no input */ }
const ws = input.cwd || process.cwd();
let lines;
try {
  const id = readFileSync(join(ws, '.git', 'lpk-eval-case'), 'utf8').trim();
  const check = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'checks', `${id}.mjs`)));
  const failures = await check.default(ws);
  lines = failures.length ? ['FAIL', ...failures] : ['PASS'];
} catch (e) {
  lines = ['FAIL', `check crashed: ${e && e.message}`];
}
writeFileSync(join(ws, 'verdict.txt'), lines.join('\n') + '\n');
