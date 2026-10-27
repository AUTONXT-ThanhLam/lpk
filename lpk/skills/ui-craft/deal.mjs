#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = JSON.parse(readFileSync(join(HERE, 'directions.json'), 'utf8'));
const SOURCE = `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/${LIBRARY.commit}/`;
const HISTORY = process.env.LPK_DEAL_HISTORY || join(homedir(), '.local', 'share', 'lpk', 'design-kit', 'dealt.json');
const RECENT_DEALS = 4;
const AXES = ['hue', 'theme', 'density', 'depth', 'shell'];

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const usage = 'usage: deal.mjs [--count 3] [--theme light|dark] [--seed N] [--json] | deal.mjs --show <id> [--json] | deal.mjs --list';
const count = Number(opt('count') ?? 3);
const theme = opt('theme');
if (!Number.isInteger(count) || count < 1 || count > 6 || (theme && !['light', 'dark'].includes(theme))) {
  console.error(usage);
  process.exit(2);
}

const readHistory = () => {
  try {
    return JSON.parse(readFileSync(HISTORY, 'utf8'));
  } catch {
    return [];
  }
};

let seed = Number(opt('seed') ?? Math.floor(Math.random() * 2 ** 31)) | 0;
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
const differences = (a, b) => AXES.filter((axis) => a[axis] !== b[axis]).length;

function deal(entries, { count, theme, recent }) {
  const fitting = entries.filter((e) => !theme || e.theme === theme);
  const fresh = fitting.filter((e) => !recent.has(e.id));
  const pool = shuffle(fresh.length >= count ? fresh : fitting);
  for (const needed of [3, 2, 1, 0]) {
    const picked = [];
    for (const e of pool) {
      if (picked.length === count) break;
      if (picked.every((p) => p.hue !== e.hue && differences(p, e) >= needed && (!needed || p.type.body.family !== e.type.body.family))) picked.push(e);
    }
    if (picked.length === count) return picked;
  }
  return pool.slice(0, count);
}

const describe = (e) => [
  `## ${e.name} (${e.id})`,
  `${e.theme}, ${e.hue} accent, ${e.density}, depth ${e.depth}, shell ${e.shell}`,
  `move: ${e.move}`,
  `keep out: ${e.keep_out}`,
  `ramp (${e.theme}): ${Object.entries(e.ramp).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `ramp (other scheme): ${Object.entries(e.dark).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `accent: ${e.accent.name} ${e.accent.value} (text on it ${e.accent.on}, other scheme ${e.accent.dark}); ${e.accent.use}`,
  `type: ${e.type.body.family} (npm i ${e.type.body.package})${e.type.display ? `, display ${e.type.display.family} (npm i ${e.type.display.package})` : ''}; weights ${e.type.weights.join(' and ')}; body ${e.type.body_px} px, title ${e.type.title_px} px${e.type.stands_in_for ? `; stands in for ${e.type.stands_in_for}` : ''}`,
  `radius: control ${e.radius.control} px, card ${e.radius.card} px`,
  `look at: ${e.live.join(' ')}`,
  `source: ${e.source.startsWith('taste-skill:') ? `node <design-taste-frontend>/scripts/draw.mjs --app --style ${e.source.slice(12)}` : SOURCE + e.source}`,
].join('\n');

const print = (list) => console.log(args.includes('--json') ? JSON.stringify(list, null, 2) : list.map(describe).join('\n\n'));
if (args.includes('--list')) {
  for (const e of LIBRARY.directions) console.log(`${e.id.padEnd(26)} ${e.theme.padEnd(6)} ${e.hue.padEnd(8)} ${e.density.padEnd(8)} ${e.name}`);
  process.exit(0);
}
const show = opt('show');
if (show) {
  const e = LIBRARY.directions.find((d) => d.id === show);
  if (!e) {
    console.error(`no direction ${show}; deal.mjs --list names them`);
    process.exit(2);
  }
  print([e]);
  process.exit(0);
}
const history = readHistory();
const recent = new Set(history.slice(0, RECENT_DEALS).flatMap((h) => h.ids));
const picked = deal(LIBRARY.directions, { count, theme, recent });
mkdirSync(dirname(HISTORY), { recursive: true });
writeFileSync(HISTORY, JSON.stringify([{ at: new Date().toISOString(), seed: firstSeed, ids: picked.map((e) => e.id) }, ...history].slice(0, 50), null, 1));
if (!args.includes('--json')) console.log(`dealt ${picked.length} of ${LIBRARY.directions.length} (seed ${firstSeed}; the last ${RECENT_DEALS} deals are skipped)\n`);
print(picked);
