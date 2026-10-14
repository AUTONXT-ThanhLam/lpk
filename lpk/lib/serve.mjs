// The status page's server: one page for every live lpk run on this machine, on 127.0.0.1 only.
// It serves the page, the runs as JSON, and a repo's own progress page from `.lpk/status/`.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runId } from './run.mjs';
import { endedRuns, liveRuns, PORT, snapshot, writeServer } from './status.mjs';

const PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'status');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const IDLE = 30 * 60 * 1000;

// A file under `root`, or null for anything that resolves outside it (`..`, a symlink out, or a
// root that is itself a symlink: a cloned repo could point `.lpk/status` anywhere).
function inside(root, rel) {
  try {
    const base = realpathSync(root);
    if (base !== join(realpathSync(dirname(root)), basename(root))) return null;
    const file = realpathSync(join(base, rel));
    return (file === base || file.startsWith(base + sep)) && statSync(file).isFile() ? file : null;
  } catch { return null; }
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

export function runsJson() {
  const runs = liveRuns().map((r) => { try { return snapshot(r); } catch { return null; } }).filter(Boolean);
  const live = new Set(runs.map((r) => r.id));
  return { now: Date.now(), runs, ended: endedRuns().filter((r) => !live.has(r.id)) };
}

// The Host the owner's own address sends, if they set one.
const named = () => { try { return new URL(process.env.LPK_STATUS_URL).host; } catch { return ''; } };

// `stay` keeps it running with no live run, for a server the owner starts at login.
export function serve(port = PORT, { stay = false } = {}) {
  let lastLive = Date.now();
  const hosts = new Set([named(), `lpk.localhost:${port}`, `127.0.0.1:${port}`, `localhost:${port}`].filter(Boolean));
  const server = createServer((req, res) => {
    // Only this machine's browser, by name: a page elsewhere that rebinds a hostname to 127.0.0.1
    // sends its own Host and gets nothing.
    if (!hosts.has(req.headers.host) || req.method !== 'GET') return send(res, 403, 'forbidden');
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'bad path'); }
    if (path === '/api/runs') {
      const body = runsJson();
      if (body.runs.length) lastLive = Date.now();
      return send(res, 200, JSON.stringify(body), TYPES['.json']);
    }
    const project = path.match(/^\/project\/([0-9a-f]{16})\/(.*)$/);
    if (project) {
      const repo = liveRuns().find((r) => runId(r.marker) === project[1])?.repo || endedRuns().find((r) => r.id === project[1])?.repo;
      const file = repo && inside(join(repo, '.lpk', 'status'), project[2] || 'index.html');
      return file ? send(res, 200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream') : send(res, 404, 'not found');
    }
    const file = inside(PAGE, path === '/' ? 'index.html' : path.slice(1));
    return file && extname(file) !== '.md' ? send(res, 200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream') : send(res, 404, 'not found');
  });
  server.listen(port, '127.0.0.1', () => writeServer(process.pid, port));
  // Leaves once no run has been live for half an hour; the next run or status line starts it again.
  if (!stay) setInterval(() => {
    if (liveRuns().length) lastLive = Date.now();
    else if (Date.now() - lastLive > IDLE) process.exit(0);
  }, 60000).unref();
  return server;
}
