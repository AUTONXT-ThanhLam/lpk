import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyFacts } from '../skills/ui-craft/copyfacts.mjs';
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

test('copyfacts without a url prints usage and exits 2', () => {
  const r = run('copyfacts.mjs');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: copyfacts\.mjs/);
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
