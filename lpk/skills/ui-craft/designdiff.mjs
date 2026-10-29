#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withPage } from './page.mjs';
import { deltaE, hexOf, oklch, parseHex } from './palette.mjs';

export function planColours(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = [];
  let inColors = false;
  for (const line of (front ? front[1] : '').split('\n')) {
    if (/^\S/.test(line)) { inColors = /^colors\s*:\s*$/.test(line); continue; }
    const m = inColors && /^\s+([\w-]+)\s*:\s*["']?(#[0-9a-f]{6})\b/i.exec(line);
    if (m) out.push({ name: m[1], hex: m[2].toLowerCase() });
  }
  return out;
}

export function diff(plan, built, { tolerance = 0.03, minShare = 1 } = {}) {
  const total = built.reduce((n, b) => n + b.weight, 0) || 1;
  const near = (rgb, p) => deltaE(rgb, parseHex(p.hex)) <= tolerance;
  const unplanned = built
    .filter((b) => !plan.some((p) => near(b.rgb, p)))
    .map((b) => ({ hex: hexOf(b.rgb), share: +((100 * b.weight) / total).toFixed(1), chroma: +oklch(b.rgb).C.toFixed(3), where: b.where }))
    .filter((b) => b.share >= minShare)
    .sort((a, b) => b.share - a.share);
  const unused = plan.filter((p) => !built.some((b) => near(b.rgb, p))).map((p) => `${p.name} ${p.hex}`);
  const share = (keep) => +((100 * built.filter((b) => keep(oklch(b.rgb))).reduce((n, b) => n + b.weight, 0)) / total).toFixed(1);
  const neutralHues = {};
  for (const b of built) {
    const o = oklch(b.rgb);
    if (o.C < 0.03 && o.C > 0.003) { const bin = (Math.round(o.h / 30) * 30) % 360; neutralHues[bin] = +(((neutralHues[bin] || 0) + (100 * b.weight) / total)).toFixed(1); }
  }
  return { chromaticShare: share((o) => o.C >= 0.05), neutralHueShareByDegrees: neutralHues, unplanned, unused };
}

const probe = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const ground = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.99) return c; } return rgba(getComputedStyle(document.documentElement).backgroundColor).map((v, i) => (i < 3 && v === 0 ? 255 : v)); };
  const over = (c, g) => [0, 1, 2].map((i) => Math.round(c[i] * c[3] + g[i] * (1 - c[3])));
  const seen = new Map();
  const add = (rgb, w, where) => { const k = rgb.join(','); const s = seen.get(k) || { rgb, weight: 0, where }; s.weight += w; seen.set(k, s); };
  const path = (e) => e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '');
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  for (const e of document.body.querySelectorAll('*')) {
    if (!vis(e)) continue;
    const s = getComputedStyle(e); const r = e.getBoundingClientRect(); const g = ground(e.parentElement || e);
    const bg = rgba(s.backgroundColor);
    if (bg[3] > 0) add(over(bg, g), Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight), 'background ' + path(e));
    const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).reduce((n, t) => n + t.textContent.trim().length, 0);
    if (own) add(over(rgba(s.color), bg[3] > 0.99 ? bg : g), own * parseFloat(s.fontSize) ** 2 * 0.3, 'text ' + path(e));
    if (e instanceof SVGGeometryElement) {
      if (s.fill !== 'none' && !/url/.test(s.fill)) add(over(rgba(s.fill), g), Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight), 'svg fill ' + path(e));
      if (s.stroke !== 'none' && !/url/.test(s.stroke)) add(over(rgba(s.stroke), g), (r.width + r.height) * (parseFloat(s.strokeWidth) || 1), 'svg stroke ' + path(e));
    }
  }
  return [...seen.values()];
})()`;

const usage = 'usage: designdiff.mjs <url> <DESIGN.md> [--width 1440] [--scheme light|dark] [--tolerance 0.03] [--min-share 1]\n  DESIGN.md keeps its colours in the YAML front matter, under "colors:", one "name: \"#rrggbb\"" per line.\n  Exit 2 when a built colour that covers min-share percent of the screen is within no plan colour.';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [url, file, ...rest] = process.argv.slice(2);
  const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i < 0 ? d : rest[i + 1]; };
  if (!url || !file) { console.error(usage); process.exit(2); }
  const plan = planColours(readFileSync(file, 'utf8'));
  if (!plan.length) { console.error(`${file} has no colours under "colors:" in its front matter\n${usage}`); process.exit(2); }
  const built = await withPage(url, { width: Number(opt('width', 1440)), scheme: opt('scheme', 'light') }, ({ evaluate }) => evaluate(probe));
  const result = diff(plan, built, { tolerance: Number(opt('tolerance', 0.03)), minShare: Number(opt('min-share', 1)) });
  console.log(JSON.stringify({ planned: plan.length, built: built.length, ...result }, null, 1));
  console.error(result.unplanned.length ? `DRIFT: ${result.unplanned.map((u) => u.hex).join(', ')} not in the plan` : 'ok');
  process.exit(result.unplanned.length ? 2 : 0);
}
