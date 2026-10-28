#!/usr/bin/env node
import { withPage } from './page.mjs';
import { fontVerdict } from './fontverdict.mjs';
const [url, ...rest] = process.argv.slice(2);
if (!url) {
  console.error('usage: audit.mjs <url> [--width 1440 (720 is 200% zoom of 1440)] [--scheme light|dark] [--tabs 60] [--space 0,4,8,...] [--radius 0,4,6,...] [--heights 24,28,32,...]');
  process.exit(2);
}
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i < 0 ? d : rest[i + 1]; };
const spaceScale = (opt('space', '0,2,4,8,12,16,24,32,40,48,64')).split(',').map(Number);
const radiusScale = (opt('radius', '0,4,5,6,8,10,12,9999')).split(',').map(Number);
const heights = (opt('heights', '24,28,32,40,48')).split(',').map(Number);
const probe = `(() => { const fontVerdict = ${fontVerdict}; return (${function (spaceScale, radiusScale, heights) {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  const sel = (e) => { let p = e.tagName.toLowerCase(); if (e.id) p += '#' + e.id; else if (e.classList[0]) p += '.' + [...e.classList].slice(0, 2).join('.'); return p + (e.textContent.trim() ? ` "${e.textContent.trim().slice(0, 24)}"` : ''); };
  const all = [...document.body.querySelectorAll('*')].filter((e) => vis(e) && e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1);
  const bad = { space: {}, radius: {}, height: {} };
  const note = (bucket, key, e) => { const b = bad[bucket][key] ||= { n: 0, e: sel(e) }; b.n++; };
  const sizes = {}, weights = {}, families = {};
  const inter = 'a[href],button,input,select,textarea,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[tabindex]:not([tabindex="-1"])';
  for (const e of all) {
    const s = getComputedStyle(e);
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      const v = parseFloat(s[p]); if (v && !spaceScale.includes(Math.round(v * 2) / 2)) note('space', v + 'px', e);
    }
    for (const p of ['borderTopLeftRadius', 'borderTopRightRadius']) {
      const v = Math.min(parseFloat(s[p]) || 0, 9999); if (v && !radiusScale.includes(Math.round(v)) && v < e.getBoundingClientRect().height / 2 - 0.5) note('radius', v + 'px', e);
    }
    if (e.matches('button,input:not([type=checkbox]):not([type=radio]),select,[role=button]')) { const h = Math.round(e.getBoundingClientRect().height); if (!heights.includes(h)) note('height', h + 'px', e); }
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      sizes[s.fontSize] = (sizes[s.fontSize] || 0) + 1; weights[s.fontWeight] = (weights[s.fontWeight] || 0) + 1;
      families[s.fontFamily] = 1;
    }
  }
  const clipped = [], truncated = [], covered = [], overlapText = [];
  for (const e of all) {
    const s = getComputedStyle(e);
    if (/hidden|clip/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.textContent.trim()) {
      (s.textOverflow === 'ellipsis' ? (e.title || e.getAttribute('aria-label') ? [] : truncated) : clipped).push(sel(e));
    }
    if (/hidden|clip/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && e.textContent.trim() && s.display !== 'inline' && !/auto|scroll/.test(s.overflowY)) clipped.push(sel(e) + ' (height)');
  }
  const ints = all.filter((e) => e.matches(inter));
  const smallTargets = ints.filter((e) => !(e.matches('a') && getComputedStyle(e).display === 'inline')).filter((e) => {
    const box = e.matches('input') ? (e.labels && e.labels[0]) || e.closest('label') || e : e;
    const r = box.getBoundingClientRect();
    return r.width < 24 || r.height < 24;
  }).map(sel);
  const ungatedHover = [], longTransitions = [], layoutTransitions = [], scaleZero = [];
  let easeInKeyframes = 0;
  const walk = (rules, gated) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE) walk(rule.cssRules, gated || /hover:\s*hover/.test(rule.conditionText));
      else if (rule.type === CSSRule.SUPPORTS_RULE) walk(rule.cssRules, gated);
      else if (rule.type === CSSRule.KEYFRAMES_RULE) {
        for (const k of rule.cssRules) if (k.style.animationTimingFunction === 'ease-in') easeInKeyframes++;
        const first = rule.cssRules[0];
        if (first && /scale\(0\)/.test(first.style.transform || '')) scaleZero.push(rule.name);
      } else if (rule.selectorText && !gated && /:hover/.test(rule.selectorText) && /transform|translate|scale/.test(rule.style.cssText)) ungatedHover.push(rule.selectorText);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, false); } catch (err) { continue; } }
  const meta = document.querySelector('meta[name=viewport]');
  const zoomLocked = !!meta && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(meta.content);
  const motion = { transitionAll: [], easeIn: [] };
  for (const e of all) {
    const s = getComputedStyle(e);
    if (!s.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) continue;
    if (s.transitionProperty.split(',').some((p) => p.trim() === 'all')) motion.transitionAll.push(sel(e));
    if (s.transitionTimingFunction.split(/,(?![^(]*\))/).some((t) => t.trim() === 'ease-in')) motion.easeIn.push(sel(e));
    if (s.transitionDuration.split(',').some((d) => parseFloat(d) > 0.3)) longTransitions.push(sel(e));
    if (s.transitionProperty.split(',').some((p) => /^(width|height|top|left|right|bottom|margin|padding)/.test(p.trim()))) layoutTransitions.push(sel(e));
  }
  for (const e of all) {
    const s = getComputedStyle(e);
    if (s.animationName !== 'none' && s.animationTimingFunction.split(/,(?![^(]*\))/).some((t) => t.trim() === 'ease-in')) motion.easeIn.push(sel(e));
  }
  if (easeInKeyframes) motion.easeIn.push('@keyframes x' + easeInKeyframes);
  for (const e of ints) {
    const r = e.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue;
    const t = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
    if (t && !e.contains(t) && !t.contains(e)) covered.push(sel(e) + ' under ' + sel(t));
  }
  const leaves = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.querySelector('*'));
  const range = (e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
  for (let i = 0; i < leaves.length && i < 400; i++) for (let j = i + 1; j < leaves.length && j < 400; j++) {
    const a = range(leaves[i]), b = range(leaves[j]);
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2 && !leaves[i].contains(leaves[j]) && !leaves[j].contains(leaves[i])) overlapText.push(sel(leaves[i]) + ' x ' + sel(leaves[j]));
  }
  const faces = [...document.fonts].map((x) => ({ family: x.family, status: x.status }));
  const loaded = Object.keys(families).map((stack) => [stack, fontVerdict(stack, faces)]);
  return {
    pageOverflowX: document.documentElement.scrollWidth - innerWidth, scrollY: scrollY,
    offScaleSpace: bad.space, offScaleRadius: bad.radius, offScaleControlHeight: bad.height,
    fontSizes: sizes, fontWeights: weights, fonts: loaded, clipped, truncatedNoTitle: truncated, coveredControls: covered, overlappingText: overlapText.slice(0, 10), smallTargets, transitionAll: motion.transitionAll, easeIn: motion.easeIn, zoomLocked, scaleZero, ungatedHoverMoves: ungatedHover, longTransitions, layoutTransitions,
    interactive: ints.length,
  };
}})(${JSON.stringify(spaceScale)},${JSON.stringify(radiusScale)},${JSON.stringify(heights)}); })()`;
const key = (s) => ({ type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, ...s });
const res = await withPage(url, { width: Number(opt('width', 1440)), scheme: opt('scheme', 'light') }, async ({ send, evaluate }) => {
  const r = await evaluate(probe);
  const stops = [], noRing = [];
  const max = Number(opt('tabs', 60));
  await evaluate(`window.__rest = new Map([...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[tabindex]:not([tabindex="-1"])')].map((e) => [e, getComputedStyle(e).boxShadow + '|' + getComputedStyle(e).textDecorationLine])); window.__seen = new Set(); document.activeElement && document.activeElement.blur()`);
  for (let i = 0; i < max; i++) {
    await send('Input.dispatchKeyEvent', key({}));
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const st = await evaluate(`(()=>{const e=document.activeElement;if(!e||e===document.body||window.__seen.has(e))return null;window.__seen.add(e);const s=getComputedStyle(e);const alpha=(c)=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return 1;const p=m[1].split(/[ ,\\/]+/);return p.length>3?parseFloat(p[3]):1};const outline=s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0&&alpha(s.outlineColor)>0;const rest=(window.__rest.get(e)||'').split('|');const ring=outline||(s.boxShadow!=='none'&&s.boxShadow!==rest[0])||(s.textDecorationLine.includes('underline')&&!(rest[1]||'').includes('underline'));return {k:e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+' "'+(e.getAttribute('aria-label')||e.textContent||e.value||'').trim().slice(0,24)+'"',ring}})()`);
    if (!st) break;
    stops.push(st.k); if (!st.ring) noRing.push(st.k);
  }
  return { ...r, tabStops: stops.length, tabWithoutVisibleFocus: noRing };
});
const empty = (v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);
console.log(JSON.stringify(res, null, 1));
const fails = ['clipped', 'coveredControls', 'overlappingText', 'tabWithoutVisibleFocus', 'transitionAll', 'easeIn'].filter((k) => !empty(res[k]));
if (res.pageOverflowX > 0) fails.push('pageOverflowX');
if (res.zoomLocked) fails.push('zoomLocked');
if (res.fonts.some(([, s]) => s === 'NOT LOADED')) fails.push('fonts');
console.error(fails.length ? 'FAIL: ' + fails.join(', ') : 'ok');
process.exit(fails.length ? 2 : 0);
