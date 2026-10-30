import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyFacts } from '../skills/ui-craft/copyfacts.mjs';
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

test('palette refuses a malformed colour and a missing one with usage and exit 2', () => {
  for (const args of [['facts', '#zz'], ['facts'], ['make', '--hue', '200']]) {
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

const chromeUp = await fetch('http://127.0.0.1:9333/json/version').then((r) => r.ok, () => false);

test('copyfacts on a page counts the text a person sees and not hidden, transparent or clipped copy', { skip: !chromeUp && 'no Chrome on port 9333' }, () => {
  const page = '<h1>Plain heading</h1><p>Short copy!</p><span style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Unlock a seamless dashboard!</span><div style="opacity:0"><b>Supercharge</b> your journey!</div><div style="display:none">Leverage this!</div><p>Visible <a href="#">link</a> here — done.</p>';
  const dir = mkdtempSync(join(tmpdir(), 'copyfacts-'));
  writeFileSync(join(dir, 'p.html'), `<meta charset="utf-8">${page}`);
  const r = run('copyfacts.mjs', pathToFileURL(join(dir, 'p.html')).href);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 0, r.stderr);
  const facts = JSON.parse(r.stdout);
  assert.equal(facts.exclamations, 1);
  assert.equal(facts.emDashes, 1);
  assert.deepEqual(facts.hypeWords, {});
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
