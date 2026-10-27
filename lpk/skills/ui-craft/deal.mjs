#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = JSON.parse(readFileSync(join(HERE, 'directions.json'), 'utf8'));
const SOURCE = `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/${LIBRARY.commit}/`;
const HISTORY = process.env.LPK_DEAL_HISTORY || join(homedir(), '.local', 'share', 'lpk', 'design-kit', 'dealt.json');
const RECENT_DEALS = 4;
const AXES = ['density', 'depth', 'shell'];

const args = process.argv.slice(2);
const usage = 'usage: deal.mjs [--count 3] [--seed N] [--json] | deal.mjs --show <id> [--json] | deal.mjs --list';
const fail = (message, code) => {
  console.error(message);
  process.exit(code);
};
const options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i].startsWith('--') ? args[i].slice(2) : '';
  if (['json', 'list'].includes(name)) options[name] = true;
  else if (['count', 'seed', 'show'].includes(name) && i + 1 < args.length) options[name] = args[++i];
  else fail(usage, 2);
}
const count = Number(options.count ?? 3);
if (!Number.isInteger(count) || count < 1 || count > 6 || (options.seed !== undefined && !Number.isInteger(Number(options.seed)))) fail(usage, 2);

const readHistory = () => {
  try {
    return JSON.parse(readFileSync(HISTORY, 'utf8'));
  } catch {
    return [];
  }
};

let seed = Number(options.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0;
const firstSeed = seed;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const differences = (a, b) => Math.min(2, AXES.filter((axis) => a[axis] !== b[axis]).length);

function deal(entries, { count, recent }) {
  const pool = shuffle(entries);
  let best = null;
  const picked = [];
  const visit = (from, reused, spread) => {
    if (picked.length === count) {
      if (!best || reused < best.reused || (reused === best.reused && spread > best.spread)) best = { picked: [...picked], reused, spread };
      return best.reused === 0 && best.spread === 2;
    }
    for (let i = from; i < pool.length; i++) {
      const e = pool[i];
      if (picked.some((p) => p.hue === e.hue || p.type.body.family === e.type.body.family)) continue;
      picked.push(e);
      const done = visit(i + 1, reused + recent.has(e.id), Math.min(spread, ...picked.slice(0, -1).map((p) => differences(p, e))));
      picked.pop();
      if (done) return true;
    }
    return false;
  };
  visit(0, 0, 2);
  return best?.picked;
}

const face = (f) => `${f.family} (npm i ${f.package}; subsets ${f.subsets.join(', ')})`;
const describe = (e) => [
  `## ${e.name} (${e.id})`,
  `${e.theme}, ${e.hue} accent, ${e.density}, depth ${e.depth}, shell ${e.shell}`,
  `move: ${e.move}`,
  `keep out: ${e.keep_out}`,
  `ramp (${e.theme}): ${Object.entries(e.ramp).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `ramp (other scheme): ${Object.entries(e.dark).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `accent: ${e.accent.name} ${e.accent.value} (text on it ${e.accent.on}; other scheme ${e.accent.dark}, text on it ${e.accent.on_dark}); ${e.accent.use}`,
  `type: ${face(e.type.body)}${e.type.display ? `, display ${face(e.type.display)}` : ''}; weights ${e.type.weights.join(' and ')}; body ${e.type.body_px} px, title ${e.type.title_px} px${e.type.stands_in_for ? `; stands in for ${e.type.stands_in_for}` : ''}`,
  `radius: control ${e.radius.control} px, card ${e.radius.card} px`,
  `look at: ${e.live.join(' ')}`,
  `source: ${e.source.startsWith('taste-skill:') ? `node <design-taste-frontend>/scripts/draw.mjs --app --kind <the product's kind, from draw.mjs --app --list kinds> --style ${e.source.slice(12)}` : SOURCE + e.source}`,
].join('\n');

const print = (list) => console.log(options.json ? JSON.stringify(list, null, 2) : list.map(describe).join('\n\n'));
if (options.list) {
  for (const e of LIBRARY.directions) console.log(`${e.id.padEnd(26)} ${e.theme.padEnd(6)} ${e.hue.padEnd(8)} ${e.density.padEnd(8)} ${e.name}`);
  process.exit(0);
}
const show = options.show;
if (show) {
  const e = LIBRARY.directions.find((d) => d.id === show);
  if (!e) {
    fail(`no direction ${show}; deal.mjs --list names them`, 2);
  }
  print([e]);
  process.exit(0);
}
const history = readHistory();
const recent = new Set(history.slice(0, RECENT_DEALS).flatMap((h) => h.ids));
const picked = deal(LIBRARY.directions, { count, recent });
if (!picked) fail(`the library holds no ${count} directions with distinct accents and distinct body faces`, 1);
mkdirSync(dirname(HISTORY), { recursive: true });
const staged = `${HISTORY}.${process.pid}.tmp`;
try {
  writeFileSync(staged, JSON.stringify([{ at: new Date().toISOString(), seed: firstSeed, ids: picked.map((e) => e.id) }, ...history].slice(0, 50), null, 1));
  renameSync(staged, HISTORY);
} finally {
  rmSync(staged, { force: true });
}
const reused = picked.filter((e) => recent.has(e.id)).map((e) => e.id);
const fromRecent = reused.length
  ? `reused from the last ${RECENT_DEALS} deals, since the rest cannot fill a deal of distinct accents and faces: ${reused.join(', ')}`
  : `none was dealt in the last ${RECENT_DEALS} deals`;
if (!options.json) console.log(`dealt ${picked.length} of ${LIBRARY.directions.length} (seed ${firstSeed}; ${fromRecent})\n`);
print(picked);
