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
export const deltaE = (x, y) => { const [a, b] = [oklab(x), oklab(y)]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };

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

const toLin = (L, C, h) => {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
const inGamut = (L, C, h) => toLin(L, C, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
export function maxChroma(L, h) {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inGamut(L, mid, h)) lo = mid; else hi = mid; }
  return lo;
}
export const toHex = (L, C, h) => '#' + toLin(L, Math.min(C, maxChroma(L, h)), h).map((v) => fromLinear(v).toString(16).padStart(2, '0')).join('');
export const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

const LADDER = {
  light: [0.991, 0.982, 0.955, 0.931, 0.907, 0.885, 0.851, 0.792, 0.643, 0.61, 0.503, 0.244],
  dark: [0.178, 0.213, 0.252, 0.285, 0.313, 0.348, 0.402, 0.489, 0.538, 0.583, 0.77, 0.949],
};
const NEUTRAL_C = [0.002, 0.003, 0.005, 0.006, 0.008, 0.01, 0.012, 0.016, 0.017, 0.016, 0.014, 0.011];
export const neutralRamp = (hue, mode) => LADDER[mode].map((L, i) => toHex(L, NEUTRAL_C[i], hue));

export function accentSet(hue, mode) {
  let L = 0.66;
  while (L > 0.5 && maxChroma(L, hue) < 0.19) L -= 0.005;
  const solid = toHex(L, 0.19, hue);
  const white = wcag([255, 255, 255], parseHex(solid)) >= 4.5 && Math.abs(apca([255, 255, 255], parseHex(solid))) >= 60;
  const tints = (mode === 'light'
    ? [[0.982, 0.008], [0.961, 0.017], [0.935, 0.031], [0.902, 0.047]]
    : [[0.209, 0.03], [0.272, 0.07], [0.318, 0.095], [0.362, 0.104]]).map(([l, c]) => toHex(l, c, hue));
  const textC = mode === 'light' ? 0.17 : 0.12;
  let textL = mode === 'light' ? 0.52 : 0.775;
  const step = mode === 'light' ? -0.005 : 0.005;
  while (textL > 0.2 && textL < 0.98 && wcag(parseHex(toHex(textL, textC, hue)), parseHex(tints[3])) < 4.5) textL += step;
  return {
    solid, solidHover: toHex(L - 0.025, 0.19, hue), onSolid: white ? '#ffffff' : '#111111',
    tints, text: toHex(textL, textC, hue),
  };
}

export function facts(hexes) {
  const rgbs = hexes.map(parseHex);
  const colours = hexes.map((h, i) => { const o = oklch(rgbs[i]); return { hex: h.toLowerCase(), L: +o.L.toFixed(3), C: +o.C.toFixed(3), h: +o.h.toFixed(0) }; });
  const against = rgbs.slice(1).map((rgb, i) => ({ text: colours[i + 1].hex, ground: colours[0].hex, wcag: +wcag(rgb, rgbs[0]).toFixed(2), apca: +apca(rgb, rgbs[0]).toFixed(1) }));
  return { colours, firstAgainstRest: against };
}

const usage = 'usage: palette.mjs facts <#rrggbb> [<#rrggbb>...]   (OKLCH of each; WCAG and APCA of each later colour as text on the first)\n       palette.mjs make --hue <deg> [--neutral-hue <deg>]  or  --accent <#rrggbb>   (light and dark neutral ramp and accent set; --accent gives only the hue of that colour)';
const fail = (msg) => { console.error(msg ? `${msg}\n${usage}` : usage); process.exit(2); };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(`--${n}`); return i < 0 ? undefined : rest[i + 1]; };
  try {
    if (cmd === 'facts' && rest.length) console.log(JSON.stringify(facts(rest), null, 1));
    else if (cmd === 'make') {
      const num = (name) => {
        const v = opt(name);
        if (v === undefined) return undefined;
        if (v === '' || v.startsWith('--') || !Number.isFinite(Number(v))) fail(`--${name} must be a number`);
        return Number(v);
      };
      const accentHex = opt('accent');
      if (accentHex !== undefined) parseHex(accentHex);
      const hue = accentHex === undefined ? num('hue') : oklch(parseHex(accentHex)).h;
      if (hue === undefined) fail('make needs --hue <deg> or --accent <#rrggbb>');
      const nh = num('neutral-hue') ?? hue;
      const out = {};
      for (const mode of ['light', 'dark']) out[mode] = { neutral: neutralRamp(nh, mode), accent: accentSet(hue, mode) };
      console.log(JSON.stringify(out, null, 1));
    } else fail();
  } catch (e) { fail(e.message); }
}
