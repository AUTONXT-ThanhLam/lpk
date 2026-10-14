import { C, EDGE, SMALL, esc, textWidth, wrap } from "./style.mjs";
import { noteEdgeTone } from "./legend.mjs";
import { Model, S } from "./model.mjs";
import { drawNode, measure } from "./nodes.mjs";

const STEP = 44, TOP = 20, SELF_W = 36;

/**
 * Who calls whom, in time order. Participants are boxes on top with a dashed lifeline; each step
 * is a call (solid), a reply (dashed), a call to itself (a loop), or a note over participants.
 * Frames (alt, loop, opt) box a range of steps with a tag.
 */
export default async function sequence(spec) {
  const ps = spec.participants ?? [], steps = spec.steps ?? [];
  if (ps.length < 1) throw new Error("a sequence needs participants");
  const index = Object.fromEntries(ps.map((p, i) => [p.id, i]));
  for (const [i, s] of steps.entries()) {
    if (s.note && !s.over?.length) throw new Error(`step ${i + 1}: a note needs "over": [participant ids]`);
    for (const end of s.note ? s.over : [s.from, s.to]) if (!(end in index)) throw new Error(`step ${i + 1}: unknown participant "${end}"`);
  }
  const sizes = ps.map((p) => measure({ ...p, desc: p.desc }));
  // The gap between two neighbours fits the widest label of a message between them.
  const gaps = ps.slice(1).map(() => 60);
  for (const s of steps) {
    if (s.note) continue;
    const [a, b] = [index[s.from], index[s.to]].sort((x, y) => x - y);
    const need = textWidth(s.label ?? "", SMALL) + 40;
    if (a === b) { if (a < gaps.length) gaps[a] = Math.max(gaps[a], need / 2 + SELF_W); continue; }
    const have = sizes.slice(a + 1, b).reduce((t, z) => t + z.w, 0) + gaps.slice(a, b).reduce((t, g) => t + g, 0) + (sizes[a].w + sizes[b].w) / 2;
    if (need > have) for (let k = a; k < b; k++) gaps[k] += (need - have) / (b - a);
  }
  const m = new Model(spec.title ?? "sequence");
  const headH = Math.max(...sizes.map((z) => z.h));
  const xs = [];
  let x = 20;
  ps.forEach((p, i) => {
    xs.push(x + sizes[i].w / 2);
    drawNode(m, p, { x, y: TOP + headH - sizes[i].h, w: sizes[i].w, h: sizes[i].h });
    x += sizes[i].w + (gaps[i] ?? 0);
  });

  let y = TOP + headH + 36;
  const rows = [], ends = [];
  // A frame names its steps by number (from 1) or by a step's `id`, which survives inserting a step.
  const stepAt = (v, f) => {
    if (typeof v !== "string") return v;
    const i = steps.findIndex((s) => s.id === v);
    if (i < 0) throw new Error(`frame "${f.label}": no step with id "${v}"`);
    return i + 1;
  };
  const frames = (spec.frames ?? []).map((f, k) => ({ ...f, from: stepAt(f.from ?? 1, f), to: stepAt(f.to ?? steps.length, f), ...(f.else ? { else: { ...f.else, at: stepAt(f.else.at, f) } } : {}), k }));
  // A frame holds another that sits inside its steps; with the same steps, the one listed first holds.
  const holds = (g, f) => g !== f && g.from <= f.from && g.to >= f.to && (g.from < f.from || g.to > f.to || g.k < f.k);
  const count = (pick) => frames.filter(pick).length;
  for (const [i, s] of steps.entries()) {
    y += 24 * count((f) => f.from === i + 1);
    if (count((f) => f.to === i)) y += 4 + 12 * count((f) => f.to === i);
    if (frames.some((f) => f.else?.at === i + 1)) y += 30;
    rows.push(y);
    if (s.note) {
      const over = s.over.map((id) => index[id]).sort((a, b) => a - b);
      const left = xs[over[0]] - 60, right = xs[over.at(-1)] + 60;
      const lines = wrap(s.note, right - left - 20, SMALL);
      const h = lines.length * 16 + 12;
      m.shape({ x: left, y: y - 12, w: right - left, h, value: lines.map(esc).join("<br>"), style: S.node("note") + `fontSize=${SMALL};`, role: "text" });
      ends.push(y - 12 + h);
      y += h + 14;
      continue;
    }
    const a = index[s.from], b = index[s.to];
    const name = s.tone ?? (s.main ? "main" : "grey");
    noteEdgeTone(m, name);
    const tone = s.tone || s.main ? EDGE[name] : s.reply ? C.grey : C.ink;
    const style = S.edge(name, { dashed: Boolean(s.reply || s.async) }) + `strokeColor=${tone};` + (s.reply ? "endArrow=open;endFill=0;" : "");
    const lw = textWidth(s.label ?? "", SMALL) + 10;
    if (a === b) {
      const x0 = xs[a];
      m.edge({ points: [[x0, y], [x0 + SELF_W, y], [x0 + SELF_W, y + 22], [x0, y + 22]], style });
      ends.push(y + 22);
      if (s.label) m.shape({ x: x0 + SELF_W + 8, y: y + 2, w: lw + 8, h: 18, value: esc(s.label), style: S.label(tone), role: "label" });
      y += STEP + 12;
      continue;
    }
    m.edge({ points: [[xs[a], y], [xs[b], y]], style });
    ends.push(y + 16);
    if (s.label) m.shape({ x: (xs[a] + xs[b]) / 2 - lw / 2, y: y - 21, w: lw, h: 18, value: esc(s.label), style: S.label(tone), role: "label" });
    y += STEP;
  }
  const bottom = y + 6;
  // Lifelines go behind everything else.
  const life = xs.map((lx) => ({ id: m.id("e"), source: null, target: null, points: [[lx, TOP + headH], [lx, bottom]], style: `endArrow=none;html=1;dashed=1;strokeColor=${C.soft};`, label: "", role: "deco" }));
  m.edges.unshift(...life);

  for (const f of frames) {
    const from = rows[f.from - 1], to = ends[f.to - 1];
    if (from === undefined || to === undefined) throw new Error(`frame "${f.label}": steps ${f.from}..${f.to} out of range (1..${steps.length})`);
    const tag = `${f.kind ?? "alt"}${f.label ? ` [${f.label}]` : ""}`;
    // Inside another frame it is inset; above and below, it clears the frames it holds that start or end on its steps.
    const depth = count((g) => holds(g, f)), inset = 10 * depth;
    const top = from - 44 - 24 * count((g) => holds(f, g) && g.from === f.from), foot = to + 18 + 12 * count((g) => holds(f, g) && g.to === f.to);
    const frame = { x: 8 + inset, y: top, w: Math.max(...xs) + 80 - 8 - 2 * inset, h: foot - top };
    // The tag is a card of its own in the frame's corner, so lifelines passing under it never show through.
    m.shapes.unshift({ id: m.id(), parent: null, ...frame, value: "", role: "deco", style: `rounded=0;html=1;fillColor=none;strokeColor=${C.soft};` },
      { id: m.id(), parent: null, x: frame.x + 1, y: frame.y + 1, w: textWidth(tag, SMALL, { bold: true }) + 16, h: 20, value: `<b>${esc(tag)}</b>`, role: "deco",
        style: `rounded=0;html=1;align=left;spacingLeft=8;fontSize=${SMALL};fontColor=${C.grey};fillColor=${C.canvas};strokeColor=none;` });
    if (!f.else) continue;
    if (f.else.label === undefined) m.defaults.add('"else" (frames[].else.label)');
    // The other branch of an alt: a dashed divider at the first step it covers, its condition under it.
    const at = rows[f.else.at - 1];
    if (at === undefined || f.else.at <= f.from || f.else.at > f.to) throw new Error(`frame "${f.label}": else.at ${f.else.at} must be a step inside the frame`);
    // Frames it holds that start on that step open under its divider and condition.
    const lift = 24 * count((g) => holds(f, g) && g.from === f.else.at);
    m.edges.unshift({ id: m.id("e"), source: null, target: null, points: [[frame.x, at - 42 - lift], [frame.x + frame.w, at - 42 - lift]], style: `endArrow=none;html=1;dashed=1;strokeColor=${C.soft};`, label: "", role: "deco" });
    m.shapes.push({ id: m.id(), parent: null, x: frame.x + 8, y: at - 40 - lift, w: textWidth(`[${f.else.label ?? "else"}]`, SMALL, { bold: true }) + 8, h: 16,
      value: `<b>${esc(`[${f.else.label ?? "else"}]`)}</b>`, role: "deco", style: S.text(C.grey, SMALL, "left") + `labelBackgroundColor=${C.canvas};` });
  }
  return m;
}
