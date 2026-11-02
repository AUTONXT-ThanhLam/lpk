import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checkout } from './where.mjs';

export const SURFACES = ['ui', 'cli', 'api', 'library', 'plugin', 'mobile', 'desktop', 'job', 'migration', 'docs', 'other'];
export const needsUser = (s) => ['ui', 'mobile', 'desktop'].includes(s);
export const PAGE_OPEN = ['new_page', 'navigate_page'];
export const INTERACTION = ['click', 'click_at', 'fill', 'fill_form', 'type_text', 'press_key'];
export const SCREENSHOT = ['take_screenshot'];

const bare = (name) => String(name).replace(/^mcp__(?:plugin_lpk_)?chrome-devtools__/, '');
const outside = (rel) => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
const label = (s) => s.id || 'a scenario';

export function checkScenario(s) {
  const errors = [];
  if (!s.surface) errors.push(`${label(s)} has no surface: --surface <${SURFACES.join('|')}>`);
  else if (!SURFACES.includes(s.surface)) errors.push(`${label(s)} surface "${s.surface}" is not one of ${SURFACES.join(', ')}`);
  if (!s.entry) errors.push(`${label(s)} has no entry: --entry "<where the user starts>"`);
  if (s.agentJudged && !s.leaves) errors.push(`${label(s)} is judged and has no leaves: --leaves "<what the Prover leaves behind>"`);
  if (s.cmd && (needsUser(s.surface) || s.surface === 'other')) errors.push(`${label(s)} is a --scenario command with surface ${s.surface}: a shell command is not a user on a screen, state it with --judged`);
  return errors;
}

export function proofDir(repo, run) {
  const at = checkout(repo);
  return at ? join(at.common, 'lpk', 'proof', run.id) : '';
}

const briefFile = (run) => {
  const dir = run.marker ? dirname(run.marker) : '';
  return [join(dir, 'brief.json'), join(dir, 'runs', run.id, 'brief.json')].find((f) => dir && existsSync(f)) || '';
};
const briefHasScenarios = (run) => { try { return JSON.parse(readFileSync(briefFile(run), 'utf8')).scenarios?.length > 0; } catch { return false; } };

export function oldShapeWayOut(run) {
  const bare0 = (run.scenarios || []).filter((s) => !s.surface || !s.entry).map((s) => s.id);
  const fromBrief = run.scenarioFrom ? run.scenarioFrom === 'brief' : briefHasScenarios(run);
  const how = fromBrief
    ? `add \`surface\` (one of ${SURFACES.join(', ')}), \`entry\` and, for a judged one, \`leaves\` to ${bare0.join(', ') || 'each scenario'} in brief.json`
    : `restate ${bare0.join(', ') || 'each scenario'} with \`lpk run start ... --scenario|--judged "<text>" --surface <${SURFACES.join('|')}> --entry "<where the user starts>"\``;
  return `${run.ended ? 'lpk run take first, then ' : ''}${how}`;
}

export const named = (results, s) => results.find((x) => { const t = String(x?.scenario || '').trim(); return t === s.id || t.startsWith(`${s.id}:`) || t.startsWith(`${s.id} `) || (s.agentJudged && t === s.agentJudged); });

function ident(p) {
  const abs = resolve(String(p));
  let d = dirname(abs);
  const tail = [];
  while (!existsSync(d) && dirname(d) !== d) { tail.unshift(basename(d)); d = dirname(d); }
  try { d = realpathSync(d); } catch { d = resolve(d); }
  return join(d, ...tail, basename(abs));
}

function cites(call, raw, abs) {
  if (call.error) return false;
  const i = call.input || {};
  const n = bare(call.name);
  if (n === 'Write') return typeof i.file_path === 'string' && ident(i.file_path) === abs;
  if (n === 'Bash') return typeof i.command === 'string' && (i.command.includes(raw) || i.command.includes(abs));
  if (SCREENSHOT.includes(n)) return typeof i.filePath === 'string' && isAbsolute(i.filePath) && /\.png$/.test(i.filePath) && ident(i.filePath) === abs;
  return false;
}

function ownScreenshots(calls) {
  const out = [];
  let opened = false;
  let acted = false;
  for (const c of calls) {
    const n = bare(c.name);
    if (c.error) continue;
    if (PAGE_OPEN.includes(n)) opened = true;
    else if (INTERACTION.includes(n) && opened) acted = true;
    else if (SCREENSHOT.includes(n)) {
      if (acted && typeof c.input?.filePath === 'string') out.push(ident(c.input.filePath));
      acted = false;
    }
  }
  return out;
}

function fileFault(dir, abs, started) {
  let st;
  try { st = lstatSync(abs); } catch { return 'is missing'; }
  if (st.isSymbolicLink() || !st.isFile()) return 'is not a regular file (a symlink or a directory)';
  const rel = relative(dir, abs);
  if (outside(rel)) return 'is outside the proof directory';
  try { if (outside(relative(realpathSync(dir), realpathSync(abs)))) return 'is outside the proof directory'; } catch { return 'is outside the proof directory'; }
  if (!st.size) return 'is empty';
  if (st.mtimeMs < started) return 'is older than the Prover\'s start';
  return '';
}

export function judgedProof(repo, run, scenario, line, agent) {
  const no = (why) => ({ ok: false, why });
  if (line?.status !== 'PASS') return no(`Prover ${line?.status || 'gave no status'}`);
  const calls = (agent?.calls || []).filter((c) => c.name !== 'StructuredOutput');
  if (!calls.length) return no('no transcript to read: a PASS is not accepted on the status alone');
  const dir = proofDir(repo, run);
  if (!Array.isArray(line.evidence)) return no('evidence must be an array of file paths under the proof directory');
  if (!line.evidence.length || line.evidence.some((p) => typeof p !== 'string' || !p.trim())) return no(`evidence is empty: a PASS lists the files the Prover left in ${dir}`);
  const started = Date.parse(agent.started);
  if (Number.isNaN(started)) return no('the Prover start time is unknown');
  const raws = line.evidence.map((p) => resolve(dir, p));
  const paths = raws.map(ident);
  for (const [k, abs] of paths.entries()) {
    const refused = calls.find((c) => c.error && SCREENSHOT.includes(bare(c.name)) && ident(String(c.input?.filePath || '')) === abs);
    if (refused) return no(`the screenshot ${abs} was refused: ${refused.error}`);
    const fault = fileFault(dir, raws[k], started);
    if (fault) return no(`${abs} ${fault}`);
    if (!calls.some((c) => cites(c, raws[k], abs))) return no(`${abs} is named in no tool call of the Prover's transcript`);
  }
  const all = line.all || [];
  const before = all.filter((l) => l.rank < line.rank && !named([l], scenario));
  const shared = paths.find((abs) => before.some((l) => Array.isArray(l.evidence) && l.evidence.some((p) => typeof p === 'string' && ident(resolve(dir, p)) === abs)));
  if (shared) return no(`${shared} is cited by another scenario too: each scenario leaves its own files`);
  if (needsUser(scenario.surface)) {
    if (!calls.some((c) => PAGE_OPEN.includes(bare(c.name)))) return no(`a ${scenario.surface} scenario needs the Prover to open the page (${PAGE_OPEN.join(' or ')}); none in its transcript`);
    const own = ownScreenshots(calls);
    if (!paths.some((p) => own.includes(p))) return no(`a ${scenario.surface} scenario needs its own take_screenshot to a .png after its own click, fill or key press (${INTERACTION.join(', ')}); none of its evidence is one`);
  }
  return { ok: true, why: '' };
}

export function judgedWhy(repo, run, judged, p, list) {
  if (!p.agents.length) return [`no Prover run on HEAD's code for ${list(judged.map((s) => s.id))}`];
  const out = [];
  const miss = judged.filter((s) => !named(p.results, s));
  if (miss.length) out.push(`no Prover on HEAD's code (${list(p.agents)}) listed ${list(miss.map((s) => s.id))}`);
  for (const s of judged) {
    const r = named(p.results, s);
    const j = r ? judgedProof(repo, run, s, r, r.agent) : { ok: true };
    if (!j.ok) out.push(`${s.id} ${r.status === 'PASS' ? 'reads NOT PROVED: ' : ''}${j.why} (Prover ${r.agentId})`);
  }
  return out;
}

export function judgedStatus(repo, run, s, results) {
  const r = named(results, s);
  if (!r) return 'NOT PROVED';
  if (r.status === 'FAIL') return 'FAIL';
  return judgedProof(repo, run, s, r, r.agent).ok ? 'PASS' : 'NOT PROVED';
}
