import { C, FONT, TONES, accentOf, esc, iconImg, textWidth } from "./style.mjs";
import { Model } from "./model.mjs";
import { drawNode, measure } from "./nodes.mjs";
import { wire } from "./wires.mjs";

const COL_GAP = 56, PAD = 22, TITLE_PAD = 36;

/**
 * A process across roles: one horizontal lane per role, steps placed by `lane` and `at` (the
 * column, from 0, shared by all lanes so a step's place says when it happens). A step without
 * `at` goes one column after the latest step with an arrow into it. Arrows between
 * steps are routed around every step, as in a placed graph.
 */
export default async function swimlane(spec) {
  const lanes = spec.lanes ?? [], steps = spec.steps ?? [];
  if (!lanes.length || !steps.length) throw new Error("a swimlane needs lanes and steps");
  const laneOf = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
  const ids = new Set(lanes.map((l) => l.id));
  for (const s of steps) {
    if (!s.id) throw new Error(`every step needs an id: ${JSON.stringify(s).slice(0, 60)}`);
    if (ids.has(s.id)) throw new Error(`duplicate id "${s.id}"`);
    ids.add(s.id);
    if (!(s.lane in laneOf)) throw new Error(`step "${s.id}": unknown lane "${s.lane}"`);
    if (s.at !== undefined && (!Number.isInteger(s.at) || s.at < 0)) throw new Error(`step "${s.id}": "at" is its column, a whole number from 0`);
  }
  placeColumns(steps, spec.edges ?? []);
  const size = Object.fromEntries(steps.map((s) => [s.id, measure(s)]));
  const ncol = Math.max(...steps.map((s) => s.at)) + 1;
  const cw = Array.from({ length: ncol }, (_, c) => Math.max(120, ...steps.filter((s) => s.at === c).map((s) => size[s.id].w)));
  const lh = lanes.map((l) => Math.max(64, ...steps.filter((s) => s.lane === l.id).map((s) => size[s.id].h)) + 2 * PAD);
  const titleW = Math.max(...lanes.map((l) => textWidth(l.title, FONT, { bold: true }) + (l.icon ? 22 : 0))) + TITLE_PAD;
  const x0 = 20 + titleW + COL_GAP / 2, width = titleW + cw.reduce((a, b) => a + b, 0) + COL_GAP * ncol;
  const colX = cw.map((_, c) => x0 + cw.slice(0, c).reduce((a, b) => a + b + COL_GAP, 0));
  const laneY = lh.map((_, i) => 20 + lh.slice(0, i).reduce((a, b) => a + b, 0));

  const m = new Model(spec.title ?? "swimlane");
  const abs = {}, obstacles = [];
  lanes.forEach((l, i) => {
    const t = TONES[l.tone ?? "neutral"];
    if (!t) throw new Error(`lane "${l.id}": unknown tone "${l.tone}"`);
    if (l.tone && l.tone !== "neutral") m.tones.add(l.tone);
    const a = accentOf(l);
    const fill = l.tone && l.tone !== "neutral" ? t.group[0] : a ? a.fill : i % 2 ? "#f3f3f5" : C.group;
    const lane = m.shape({ id: l.id, x: 20, y: laneY[i], w: width, h: lh[i], value: "", role: "group",
      style: `rounded=0;html=1;container=1;collapsible=0;fillColor=${fill};strokeColor=#ffffff;strokeWidth=2;${t.dashed ? "dashed=1;" : ""}` });
    const icon = l.icon ? `${iconImg(l.icon, l.tone && l.tone !== "neutral" ? t.line : a ? a.line : C.ink)}&nbsp;` : "";
    m.shape({ parent: lane.id, x: 20, y: laneY[i], w: titleW, h: lh[i], value: `${icon}<span style="font-weight:600">${esc(l.title)}</span>`, role: "deco",
      style: `rounded=0;html=1;whiteSpace=wrap;fontSize=${FONT};fontColor=${C.ink};fillColor=${a ? a.head[0] : "#e6e6ea"};${a ? `gradientColor=${a.head[1]};gradientDirection=east;` : ""}strokeColor=#ffffff;strokeWidth=2;` });
    obstacles.push({ id: `${l.id}:title`, x: 20, y: laneY[i], w: titleW, h: lh[i], pad: 2 });
  });
  for (const s of steps) {
    const { w, h } = size[s.id], i = laneOf[s.lane];
    const box = { x: colX[s.at] + (cw[s.at] - w) / 2, y: laneY[i] + (lh[i] - h) / 2, w, h };
    abs[s.id] = box;
    obstacles.push({ id: s.id, ...box });
    drawNode(m, s, box, s.lane);
  }
  lanes.forEach((l, i) => { abs[l.id] = { x: 20, y: laneY[i], w: width, h: lh[i] }; });
  wire(m, abs, spec.edges ?? [], { obstacles, groupIds: new Set(lanes.map((l) => l.id)), corners: new Set(steps.filter((n) => n.kind === "decision").map((n) => n.id)) });
  return m;
}

/** Columns for steps without `at`: the longest chain of arrows into each; a loop needs `at` on one of its steps. */
function placeColumns(steps, edges) {
  const col = new Map(steps.map((s) => [s.id, s.at ?? 0]));
  const free = steps.filter((s) => s.at === undefined).map((s) => s.id);
  for (let round = 0; ; round++) {
    let moved = false;
    for (const e of edges) {
      if (!free.includes(e.to) || !col.has(e.from) || col.get(e.to) > col.get(e.from)) continue;
      col.set(e.to, col.get(e.from) + 1);
      moved = true;
    }
    if (!moved) break;
    if (round > steps.length) throw new Error(`steps ${free.join(", ")} sit on a loop of arrows: give one of them "at"`);
  }
  for (const s of steps) s.at = col.get(s.id);
}
