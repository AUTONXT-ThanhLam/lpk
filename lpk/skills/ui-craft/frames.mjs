#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, selector, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? fallback : rest[i + 1];
};
if (!url || !selector) {
  console.error('usage: frames.mjs <url> <css selector, or text:<visible text>, to click> [--out dir] [--ms 600] [--max 10] [--width 1440] [--height 900] [--port 9333]');
  process.exit(2);
}
const out = opt('out', 'frames');
const span = Number(opt('ms', 600));
const max = Number(opt('max', 10));
const width = Number(opt('width', 1440));
const height = Number(opt('height', 900));
const port = opt('port', '9333');
const limit = 15000 + span;

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
  const pick = selector.startsWith('text:')
    ? `[...document.querySelectorAll('button,a,[role=button],[role=tab]')].find((e) => e.textContent.trim() === ${JSON.stringify(selector.slice(5))})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  const found = await send('Runtime.evaluate', { expression: `!!(${pick})`, returnByValue: true });
  if (!found.result.value) throw new Error(`no element matches ${selector}`);

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
  await send('Runtime.evaluate', { expression: `(${pick}).click()` });
  await pause(span);
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
