// The session as a conversation: the owner's messages and the agent's replies as bubbles, the tool
// calls between them folded into one line each run of them, errors kept in sight.
import { clock, esc, plural } from './util.js';

// Enough Markdown for an agent's reply to read as written: headings, bold, code, bullets.
function md(s) {
  let fence = false;
  return esc(s).split('\n').map((line) => {
    if (/^```/.test(line)) { fence = !fence; return ''; }
    if (fence) return `<code class="blk">${line}</code>`;
    const l = line.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    if (/^#{1,6}\s/.test(line)) return `<b>${l.replace(/^#{1,6}\s/, '')}</b>`;
    if (/^\s*[-*]\s/.test(line)) return `<span class="li">${l.replace(/^\s*[-*]\s/, '')}</span>`;
    return l;
  }).join('<br>').replace(/(<br>){3,}/g, '<br><br>');
}

function group(items) {
  const out = [];
  let g = null;
  for (const x of items) {
    if (x.who === 'tool' || x.who === 'error') {
      if (!g) { g = { t: x.t, list: [] }; out.push(g); }
      g.list.push(x);
    } else { g = null; out.push(x); }
  }
  return out;
}

function tools(g, open, live) {
  const calls = g.list.filter((x) => x.who === 'tool');
  const errors = g.list.length - calls.length;
  const names = Object.entries(calls.reduce((m, x) => ({ ...m, [x.tool]: (m[x.tool] || 0) + 1 }), {}))
    .map(([k, v]) => (v > 1 ? `${esc(k)} ×${v}` : esc(k))).join(', ');
  const last = calls.at(-1);
  return `<details class="tools" data-k="${g.t}" ${open.has(String(g.t)) ? 'open' : ''}>
    <summary><span class="when">${clock(g.t)}</span><span class="tn">${plural(calls.length, 'tool call')}</span><span class="names">${names}</span>${errors ? `<span class="b bad">${plural(errors, 'error')}</span>` : ''}
      ${live && last ? `<span class="running"><span class="sdot working"></span>${esc(last.tool)} · ${esc(last.text)}</span>` : ''}</summary>
    <ul>${g.list.map((x) => (x.who === 'error'
    ? `<li class="err"><span class="tool">error</span><span>${esc(x.text)}</span></li>`
    : `<li><span class="tool">${esc(x.tool)}</span><span>${esc(x.text)}</span></li>`)).join('')}</ul>
  </details>`;
}

export function feedHtml(r, mode, open, live) {
  const shown = group(r.feed || []).filter((x) => mode === 'all' || !x.list);
  if (!shown.length) return '<p class="quiet pad">Nothing from the session yet: it shows here as the agent works.</p>';
  return shown.map((x, i) => {
    if (x.list) return tools(x, open, live && i === shown.length - 1);
    if (x.who === 'skill') return `<div class="sys">started the <b>${esc(x.text)}</b> skill · ${clock(x.t)}</div>`;
    const who = x.who === 'owner' ? 'You' : 'Agent';
    return `<div class="msg ${x.who}"><div class="who">${who} · ${clock(x.t)}</div><div class="body">${x.who === 'owner' ? esc(x.text) : md(x.text)}</div></div>`;
  }).join('');
}
