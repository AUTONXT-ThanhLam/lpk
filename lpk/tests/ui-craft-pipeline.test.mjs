import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyFacts } from '../skills/ui-craft/copyfacts.mjs';
import { colourCounts, diff, planColours } from '../skills/ui-craft/designdiff.mjs';
import { parseHex, wcag } from '../skills/ui-craft/palette.mjs';
import { buckets } from '../skills/ui-craft/sample.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ui-craft');
const run = (script, ...args) => spawnSync(process.execPath, [join(KIT, script), ...args], { encoding: 'utf8', timeout: 20000 });

test('palette facts prints the OKLCH of each colour and the contrast of the rest as text on the first', () => {
  const r = run('palette.mjs', 'facts', '#a94700', '#ffffff');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.colours[0].h, 46);
  assert.equal(out.firstAgainstRest[0].wcag, 5.85);
});

test('palette make gives each scheme a neutral ramp and an accent whose text colour passes AA', () => {
  const r = run('palette.mjs', 'make', '--accent', '#a94700');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const mode of ['light', 'dark']) {
    assert.equal(out[mode].neutral.length, 12);
    assert.match(out[mode].accent.solid, /^#[0-9a-f]{6}$/);
  }
  const lum = (h) => parseHex(h).map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const { solid, onSolid } = out.light.accent;
  const [hi, lo] = [lum(solid), lum(onSolid)].sort((a, b) => b - a);
  assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5);
});

test('every accent text colour passes AA on its tints, for any hue', () => {
  const out = JSON.parse(run('palette.mjs', 'make', '--accent', '#8a6a5a').stdout);
  for (const mode of ['light', 'dark']) {
    const { text, tints } = out[mode].accent;
    for (const tint of tints) assert.ok(wcag(parseHex(text), parseHex(tint)) >= 4.5, `${mode} ${text} on ${tint}`);
  }
});

test('palette refuses a malformed colour and a make without a hue with usage and exit 2', () => {
  for (const args of [['facts', '#zz'], ['facts'], ['make'], ['make', '--hue', 'x'], ['make', '--hue', ''], ['make', '--accent', '#a94700', '--neutral-hue', '']]) {
    const r = run('palette.mjs', ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: palette\.mjs/);
  }
});

const PLAN = `---\nname: Brew\ncolors:\n  ground: "#f4f6fa"\n  accent: '#a94700' # reference 2\ntypography:\n  body:\n    color: "#123456"\nrounded:\n  md: 8px\n---\n\n# Brew\n\n- note: #654321\n`;
const built = (hex, weight) => ({ rgb: parseHex(hex), weight, where: 'background div' });

test('the plan reads only the colour lines under colors in the front matter', () => {
  assert.deepEqual(planColours(PLAN), [{ name: 'ground', hex: '#f4f6fa' }, { name: 'accent', hex: '#a94700' }]);
});

test('a built colour that is in no plan colour and covers enough of the screen is reported, a planned or tiny one is not', () => {
  const plan = planColours(PLAN);
  const r = diff(plan, [built('#f4f6fa', 80), built('#a94800', 5), built('#2a9d3c', 14), built('#ff00ff', 0.5)]);
  assert.deepEqual(r.unplanned.map((u) => u.hex), ['#2a9d3c']);
  assert.deepEqual(r.unused, []);
  assert.deepEqual(diff(plan, [built('#f4f6fa', 100)]).unused, ['accent #a94700']);
});

test('the pixels of a screenshot give each colour its share of the screen, the page ground included', () => {
  const px = (rgb, n) => Array.from({ length: n }, () => [...rgb, 255]).flat();
  const { total, colours } = colourCounts(Uint8ClampedArray.from([...px([244, 246, 250], 80), ...px([169, 71, 0], 15), ...px([42, 157, 60], 5)]), 10);
  assert.equal(total, 100);
  const r = diff(planColours(PLAN), colours, { total });
  assert.equal(r.neutrals[0].share, 80);
  assert.equal(r.chromaticShare, 20);
  assert.deepEqual(r.unplanned.map((u) => [u.hex, u.share]), [['#2a9d3c', 5]]);
});

test('a gradient is grouped by near colour before the share cut, and a planned colour in a tiny element is not unused', () => {
  const px = (rgb, n) => Array.from({ length: n }, () => [...rgb, 255]).flat();
  const steps = Array.from({ length: 50 }, (_, i) => px([255 - i * 5, 0, i * 5], 4)).flat();
  const gradient = colourCounts(Uint8ClampedArray.from([...px([244, 246, 250], 100), ...steps]), 30);
  assert.ok(diff(planColours(PLAN), gradient.colours, { total: gradient.total }).unplanned.length > 0);
  const dot = colourCounts(Uint8ClampedArray.from([...px([244, 246, 250], 99999), ...px([169, 71, 0], 1)]), 100);
  assert.deepEqual(diff(planColours(PLAN), dot.colours, { total: dot.total }).unused, []);
});

test('a plan colour written in a form the diff cannot read is refused with a usage error', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'plan-')), 'DESIGN.md');
  writeFileSync(file, '---\nname: Brew\ncolors:\n  ground: "#f4f6fa80"\n---\n');
  const r = run('designdiff.mjs', 'http://127.0.0.1:1/', file);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not #rgb or #rrggbb/);
});

test('designdiff and copyfacts without a url print usage and exit 2', () => {
  for (const script of ['designdiff.mjs', 'copyfacts.mjs']) {
    const r = run(script);
    assert.equal(r.status, 2, script);
    assert.match(r.stderr, new RegExp(`usage: ${script}`));
  }
  const file = join(mkdtempSync(join(tmpdir(), 'plan-')), 'DESIGN.md');
  writeFileSync(file, '---\nname: Brew\n---\n\n# Brew\n\n- ground: #f4f6fa\n');
  const noPlan = run('designdiff.mjs', 'http://127.0.0.1:1/', file);
  assert.equal(noPlan.status, 2);
  assert.match(noPlan.stderr, /colors:/);
});

test('copyfacts counts em dashes, exclamations, title case, long and generic buttons and hype words, and decides nothing', () => {
  const facts = copyFacts({
    headings: ['Start Your Brew Today', 'Today'],
    buttons: ['Submit', 'Start brew', 'Save this recipe for later'],
    text: 'Start Your Brew Today! Unlock a seamless brew — every time! Start brew',
  });
  assert.equal(facts.headings.titleCase, 1);
  assert.equal(facts.buttons.over3Words, 1);
  assert.equal(facts.buttons.genericLabels, 1);
  assert.equal(facts.emDashes, 1);
  assert.equal(facts.exclamations, 2);
  assert.deepEqual(facts.hypeWords, { seamless: 1, unlock: 1 });
});

test('sample reports the mean colour of a bucket and refuses a --top it cannot read', () => {
  const mixed = buckets([248, 248, 248, 255, 250, 250, 250, 255], 1);
  assert.equal(mixed[0].hex, '#f9f9f9');
  const bad = run('sample.mjs', 'shot.png', '--top');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--top/);
});

test('sample ranks the colours of an image by share, ignores transparent pixels, and refuses a file that is not an image', () => {
  const px = [252, 252, 252, 255, 252, 252, 252, 255, 252, 252, 252, 255, 169, 71, 0, 255, 0, 0, 0, 0];
  const top = buckets(px, 5);
  assert.equal(top[0].share, 75);
  assert.equal(top[1].share, 25);
  assert.ok(top[1].C > 0.1);
  assert.equal(run('sample.mjs').status, 2);
  const bad = run('sample.mjs', 'notes.txt');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a png/);
});
