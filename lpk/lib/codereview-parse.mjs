// Reading what a headless /code-review or /security-review child answered. The typed
// `ReportFindings` call is read first; the prose forms the bundled reviews print are the fallback.
// Each parser reads one fixed format those reviews define and reports a count it could not read,
// so a finding is never lost without saying so.

// A finding as lpk keeps it: where, what is wrong, and the scenario that shows it.
const finding = (file, line, claim, repro, extra = {}) => {
  const n = Number.parseInt(String(line ?? ''), 10);
  return { file: String(file || '').trim(), ...(n > 0 ? { line: n } : {}), claim: String(claim || '').trim(), repro: String(repro || '').trim(), ...extra };
};

// The child's stream-json output, one JSON event per line: the input of its last `ReportFindings`
// call (null when it never made one) and its final result event (null when it never finished).
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

// Where the `[` at `start` closes, skipping brackets inside JSON strings; -1 when it never does.
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

// The JSON array /code-review prints when it does not report through the tool: the first non-empty
// array of objects in the text, an empty one only when there is none, null when there is no array.
export function parseFindings(text) {
  let empty = null;
  for (const m of String(text).matchAll(/\[(?=\s*[{\]])/g)) {
    const end = closing(text, m.index);
    if (end < 0) continue;
    const s = text.slice(m.index, end + 1);
    for (const t of [s, s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')]) {
      try { const v = JSON.parse(t); if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) { if (v.length) return v; empty = v; break; } } catch { /* try the next shape */ }
    }
  }
  return empty;
}

// The list Claude Code renders from that array in a stream-json run:
//   "2 findings, most severe first:\n\n1. `a.js:3`: summary\n   Failure scenario: ..."
// or "No findings.". Null when the text is in neither form or names more findings than it lists.
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

// /code-review's findings from what the child printed, when it made no `ReportFindings` call.
export function proseFindings(text) {
  const arr = parseFindings(text);
  if (arr) return arr.map((f) => finding(f.file ?? f.path, f.line, f.summary ?? f.claim, f.failure_scenario ?? f.repro));
  return parseRendered(text);
}

// /security-review's markdown report, in the format its instructions require:
//   # Vuln 1: XSS: `foo.py:42`
//   * Severity: High
//   * Description: ...
//   * Exploit Scenario: ...
// A report with no "Vuln" heading has no findings. `unread` counts headings that did not parse.
export function parseSecurity(markdown) {
  const parts = String(markdown).split(/^#{1,6}[ \t]*Vuln[ \t]+\d+[ \t]*:?/im).slice(1);
  const findings = [];
  let unread = 0;
  for (const p of parts) {
    const [title, ...body] = p.split('\n');
    const where = /`([^`\s]+?)(?::(\d+))?`/.exec(title);
    const field = (name) => new RegExp(`^[ \\t]*[*-][ \\t]*\\**${name}\\**[ \\t]*:\\**[ \\t]*(.+)$`, 'im').exec(body.join('\n'))?.[1].trim() || '';
    const claim = field('Description');
    if (!where || !claim) { unread++; continue; }
    const category = title.slice(0, where.index).replace(/[:\s]+$/, '').trim();
    const severity = /^(high|medium)/i.test(field('Severity')) ? 'important' : 'nit';
    findings.push(finding(where[1], where[2], `${category ? `${category}: ` : ''}${claim}`, field('Exploit Scenario') || claim, { severity }));
  }
  return { findings, unread };
}
