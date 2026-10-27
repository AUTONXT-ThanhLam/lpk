// Which sessions are alive, and so which open runs have lost the session that held them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectsDirs, sessionsDirs } from './host.mjs';
import { checkout, registered } from './where.mjs';

// The pid of a live host process holding `session`, from the per-process files each host keeps in its
// own store; 0 when none does. Measured: Qoder keeps no such folder, so a session of it reads as one
// that has exited, and `lpk run take` takes its run.
export function sessionPid(session) {
  let names = [];
  for (const dir of sessionsDirs()) {
    try { names.push(...readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)).map((n) => join(dir, n))); } catch { /* nothing here */ }
  }
  for (const file of names) {
    try {
      const s = JSON.parse(readFileSync(file, 'utf8'));
      if (s.sessionId === session && s.pid) { process.kill(s.pid, 0); return s.pid; }
    } catch { /* not this one, or its process is gone */ }
  }
  return 0;
}

export function exitedRuns(session, repo) {
  const at = checkout(repo);
  if (!at) return [];
  const near = (r) => r.repo === repo || r.repo?.startsWith(`${repo}/`) || r.marker.startsWith(`${at.common}/`);
  return registered().map((x) => x.run).filter((r) => r?.session && r.session !== session && near(r) && !sessionPid(r.session));
}

export const IDLE = 6 * 3600 * 1000;

function lastSeen(session) {
  let at = 0;
  for (const projects of projectsDirs()) {
    let names = [];
    try { names = readdirSync(projects); } catch { continue; }
    for (const n of names) {
      try { at = Math.max(at, statSync(join(projects, n, `${session}.jsonl`)).mtimeMs); } catch { /* not in this project */ }
    }
  }
  return at;
}

const idle = (session) => { const at = lastSeen(session); return at > 0 && Date.now() - at > IDLE; };

export const gone = (holder, me) => Boolean(me && sessionPid(me) && !sessionPid(holder) && idle(holder));
export const heirs = (session, repo) => (repo && session && sessionPid(session) ? exitedRuns(session, repo).filter((r) => idle(r.session)) : []);
