#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, selector, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? fallback : rest[i + 1];
};
if (!url || !selector) {
  console.error('usage: frames.mjs <url> <action: a css selector to click, text:<visible text> to click, or key:<name> to press, e.g. key:Escape, key:k, key:Meta+k, key:ArrowDown> [--then <ms>:<action>] [--out dir] [--ms 600] [--max 10] [--width 1440] [--height 900] [--port 9333]');
  process.exit(2);
}
const out = opt('out', 'frames');
const span = Number(opt('ms', 600));
const max = Number(opt('max', 10));
const width = Number(opt('width', 1440));
const height = Number(opt('height', 900));
const port = opt('port', '9333');
const limit = 15000 + span;
const thenOpt = opt('then', '');
const thenAt = thenOpt ? Number(thenOpt.split(':')[0]) : -1;
const thenAction = thenOpt.slice(thenOpt.indexOf(':') + 1);
const keyAction = (a) => a.startsWith('key:');
const badAction = (a) => !a || (keyAction(a) && !a.slice(4)) || (a.startsWith('text:') && !a.slice(5));
if (thenOpt && (!Number.isFinite(thenAt) || thenAt < 0 || !thenOpt.includes(':') || badAction(thenAction) || thenAt >= span)) {
  console.error(`frames.mjs: --then needs <ms>:<action> with ms below --ms (${span}) and an action like a selector, text:<text> or key:<name>, got "${thenOpt}"`);
  process.exit(2);
}
if (badAction(selector)) {
  console.error(`frames.mjs: the action "${selector}" is empty after its prefix`);
  process.exit(2);
}
const KEYS = { Escape: 27, Enter: 13, Tab: 9, Space: 32, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
const MODS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };
const keyEvents = (spec) => {
  const parts = spec === '+' ? [] : spec.split('+');
  const name = parts.pop() ?? '+';
  const modifiers = parts.reduce((m, p) => {
    if (!MODS[p]) throw new Error(`unknown modifier ${p} in key:${spec}`);
    return m | MODS[p];
  }, 0);
  const printable = name.length === 1 || name === 'Space';
  if (!printable && !KEYS[name]) throw new Error(`unknown key ${name}; use a single character or one of ${Object.keys(KEYS).join(', ')}`);
  const ch = name === 'Space' ? ' ' : name;
  const vk = KEYS[name] ?? ch.toUpperCase().charCodeAt(0);
  const code = /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : /^[0-9]$/.test(ch) ? `Digit${ch}` : name === 'Space' ? 'Space' : name;
  const base = { key: ch, code, windowsVirtualKeyCode: vk, modifiers };
  const text = name === 'Enter' ? '\r' : printable && !(modifiers & 6) ? ch : undefined;
  return [{ type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) }, { type: 'keyUp', ...base }];
};

mkdirSync(out, { recursive: true });
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const closeTab = () => fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
const quit = async (code, message) => {
  if (message) console.error(message);
  await closeTab();
  process.exit(code);
};
process.on('SIGINT', () => quit(130));
process.on('SIGTERM', () => quit(143));
setTimeout(() => quit(1, `frames.mjs: no result after ${limit} ms (a page that never finishes loading?)`), limit);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let nextId = 0;
const pending = new Map();
const listeners = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  } else (listeners.get(msg.method) ?? []).forEach((fn) => fn(msg.params));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject, method });
  ws.send(JSON.stringify({ id, method, params }));
});
const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
const event = (method) => new Promise((resolve) => on(method, resolve));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = event('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
  await pause(1200);
  const pickOf = (a) => a.startsWith('text:')
    ? `[...document.querySelectorAll('button,a,[role=button],[role=tab]')].find((e) => e.textContent.trim() === ${JSON.stringify(a.slice(5))})`
    : `document.querySelector(${JSON.stringify(a)})`;
  const act = async (a) => {
    if (keyAction(a)) {
      for (const ev of keyEvents(a.slice(4))) await send('Input.dispatchKeyEvent', ev);
      return;
    }
    const r = await send('Runtime.evaluate', { expression: `(() => { const e = ${pickOf(a)}; if (!e) return false; e.click(); return true; })()`, returnByValue: true });
    if (!r.result.value) throw new Error(`no element matches ${a}`);
  };
  if (keyAction(selector)) keyEvents(selector.slice(4));
  else if (!(await send('Runtime.evaluate', { expression: `!!(${pickOf(selector)})`, returnByValue: true })).result.value) throw new Error(`no element matches ${selector}`);
  if (thenOpt && keyAction(thenAction)) keyEvents(thenAction.slice(4));

  const save = (name, data) => {
    writeFileSync(join(out, name), Buffer.from(data, 'base64'));
    return join(out, name);
  };
  const names = [save('frame-000-before.png', (await send('Page.captureScreenshot', { format: 'png' })).data)];

  const got = [];
  on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    got.push({ data, at: metadata.timestamp * 1000 });
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  const t0 = Date.now();
  await act(selector);
  if (thenOpt) {
    await pause(Math.max(0, thenAt - (Date.now() - t0)));
    const at = Date.now() - t0;
    await act(thenAction);
    console.error(`then ${thenAction} at ${at} ms`);
  }
  await pause(Math.max(0, span - (Date.now() - t0)));
  await send('Page.stopScreencast');

  const step = Math.max(1, (got.length - 1) / Math.max(1, max - 1));
  const picked = got.length <= max ? got : Array.from({ length: max }, (_, i) => got[Math.round(i * step)]);
  for (const f of picked) names.push(save(`frame-${String(Math.max(0, Math.round(f.at - t0))).padStart(3, '0')}ms.png`, f.data));
  console.log(names.join('\n'));
} catch (e) {
  await quit(1, e.message);
} finally {
  ws.close();
  await closeTab();
}
process.exit(0);
