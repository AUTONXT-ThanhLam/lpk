const finding = (file, line, claim, repro, extra = {}) => {
  const n = Number.parseInt(String(line ?? ''), 10);
  return { file: String(file || '').trim(), ...(n > 0 ? { line: n } : {}), claim: String(claim || '').trim(), repro: String(repro || '').trim(), ...extra };
};

export function readStream(text) {
  let report = null, result = null;
  for (const line of String(text).split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === 'result') result = e;
    if (e?.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const c of e.message.content) if (c?.type === 'tool_use' && c.name === 'ReportFindings' && Array.isArray(c.input?.findings)) report = c.input;
  }
  return { report, result };
}

export const fromReport = (report) => report.findings.map((f) => finding(f.file, f.line, f.summary, f.failure_scenario, {
  ...(f.category ? { category: String(f.category) } : {}), ...(f.verdict ? { verdict: String(f.verdict) } : {}),
}));

function closing(text, start) {
  let depth = 0, str = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; } else if (c === '"') str = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

export function parseFindings(text) {
  let empty = null;
  for (const m of String(text).matchAll(/\[(?=\s*[{\]])/g)) {
    const end = closing(text, m.index);
    if (end < 0) continue;
    const s = text.slice(m.index, end + 1);
    for (const t of [s, s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')]) {
      try { const v = JSON.parse(t); if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) { if (v.length) return v; empty = v; break; } } catch { continue; }
    }
  }
  return empty;
}

export function parseRendered(text) {
  const t = String(text).trim();
  if (/^No findings\.?$/m.test(t)) return [];
  const head = /^(\d+) findings?\b/m.exec(t);
  if (!head) return null;
  const items = t.slice(head.index).split(/\n(?=\d+\. `)/).slice(1);
  const out = items.map((it) => {
    const m = /^\d+\. `([^`]+?)(?::(\d+))?`: ([\s\S]*)$/.exec(it.trim());
    if (!m) return null;
    const [claim, ...rest] = m[3].split(/\s*Failure scenario:\s*/);
    return finding(m[1], m[2], claim.replace(/\s+/g, ' '), rest.join(' ').replace(/\s+/g, ' '));
  });
  return out.length === Number(head[1]) && out.every(Boolean) ? out : null;
}

export function proseFindings(text) {
  const arr = parseFindings(text);
  if (arr) return arr.map((f) => finding(f.file ?? f.path, f.line, f.summary ?? f.claim, f.failure_scenario ?? f.repro));
  return parseRendered(text);
}
