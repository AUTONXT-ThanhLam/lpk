import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ui-craft');
const LIBRARY = JSON.parse(readFileSync(join(DIR, 'directions.json'), 'utf8'));
const HUES = ['neutral', 'blue', 'indigo', 'violet', 'green', 'teal', 'orange', 'red', 'yellow', 'pink'];

const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const luminance = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function problems(e) {
  const found = [];
  const need = (ok, what) => ok || found.push(what);
  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id ?? ''), 'id');
  need(/^design-md\/[^/]+\/DESIGN\.md$/.test(e.source) || /^taste-skill:[a-z-]+$/.test(e.source), 'source');
  need(Array.isArray(e.live) && e.live.length >= 1 && e.live.length <= 3 && e.live.every((u) => u.startsWith('https://')), 'live');
  need(['light', 'dark'].includes(e.theme) && HUES.includes(e.hue), 'theme or hue');
  need(['compact', 'regular', 'airy'].includes(e.density) && ['flat', 'hairline', 'shadow'].includes(e.depth), 'density or depth');
  need(['sidebar', 'icon-rail', 'top-bar', 'framed-sheet', 'none'].includes(e.shell), 'shell');
  for (const scheme of ['ramp', 'dark']) {
    const r = e[scheme] ?? {};
    if (!['ground', 'raised', 'line', 'muted', 'ink'].every((k) => hex(r[k]))) {
      found.push(`${scheme} colours`);
      continue;
    }
    need(contrast(r.ink, r.ground) >= 7, `${scheme} ink on ground`);
    need(contrast(r.muted, r.ground) >= 4.5 && contrast(r.muted, r.raised) >= 4.5, `${scheme} muted text`);
  }
  const a = e.accent ?? {};
  need(hex(a.value) && hex(a.on) && hex(a.dark) && contrast(a.on, a.value) >= 4.5, 'text on the accent');
  need(hex(a.dark) && hex(e.dark?.ground) && contrast(a.dark, e.dark.ground) >= 3, 'accent in the other scheme');
  need(hex(a.on_dark) && hex(a.dark) && contrast(a.on_dark, a.dark) >= 4.5, 'text on the accent in the other scheme');
  const t = e.type ?? {};
  const face = (f) =>
    typeof f?.family === 'string' && /^@fontsource(-variable)?\/[a-z0-9-]+$/.test(f.package ?? '') && Array.isArray(f.subsets) && f.subsets.includes('latin');
  need(face(t.body) && (t.display === null || face(t.display)), 'a free face from Fontsource');
  need(t.body_px >= 13 && t.body_px <= 15 && t.title_px >= 20 && t.title_px <= 32, 'type sizes');
  const r = e.radius ?? {};
  need(r.control >= 2 && r.card <= 12 && r.card >= r.control, 'radius');
  need(e.move?.length >= 40 && e.keep_out?.length >= 20, 'move and keep_out');
  return found;
}

const run = (history, ...args) =>
  JSON.parse(execFileSync('node', [join(DIR, 'deal.mjs'), '--json', ...args], { env: { ...process.env, LPK_DEAL_HISTORY: history }, encoding: 'utf8' }));

test('every direction in the library can be built as written: readable text in both schemes, a free face', () => {
  const ids = LIBRARY.directions.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'an id is used twice');
  assert.match(LIBRARY.commit, /^[0-9a-f]{40}$/);
  const broken = LIBRARY.directions.map((e) => [e.id, problems(e)]).filter(([, p]) => p.length);
  assert.deepEqual(broken, []);
});

test('every composition says what fills the first screen, and each kind of screen has three or more', () => {
  const { compositions } = JSON.parse(readFileSync(join(DIR, 'compositions.json'), 'utf8'));
  const ids = [...LIBRARY.directions, ...compositions].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'an id is used twice across directions and compositions');
  const broken = compositions.filter((c) => !c.kinds?.length || !['largest', 'needs_person', 'layout', 'fold'].every((k) => c[k]?.length >= 30));
  assert.deepEqual(broken.map((c) => c.id), []);
  for (const kind of new Set(compositions.flatMap((c) => c.kinds))) assert.ok(compositions.filter((c) => c.kinds.includes(kind)).length >= 3, `fewer than three compositions for a ${kind} screen`);
});

test('ten deals in a row never repeat the deal before, and each deal holds three different accents, body faces and compositions', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-deal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = join(dir, 'dealt.jsonl');
  const dealt = Array.from({ length: 10 }, (_, i) => run(history, '--kind', 'list', '--seed', String(i + 1)));
  const deals = dealt.map((deal) => deal.map((e) => e.id));
  const byId = Object.fromEntries(LIBRARY.directions.map((e) => [e.id, e]));
  for (const [i, ids] of deals.entries()) {
    const arranged = dealt[i].map((e) => e.composition.id);
    assert.equal(new Set(arranged).size, 3, `deal ${i + 1} repeats a composition: ${arranged}`);
    if (i) assert.deepEqual(arranged.filter((id) => dealt[i - 1].some((e) => e.composition.id === id)), [], `deal ${i + 1} repeats a composition of deal ${i}`);
    assert.equal(new Set(ids.map((id) => byId[id].hue)).size, 3, `deal ${i + 1} repeats an accent: ${ids}`);
    assert.equal(new Set(ids.map((id) => byId[id].type.body.family)).size, 3, `deal ${i + 1} repeats a body face: ${ids}`);
    if (i) assert.deepEqual(ids.filter((id) => deals[i - 1].includes(id)), [], `deal ${i + 1} repeats deal ${i}`);
  }
  assert.ok(new Set(deals.flat()).size >= 20, 'ten deals reach fewer than 20 directions');
});

const writeHistory = (dir, ...deals) => {
  const history = join(dir, 'dealt.jsonl');
  writeFileSync(history, deals.map((ids, i) => `${JSON.stringify({ at: `2026-10-0${i + 1}T00:00:00.000Z`, seed: i, ids })}\n`).join(''));
  return history;
};
const allIdsBut = (...kept) => LIBRARY.directions.map((e) => e.id).filter((id) => !kept.includes(id));

test('a deal finds the one set of fresh directions with distinct accents and faces, where a first-fit pick fails', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-deal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = writeHistory(dir, allIdsBut('mintlify', 'posthog', 'sentry', 'taste-framed-sheet'));
  const ids = run(history, '--seed', '1').map((e) => e.id);
  assert.deepEqual(ids.sort(), ['mintlify', 'posthog', 'sentry']);
});

test('when the fresh directions cannot fill a deal, the banner names each direction it reused from recent deals', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-deal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const recent = allIdsBut('linear', 'vercel');
  const history = writeHistory(dir, recent.slice(0, 10), recent.slice(10, 20), recent.slice(20));
  const out = execFileSync('node', [join(DIR, 'deal.mjs'), '--seed', '3'], { env: { ...process.env, LPK_DEAL_HISTORY: history }, encoding: 'utf8' });
  const dealt = [...out.matchAll(/^## .+ \(([a-z0-9-]+)\)$/gm)].map((m) => m[1]);
  const reused = dealt.filter((id) => recent.includes(id));
  const banner = out.split('\n')[0];
  for (const id of reused) assert.ok(banner.includes(id), `the banner hides that ${id} was dealt recently: ${banner}`);
  assert.equal(dealt.length, 3);
  assert.equal(reused.length, 1, `a deal reuses more recent directions than it needs: ${dealt}`);
});

test('deals run at the same time each keep their entry in the history', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-deal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = join(dir, 'dealt.jsonl');
  const deal = (seed) =>
    new Promise((resolve, reject) =>
      execFile('node', [join(DIR, 'deal.mjs'), '--json', '--seed', String(seed)], { env: { ...process.env, LPK_DEAL_HISTORY: history } }, (error) => (error ? reject(error) : resolve()))
    );
  await Promise.all(Array.from({ length: 8 }, (_, i) => deal(i + 1)));
  const seeds = readFileSync(history, 'utf8').trim().split('\n').map((line) => JSON.parse(line).seed);
  assert.deepEqual(seeds.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});
