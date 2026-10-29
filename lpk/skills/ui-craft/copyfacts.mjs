#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { withPage } from './page.mjs';

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'in', 'on', 'to', 'at', 'by', 'with', 'as', 'vs']);
const HYPE = ['seamless', 'effortless', 'unlock', 'elevate', 'supercharge', 'revolutionize', 'empower', 'leverage', 'cutting-edge', 'next-generation', 'game-changing', 'streamline', 'robust', 'harness', 'unleash', 'journey', 'delve', 'tapestry', 'world-class', 'all-in-one', 'powerful', 'transform your', 'take your'];
const GENERIC_BUTTON = /^(submit|continue|next|click here|yes|no|go|ok)$/i;
const words = (t) => t.split(/\s+/).filter(Boolean);
const titleCase = (t) => {
  const w = words(t).filter((x) => /^[A-Za-z]/.test(x));
  const caps = w.slice(1).filter((x) => !SMALL.has(x.toLowerCase()));
  return w.length >= 3 && caps.length >= 2 && caps.every((x) => /^[A-Z0-9]/.test(x));
};
const spread = (list) => {
  const n = list.map((t) => words(t).length).sort((a, b) => a - b);
  return n.length ? { n: n.length, min: n[0], median: n[n.length >> 1], max: n[n.length - 1] } : { n: 0 };
};

export function copyFacts({ headings = [], buttons = [], paragraphs = [], errors = [] }) {
  const all = [...headings, ...buttons, ...paragraphs, ...errors].join(' ');
  const count = (re) => (all.match(re) || []).length;
  const hype = {};
  for (const h of HYPE) { const n = all.toLowerCase().split(h).length - 1; if (n) hype[h] = n; }
  return {
    headings: { ...spread(headings), titleCase: headings.filter(titleCase).length, endingInPeriod: headings.filter((t) => /\.$/.test(t)).length },
    buttons: { ...spread(buttons), over3Words: buttons.filter((t) => words(t).length > 3).length, titleCase: buttons.filter(titleCase).length, genericLabels: buttons.filter((t) => GENERIC_BUTTON.test(t.trim())).length },
    errors: { n: errors.length },
    emDashes: count(/—/g), exclamations: count(/!/g), threeDots: count(/\.\.\./g), hypeWords: hype,
    samples: { headings: headings.slice(0, 8), buttons: [...new Set(buttons)].slice(0, 12), errors: errors.slice(0, 6) },
  };
}

const probe = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  const take = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => t && t.length < 200);
  return {
    headings: take('h1,h2,h3'),
    buttons: take('button,[role=button]').filter((t) => t.length < 40),
    paragraphs: take('p').filter((t) => t.length > 40),
    errors: take('[role=alert],[aria-live=assertive],.error'),
  };
})()`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [url, ...rest] = process.argv.slice(2);
  if (!url) { console.error('usage: copyfacts.mjs <url> [--width 1440] [--scheme light|dark]\n  Prints counts of mechanical wording facts of the visible headings, buttons, paragraphs and error text. It never fails on wording: the agent decides.'); process.exit(2); }
  const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i < 0 ? d : rest[i + 1]; };
  const text = await withPage(url, { width: Number(opt('width', 1440)), scheme: opt('scheme', 'light') }, ({ evaluate }) => evaluate(probe));
  console.log(JSON.stringify(copyFacts(text), null, 1));
}
