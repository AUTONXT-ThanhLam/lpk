// The lpk status page: polls /api/runs and draws every live run, the one picked in the URL hash in
// detail, and the runs that ended today.
const STEPS = ['Understand', 'Gather facts', 'Choose lane', 'Design Brief', 'Build', 'Verify & review', 'Self-check', 'Fix findings', 'Deliver'];
const QUIET = 10 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let data = null, seen = '', tab = 'progress', shownProject = '';
try { tab = localStorage.getItem('lpk.tab') || tab; } catch { /* storage blocked */ }

function ago(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}
// A relative time that the ticker below keeps current without redrawing the page.
const since = (t) => `<span data-ago="${t}">${ago(t)}</span>`;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function verifyBadge(v) {
  if (!v) return '<span class="b">verify not run</span>';
  if (!v.green) return `<span class="b bad">verify red · ${since(v.at)} ago</span>`;
  return v.current ? `<span class="b ok">verify green · ${since(v.at)} ago</span>` : `<span class="b warn">green, files changed since</span>`;
}

function steps(step) {
  return `<div class="steps" title="${step ? `Step ${step}: ${esc(STEPS[step - 1])}` : 'Step not known yet'}">${STEPS.map((s, i) => `<i class="${i + 1 < step ? 'done' : i + 1 === step ? 'active' : ''}"></i>`).join('')}</div>`;
}

function card(r, picked) {
  const n = r.narrative || {};
  const quiet = data.now - r.activity > QUIET;
  return `<button class="card" data-id="${r.id}" aria-current="${picked}">
    <div class="head"><span class="dot ${quiet ? '' : 'on'}"></span><span class="name">${esc(r.name)}</span><span class="branch">${esc(r.branch)}</span><span class="age" title="started ${esc(new Date(r.started).toLocaleString())}">${since(r.started)}</span></div>
    <div class="headline">${esc(n.headline || r.brief || r.owner.last?.text?.slice(0, 140) || 'Waiting for the first summary…')}</div>
    ${steps(n.step || 0)}
    <div class="steplabel">${n.step ? `Step ${n.step} of 9 · ${esc(STEPS[n.step - 1])}` : 'Step not known yet'}</div>
    <div class="nowline ${quiet ? 'quiet' : ''}">${quiet ? `Quiet for ${since(r.activity)}` : esc(n.now || '')}</div>
    <div class="badges">${n.waiting ? '<span class="b warn">waiting on you</span>' : ''}${verifyBadge(r.verify)}
      <span class="b">${r.commits.length} commit${r.commits.length === 1 ? '' : 's'}</span>
      <span class="b num">${r.diff.files} file${r.diff.files === 1 ? '' : 's'} +${r.diff.added} −${r.diff.removed}</span></div>
  </button>`;
}

function progress(r) {
  const n = r.narrative;
  if (!n) return '<p class="quiet">No summary yet: the first one comes after ten tool calls or at the end of the turn.</p>';
  return `${n.waiting ? `<div class="callout wait">Waiting on you: ${esc(n.waiting)}</div>` : ''}
    <div class="callout now"><b>Now</b> · ${esc(n.now)} <span class="when">updated ${since(n.updated)} ago</span></div>
    <div class="cols">
      <div><h2>Done</h2><ul class="list">${(n.done || []).map((d) => `<li><span class="mk done"></span><span>${esc(d)}</span></li>`).join('') || '<li class="quiet">Nothing yet</li>'}</ul></div>
      <div><h2>Next</h2><ul class="list">${(n.next || []).map((d) => `<li><span class="mk next"></span><span>${esc(d)}</span></li>`).join('') || '<li class="quiet">Nothing listed</li>'}</ul></div>
    </div>`;
}

function timeline(r) {
  const log = (r.narrative?.log || []).slice().reverse();
  return log.length ? `<ul class="list">${log.map((l) => `<li><span class="mk ${esc(l.kind)}"></span><span><span class="when">${clock(l.t)}</span>${esc(l.msg)}</span></li>`).join('')}</ul>` : '<p class="quiet">No events yet.</p>';
}

function code(r) {
  const v = r.verify;
  return `<div class="cols"><div>
      <h2>Checks ${verifyBadge(v)}</h2>
      ${(v ? v.results : r.checks.map((cmd) => ({ cmd }))).map((c) => `<div class="check"><span class="b ${c.exit === undefined ? '' : c.exit === 0 ? 'ok' : 'bad'}">${c.exit === undefined ? 'not run' : c.exit === 0 ? 'ok' : `exit ${esc(c.exit)}`}</span><code>${esc(c.cmd)}</code>${c.ms ? `<span class="when">${Math.round(c.ms / 1000)}s</span>` : ''}</div>`).join('')}
      <h2 style="margin-top:18px">Change</h2>
      <dl class="kv"><dt>Against</dt><dd class="mono">${esc(r.base)}</dd><dt>Diff</dt><dd class="num">${r.diff.files} files, +${r.diff.added} −${r.diff.removed}</dd><dt>Uncommitted</dt><dd>${r.dirty} file${r.dirty === 1 ? '' : 's'}</dd>${r.brief ? `<dt>Brief</dt><dd>${esc(r.brief)}</dd>` : ''}</dl>
    </div><div>
      <h2>Commits</h2>${r.commits.map((c) => `<div class="commit"><code>${esc(c.h)}</code><span>${esc(c.s)}</span><span class="when">${clock(c.t)}</span></div>`).join('') || '<p class="quiet">No commits on the branch yet.</p>'}
    </div></div>`;
}

function owner(r) {
  const last = r.owner.last;
  return last ? `<h2>Your last message · ${since(Date.parse(last.at))} ago · ${r.owner.count} during the run</h2><pre class="owner">${esc(last.text)}</pre>` : '<p class="quiet">No message from you since the run started.</p>';
}

function detail(r) {
  const el = $('detail');
  if (!r) { el.hidden = true; el.innerHTML = ''; shownProject = ''; return; }
  const tabs = [['progress', 'Progress'], ['timeline', 'Timeline'], ['code', 'Checks & commits'], ['owner', 'Your messages'], ...(r.project ? [['project', 'Project']] : [])];
  if (!tabs.some(([k]) => k === tab)) tab = 'progress';
  // The project page is the repo's own; it reloads only when another run or tab is picked, so a
  // poll never resets where its reader scrolled.
  if (tab === 'project' && shownProject === r.id && el.querySelector('iframe')) return;
  shownProject = tab === 'project' ? r.id : '';
  const body = { progress, timeline, code, owner, project: (x) => `<iframe class="project" sandbox="allow-scripts" src="/project/${x.id}/index.html" title="${esc(x.name)} project page"></iframe>` }[tab](r);
  el.hidden = false;
  el.innerHTML = `<div class="title"><h3>${esc(r.narrative?.headline || r.name)}</h3>${r.ended ? `<span class="b">ended ${since(r.ended)} ago${r.reason ? `: ${esc(r.reason)}` : ''}</span>` : ''}</div>
    <div class="repo">${esc(r.repo)} · ${esc(r.branch)} · started ${esc(new Date(r.started).toLocaleString())}</div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
    <div>${body}</div>`;
}

function render() {
  const picked = location.hash.slice(1);
  const runs = data.runs;
  const red = runs.filter((r) => r.verify && !r.verify.green).length;
  const waiting = runs.filter((r) => r.narrative?.waiting).length;
  $('summary').innerHTML = `<div class="k"><div class="v">${runs.length}</div><div class="l">live run${runs.length === 1 ? '' : 's'}</div></div>
    <div class="k ${waiting ? 'warn' : ''}"><div class="v">${waiting}</div><div class="l">waiting on you</div></div>
    <div class="k ${red ? 'bad' : ''}"><div class="v">${red}</div><div class="l">verify red</div></div>
    <div class="k"><div class="v">${data.ended.length}</div><div class="l">ended today</div></div>`;
  $('runs').innerHTML = runs.length ? runs.map((r) => card(r, r.id === picked)).join('')
    : '<div class="empty">No lpk run is live on this machine. Start one with <code>/lpk:lpk &lt;request&gt;</code> in Claude Code; it shows up here within seconds.</div>';
  $('ended-wrap').hidden = !data.ended.length;
  $('ended').innerHTML = data.ended.map((r) => `<div class="row" data-id="${r.id}" role="button" tabindex="0"><b>${esc(r.name)}</b><span>${esc(r.narrative?.headline || r.branch)}</span>${verifyBadge(r.verify)}</div>`).join('');
  detail([...runs, ...data.ended].find((r) => r.id === picked) || (runs.length === 1 && !picked ? runs[0] : null));
}

function tickAgo() {
  for (const el of document.querySelectorAll('[data-ago]')) el.textContent = ago(Number(el.dataset.ago));
}

async function poll() {
  try {
    const res = await fetch('/api/runs', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    data = JSON.parse(text);
    $('dot').className = 'dot on';
    $('fresh').textContent = `live · ${clock(data.now)}`;
    // Redrawn only when something changed, so a poll never takes the reader's focus or selection.
    const key = text.replace(/^\{"now":\d+,/, '{') + data.runs.map((r) => data.now - r.activity > QUIET).join();
    if (key !== seen) { seen = key; render(); } else tickAgo();
  } catch {
    $('dot').className = 'dot off';
    $('fresh').textContent = 'server stopped: run `lpk status` to start it';
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; try { localStorage.setItem('lpk.tab', tab); } catch { /* storage blocked */ } shownProject = ''; render(); return; }
  const c = e.target.closest('[data-id]');
  if (c) { location.hash = location.hash.slice(1) === c.dataset.id ? '' : c.dataset.id; }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.row[data-id]')) e.target.click(); });
window.addEventListener('hashchange', () => { shownProject = ''; if (data) render(); });
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('lpk.theme', document.documentElement.dataset.theme); } catch { /* storage blocked */ }
});
try { const t = localStorage.getItem('lpk.theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* storage blocked */ }
poll();
setInterval(poll, 3000);
