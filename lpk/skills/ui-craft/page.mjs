export async function withPage(url, { width = 1440, height = 900, scheme = 'light', port = 9333 } = {}, fn) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const waiters = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else waiters.forEach((w) => w(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    const loaded = new Promise((res) => waiters.push((m) => m.method === 'Page.loadEventFired' && res()));
    const nav = await send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
    let giveUp;
    await Promise.race([loaded, new Promise((r) => { giveUp = setTimeout(r, 15000); })]);
    clearTimeout(giveUp);
    const status = await evaluate("performance.getEntriesByType('navigation')[0]?.responseStatus || 0");
    if (status >= 400) throw new Error(`${url}: HTTP ${status}`);
    await evaluate('document.fonts.ready.then(()=>1)');
    return await fn({ send, evaluate });
  } finally {
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    ws.close();
  }
}
