import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function parentOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m)?.[1];
  } catch {
    return undefined;
  }
}

export function hasTranscript(sessionId, configDir = process.env.CLAUDE_CONFIG_DIR) {
  const projects = join(configDir || join(homedir(), '.claude'), 'projects');
  return existsSync(projects) && readdirSync(projects).some((d) => existsSync(join(projects, d, `${sessionId}.jsonl`)));
}

export function requestRestart({ request, id, card, pid, kill = process.kill.bind(process) }) {
  writeFileSync(request, `${id}\n${card}\n`);
  try {
    kill(pid, 'SIGTERM');
  } catch (err) {
    rmSync(request, { force: true });
    throw err;
  }
}
