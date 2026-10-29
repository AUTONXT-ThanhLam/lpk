#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withPage } from './page.mjs';
import { deltaE, hexOf, oklch, parseHex } from './palette.mjs';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const full = (h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h).toLowerCase();

export function planColours(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = [];
  let inColors = false;
  for (const line of (front ? front[1] : '').split('\n')) {
    if (/^\S/.test(line)) { inColors = /^colors\s*:\s*$/.test(line); continue; }
    const m = inColors && /^\s+([\w-]+)\s*:\s*["']?([^"'\s]+)/.exec(line);
    if (!m) continue;
    if (!HEX.test(m[2])) throw new Error(`colour ${m[1]}: "${m[2]}" is not #rgb or #rrggbb`);
    out.push({ name: m[1], hex: full(m[2]) });
  }
  return out;
}

export function colourCounts(pixels, keepShare = 0.02) {
  const n = new Map();
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const k = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    n.set(k, (n.get(k) || 0) + 1);
    total++;
  }
  const colours = [];
  for (const [k, c] of n) if ((100 * c) / total >= keepShare) colours.push({ rgb: [k >> 16, (k >> 8) & 255, k & 255], weight: c });
  return { total, colours };
}

export function diff(plan, built, { tolerance = 0.03, minShare = 1, total = built.reduce((n, b) => n + b.weight, 0) || 1 } = {}) {
  const pct = (w) => +((100 * w) / total).toFixed(1);
  const near = (rgb, p) => deltaE(rgb, parseHex(p.hex)) <= tolerance;
  const lch = built.map((b) => ({ ...b, o: oklch(b.rgb) }));
  const unplanned = lch
    .filter((b) => !plan.some((p) => near(b.rgb, p)))
    .map((b) => ({ hex: hexOf(b.rgb), share: pct(b.weight), chroma: +b.o.C.toFixed(3) }))
    .filter((b) => b.share >= minShare)
    .sort((a, b) => b.share - a.share);
  const unused = plan.filter((p) => !built.some((b) => near(b.rgb, p))).map((p) => `${p.name} ${p.hex}`);
  const neutrals = lch
    .filter((b) => b.o.C < 0.03)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map((b) => ({ hex: hexOf(b.rgb), share: pct(b.weight), chroma: +b.o.C.toFixed(3), hue: +b.o.h.toFixed(0) }));
  return { chromaticShare: pct(lch.filter((b) => b.o.C >= 0.05).reduce((s, b) => s + b.weight, 0)), neutrals, unplanned, unused };
}

const probe = (png) => `(async () => {
  const count = ${colourCounts};
  const img = new Image();
  img.src = 'data:image/png;base64,${png}';
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  return count(cx.getImageData(0, 0, cv.width, cv.height).data);
})()`;

const usage = 'usage: designdiff.mjs <url> <DESIGN.md> [--width 1440] [--scheme light|dark] [--tolerance 0.03] [--min-share 1]\n  DESIGN.md keeps its colours in the YAML front matter, under "colors:", one "name: \\"#rrggbb\\"" per line.\n  Counts the pixels of the first screen as a person sees it. Exit 2 when a colour that covers min-share percent of the pixels is within no plan colour.';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [url, file, ...rest] = process.argv.slice(2);
  const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i < 0 ? d : rest[i + 1]; };
  if (!url || !file) { console.error(usage); process.exit(2); }
  let plan;
  try { plan = planColours(readFileSync(file, 'utf8')); } catch (e) { console.error(`${e.message}\n${usage}`); process.exit(2); }
  if (!plan.length) { console.error(`${file} has no colours under "colors:" in its front matter\n${usage}`); process.exit(2); }
  const png = await withPage(url, { width: Number(opt('width', 1440)), scheme: opt('scheme', 'light') }, async ({ send }) => (await send('Page.captureScreenshot', { format: 'png' })).data);
  const { total, colours } = await withPage('about:blank', {}, ({ evaluate }) => evaluate(probe(png)));
  const result = diff(plan, colours, { tolerance: Number(opt('tolerance', 0.03)), minShare: Number(opt('min-share', 1)), total });
  console.log(JSON.stringify({ planned: plan.length, pixels: total, ...result }, null, 1));
  console.error(result.unplanned.length ? `DRIFT: ${result.unplanned.map((u) => u.hex).join(', ')} not in the plan` : 'ok');
  process.exit(result.unplanned.length ? 2 : 0);
}
