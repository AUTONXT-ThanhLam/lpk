#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

export const parseHex = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${h}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); };

export function oklab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklch(rgb) {
  const [L, a, b] = oklab(rgb);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

const luminance = (rgb) => { const [r, g, b] = rgb.map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function wcag(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const apcaY = (rgb) => { const [r, g, b] = rgb.map((c) => (c / 255) ** 2.4); const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b; return y < 0.022 ? y + (0.022 - y) ** 1.414 : y; };
export function apca(text, ground) {
  const [yt, yb] = [apcaY(text), apcaY(ground)];
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const s = (yb ** 0.56 - yt ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

export function facts(hexes) {
  const rgbs = hexes.map(parseHex);
  const colours = hexes.map((h, i) => { const o = oklch(rgbs[i]); return { hex: h.toLowerCase(), L: +o.L.toFixed(3), C: +o.C.toFixed(3), h: +o.h.toFixed(0) }; });
  const against = rgbs.slice(1).map((rgb, i) => ({ text: colours[i + 1].hex, ground: colours[0].hex, wcag: +wcag(rgb, rgbs[0]).toFixed(2), apca: +apca(rgb, rgbs[0]).toFixed(1) }));
  return { colours, firstAgainstRest: against };
}

const usage = 'usage: palette.mjs facts <#rrggbb> [<#rrggbb>...]   (OKLCH of each; WCAG and APCA of each later colour as text on the first)';
const fail = (msg) => { console.error(msg ? `${msg}\n${usage}` : usage); process.exit(2); };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'facts' && rest.length) console.log(JSON.stringify(facts(rest), null, 1));
    else fail();
  } catch (e) { fail(e.message); }
}
