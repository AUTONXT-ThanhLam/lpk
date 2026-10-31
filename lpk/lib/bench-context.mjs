import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Rough, and said to be rough: lpk counts tokens exactly where a host writes them, and estimates
// them only for resident text, at 4 bytes per token.
export const est = (bytes) => Math.round(bytes / 4);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

// Frontmatter `description:` of a skill or agent file, and the body that only loads when invoked.
function parts(file) {
  const t = read(file);
  const fm = t.match(/^---\n([\s\S]*?)\n---\n?/);
  const d = fm ? fm[1].match(/^description:([\s\S]*?)(?=\n[a-zA-Z][\w-]*:|$)/m) : null;
  return { desc: d ? d[1].replace(/\n\s*/g, ' ').trim().length : 0, body: Math.max(0, t.length - (fm ? fm[0].length : 0)) };
}

// What one repo directory of the plugin contributes to every session, and what only loads on invoke.
export function context(root) {
  const out = { resident: { skills: [], agents: [] }, onInvoke: { skillBodies: 0, agentBodies: 0 }, hooksJsonBytes: 0, pluginJsonBytes: 0 };
  for (const dir of ['skills', 'workflows']) {
    let names = [];
    try { names = readdirSync(join(root, dir)); } catch { /* none in this install */ }
    if (dir === 'skills') for (const s of names) {
      const p = join(root, dir, s, 'SKILL.md');
      if (!existsSync(p)) continue;
      const q = parts(p);
      out.resident.skills.push({ skill: s, descriptionBytes: q.desc, descriptionTokensEst: est(q.desc), bodyBytes: q.body, bodyTokensEst: est(q.body) });
      out.onInvoke.skillBodies += q.body;
    }
  }
  let agents = [];
  try { agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')); } catch { /* no agents */ }
  for (const f of agents) {
    const q = parts(join(root, 'agents', f));
    out.resident.agents.push({ agent: f.replace(/\.md$/, ''), descriptionBytes: q.desc, descriptionTokensEst: est(q.desc), bodyBytes: q.body, bodyTokensEst: est(q.body) });
    out.onInvoke.agentBodies += q.body;
  }
  out.hooksJsonBytes = (() => { try { return statSync(join(root, 'hooks', 'hooks.json')).size; } catch { return 0; } })();
  out.pluginJsonBytes = (() => { try { return statSync(join(root, '.claude-plugin', 'plugin.json')).size; } catch { return 0; } })();
  out.skillDescriptionBytes = out.resident.skills.reduce((x, s) => x + s.descriptionBytes, 0);
  out.agentDescriptionBytes = out.resident.agents.reduce((x, s) => x + s.descriptionBytes, 0);
  out.residentBytes = out.skillDescriptionBytes + out.agentDescriptionBytes;
  out.residentTokensEst = est(out.residentBytes);
  out.onInvokeBytes = out.onInvoke.skillBodies + out.onInvoke.agentBodies;
  // The advice a hook hands back is resident once it lands: measured from the transcripts, not from
  // the strings in lib/hooks.mjs, so a hook that never fires costs nothing here.
  out.measured = { adviceLines: 0, adviceBytes: 0, skillInjectLines: 0, skillInjectBytes: 0, cardLines: 0, cardBytes: 0, mainTranscriptBytes: 0 };
  return out;
}

const SKILL_MARK = 'Base directory for this skill';
const CARD_MARK = '# lpk state card';

function userText(entry) {
  const c = entry.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
}

export function injectionOf(entry) {
  if (entry.type === 'attachment') {
    const a = entry.attachment ?? {};
    if (a.type === 'hook_additional_context') {
      const text = [].concat(a.content ?? []).join('\n');
      return text.startsWith('lpk') ? ['advice', text.length] : null;
    }
    const raw = a.type === 'file' ? JSON.stringify(a) : '';
    return raw.includes(CARD_MARK) ? ['card', raw.length] : null;
  }
  if (entry.type !== 'user' || entry.toolUseResult) return null;
  const text = userText(entry);
  if (text.startsWith(SKILL_MARK)) return ['skill', text.length];
  return text.includes(CARD_MARK) ? ['card', text.length] : null;
}

export function measureInjections(ctx, files) {
  const m = ctx.measured;
  for (const f of files) {
    const text = read(f);
    m.mainTranscriptBytes += text.length;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const hit = injectionOf(entry);
      if (!hit) continue;
      const [bucket, bytes] = hit;
      const key = { advice: 'advice', skill: 'skillInject', card: 'card' }[bucket];
      m[`${key}Lines`]++;
      m[`${key}Bytes`] += bytes;
    }
  }
}
