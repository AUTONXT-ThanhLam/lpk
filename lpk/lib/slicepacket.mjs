import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const one = (s) => (flat(s).length > 400 ? `${flat(s).slice(0, 399)}…` : flat(s));
const overlaps = (row, ids) => (row.proves || []).some((p) => ids.includes(p));

export function sliceBrief(brief, slice) {
  const ids = slice.proves || [];
  const reqs = (brief.requirements || []).filter((q) => ids.includes(q.id));
  const rows = [...(brief.scenarios || []), ...(brief.failures || [])].filter((x) => overlaps(x, ids));
  return [
    slice.contract ? `contract: ${flat(typeof slice.contract === 'string' ? slice.contract : JSON.stringify(slice.contract))}` : 'contract: none written in brief.json for this slice; read the brief section that names its files',
    ...reqs.map((q) => `requirement ${q.id}: ${one(q.text)}`),
    ...rows.map((x) => `proof ${x.id}: ${one(x.text || x.cmd || x.provedBy)} (proves ${(x.proves || []).join(', ')})`),
  ];
}

export function readFirst(root, files) {
  return files.filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile()).map((f) => `${f} (${readFileSync(join(root, f), 'utf8').split('\n').length} lines)`);
}

export function briefSections(briefMd) {
  if (!existsSync(briefMd)) return [];
  return readFileSync(briefMd, 'utf8').split('\n').flatMap((l, i) => (/^#{1,3} /.test(l) ? [`  line ${i + 1}: ${l}`] : [])).slice(0, 40);
}
