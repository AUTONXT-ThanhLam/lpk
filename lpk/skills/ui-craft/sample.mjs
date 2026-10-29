#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oklch } from './palette.mjs';
import { withPage } from './page.mjs';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export async function imageData(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    const type = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  }
  const type = MIME[src.split('.').pop().toLowerCase()];
  if (!type) throw new Error(`${src}: not a png, jpg, webp or gif file`);
  return `data:${type};base64,${readFileSync(src).toString('base64')}`;
}

export function buckets(pixels, top) {
  const count = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    const key = [0, 1, 2].map((c) => pixels[i + c] >> 3).join(',');
    const b = count.get(key) || { n: 0, sum: [0, 0, 0] };
    b.n++;
    for (let c = 0; c < 3; c++) b.sum[c] += pixels[i + c];
    count.set(key, b);
  }
  const total = [...count.values()].reduce((a, b) => a + b.n, 0) || 1;
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, top).map(({ n, sum }) => {
    const rgb = sum.map((v) => Math.round(v / n));
    const o = oklch(rgb);
    return { hex: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), share: +((100 * n) / total).toFixed(1), L: +o.L.toFixed(3), C: +o.C.toFixed(3), h: +o.h.toFixed(0) };
  });
}

const probe = (data) => `new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 400 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * scale)); cv.height = Math.max(1, Math.round(img.height * scale));
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    resolve({ width: img.width, height: img.height, pixels: Array.from(cx.getImageData(0, 0, cv.width, cv.height).data) });
  };
  img.onerror = () => reject(new Error('the image cannot be decoded'));
  img.src = ${JSON.stringify(data)};
})`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, ...rest] = process.argv.slice(2);
  if (!src) { console.error('usage: sample.mjs <image file or https url> [--top 8]\n  Prints the most used colours of a screenshot or store image (8-level buckets, each by its mean colour, % of opaque pixels, OKLCH), to take reference colours from a measurement instead of by eye.'); process.exit(2); }
  const at = rest.indexOf('--top');
  const top = at < 0 ? 8 : Number(rest[at + 1]);
  if (!Number.isInteger(top) || top < 1) { console.error('--top must be a whole number of 1 or more'); process.exit(2); }
  try {
    const data = await imageData(src);
    const { width, height, pixels } = await withPage('about:blank', {}, ({ evaluate }) => evaluate(probe(data)));
    console.log(JSON.stringify({ source: src, width, height, colours: buckets(pixels, top) }, null, 1));
  } catch (e) { console.error(e.message); process.exit(2); }
}
