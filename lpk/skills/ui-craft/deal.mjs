#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = JSON.parse(readFileSync(join(HERE, 'directions.json'), 'utf8'));
const COMPOSITIONS = JSON.parse(readFileSync(join(HERE, 'compositions.json'), 'utf8')).compositions;
const KINDS = [...new Set(COMPOSITIONS.flatMap((c) => c.kinds))];
const SOURCE = `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/${LIBRARY.commit}/`;
const HISTORY = process.env.LPK_DEAL_HISTORY || join(homedir(), '.local', 'share', 'lpk', 'design-kit', 'dealt.jsonl');
const RECENT_DEALS = 4;
const AXES = ['density', 'depth', 'shell'];

const args = process.argv.slice(2);
const usage = `usage: deal.mjs [--count 3] [--kind ${KINDS.join('|')}] [--seed N] [--json] | deal.mjs --show <id> [--json] | deal.mjs --list`;
const fail = (message, code) => {
  console.error(message);
  process.exit(code);
};
const options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i].startsWith('--') ? args[i].slice(2) : '';
  if (['json', 'list'].includes(name)) options[name] = true;
  else if (['count', 'kind', 'seed', 'show'].includes(name) && i + 1 < args.length) options[name] = args[++i];
  else fail(usage, 2);
}
const count = Number(options.count ?? 3);
if (!Number.isInteger(count) || count < 1 || count > 6 || (options.seed !== undefined && !Number.isInteger(Number(options.seed))) || (options.kind !== undefined && !KINDS.includes(options.kind))) fail(usage, 2);

const readHistory = () => {
  let lines;
  try {
    lines = readFileSync(HISTORY, 'utf8').split('\n');
  } catch {
    return [];
  }
  return lines.flatMap((line) => {
    try {
      const deal = JSON.parse(line);
      return Array.isArray(deal?.ids) ? [deal] : [];
    } catch {
      return [];
    }
  });
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

function deal(entries, { count, recent, lastDealt }) {
  const pool = shuffle(entries);
  let best = null;
  const picked = [];
  const visit = (from, reused, age, spread) => {
    if (picked.length === count) {
      if (count > 1 && new Set(picked.map((p) => p.theme)).size < 2) return;
      const shells = new Set(picked.map((p) => p.shell)).size;
      if (!best || [best.reused - reused, best.age - age, shells - best.shells, spread - best.spread].find((d) => d !== 0) > 0) best = { picked: [...picked], reused, age, shells, spread };
      return;
    }
    for (let i = from; i < pool.length; i++) {
      const e = pool[i];
      if (picked.some((p) => p.hue === e.hue || p.type.body.family === e.type.body.family)) continue;
      picked.push(e);
      visit(i + 1, reused + recent.has(e.id), age + (lastDealt.get(e.id) ?? -1), Math.min(spread, ...picked.slice(0, -1).map((p) => differences(p, e))));
      picked.pop();
    }
  };
  visit(0, 0, 0, 2);
  return best?.picked;
}

const face = (f) => `${f.family} (npm i ${f.package}; subsets ${f.subsets.join(', ')})`;
const arrange = (c) => [
  `## Composition: ${c.name} (${c.id}), for a ${c.kinds.join(' or ')} screen`,
  `largest region: ${c.largest}`,
  `what needs the person: ${c.needs_person}`,
  `layout: ${c.layout}`,
  `above the fold at 1440x900: ${c.fold}`,
].join('\n');
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
  ...(e.composition ? ['', arrange(e.composition)] : []),
].join('\n');

const print = (list) => console.log(options.json ? JSON.stringify(list, null, 2) : list.map((e) => (e.kinds ? arrange(e) : describe(e))).join('\n\n'));
if (options.list) {
  for (const e of LIBRARY.directions) console.log(`${e.id.padEnd(26)} ${e.theme.padEnd(6)} ${e.hue.padEnd(8)} ${e.density.padEnd(8)} ${e.name}`);
  for (const c of COMPOSITIONS) console.log(`${c.id.padEnd(26)} ${c.kinds.join(', ').padEnd(24)} ${c.name}`);
  process.exit(0);
}
const show = options.show;
if (show) {
  const e = [...LIBRARY.directions, ...COMPOSITIONS].find((d) => d.id === show);
  if (!e) fail(`no direction or composition ${show}; deal.mjs --list names them`, 2);
  print([e]);
  process.exit(0);
}
const history = readHistory();
const recent = new Set(history.slice(-RECENT_DEALS).flatMap((h) => h.ids));
const lastDealt = new Map(history.flatMap((h, i) => h.ids.map((id) => [id, i])));
const picked = deal(LIBRARY.directions, { count, recent, lastDealt });
if (!picked) fail(`the library holds no ${count} directions with distinct accents and distinct body faces in both schemes`, 1);
const lastArranged = new Map(history.flatMap((h, i) => (h.compositions ?? []).map((id) => [id, i])));
const lastUsed = (c) => lastArranged.get(c.id) ?? -1;
const arrangements = options.kind ? shuffle(COMPOSITIONS.filter((c) => c.kinds.includes(options.kind))).sort((a, b) => lastUsed(a) - lastUsed(b)) : [];
if (options.kind && arrangements.length < count) fail(`the library holds ${arrangements.length} compositions for a ${options.kind} screen, fewer than ${count}`, 1);
const dealt = picked.map((e, i) => (options.kind ? { ...e, composition: arrangements[i] } : e));
mkdirSync(dirname(HISTORY), { recursive: true });
const entry = { at: new Date().toISOString(), seed: firstSeed, ids: picked.map((e) => e.id), ...(options.kind && { compositions: dealt.map((e) => e.composition.id) }) };
appendFileSync(HISTORY, `${JSON.stringify(entry)}\n`);
const reused = picked.filter((e) => recent.has(e.id)).map((e) => e.id);
const fromRecent = reused.length
  ? `reused from the last ${RECENT_DEALS} deals, since the rest cannot fill a deal of distinct accents and faces: ${reused.join(', ')}`
  : `none was dealt in the last ${RECENT_DEALS} deals`;
const arranged = options.kind ? `each with a different composition for a ${options.kind} screen` : `no composition, since no --kind was given`;
if (!options.json) console.log(`dealt ${picked.length} of ${LIBRARY.directions.length} (seed ${firstSeed}; ${fromRecent}; ${arranged})\n`);
print(dealt);
