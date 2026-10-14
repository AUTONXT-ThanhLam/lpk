import { deflateRawSync } from "node:zlib";
import { ACCENTS, C, TONES, esc, iconShape, textWidth, wrap } from "./style.mjs";
import { S } from "./model.mjs";

/**
 * Isometric drawing: a scene of slabs, tiles, floating panels, cables and labels in plan
 * coordinates (x, y on the ground, z up), projected at 30 degrees and drawn back to front.
 * Every face is a draw.io stencil and every name a text cell, so the picture stays editable.
 * draw.io rotates text but cannot skew it, so a name lies along a face's edge at +-30 degrees.
 */
export const C30 = Math.cos(Math.PI / 6);
export const P = (x, y, z = 0) => [(x - y) * C30, (x + y) / 2 - z];
const r2 = (v) => v.toFixed(2);

/** One cell drawing closed faces and open lines given as screen points. */
export function stencil(m, paths, { extra = "", role = "deco", value = "" } = {}) {
  const all = paths.flatMap((p) => p.pts);
  const x0 = Math.min(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1]));
  const w = Math.max(1, Math.max(...all.map((p) => p[0])) - x0), h = Math.max(1, Math.max(...all.map((p) => p[1])) - y0);
  const body = paths.map((p) => {
    const d = p.pts.map(([x, y], i) => `<${i ? "line" : "move"} x="${r2(x - x0)}" y="${r2(y - y0)}"/>`).join("");
    const paint = `${p.fill ? `<fillcolor color="${p.fill}"/>` : ""}${p.stroke ? `<strokecolor color="${p.stroke}"/>` : ""}<strokewidth width="${p.sw ?? 1}"/>`;
    return `${paint}<path>${d}${p.open ? "" : "<close/>"}</path>${p.open || !p.fill ? "<stroke/>" : p.stroke ? "<fillstroke/>" : "<fill/>"}`;
  }).join("");
  const xml = `<shape w="${r2(w)}" h="${r2(h)}" aspect="variable" strokewidth="inherit"><foreground>${body}</foreground></shape>`;
  const style = `shape=stencil(${deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64")});html=1;${extra}`;
  return m.shape({ x: x0, y: y0, w, h, style, role, value });
}

/** The three visible faces of a box from z to z + t: top, the +y side, the +x side. */
export function block(m, { x, y, w, d, z = 0, t }, f, extra = "") {
  const top = [P(x, y, z + t), P(x + w, y, z + t), P(x + w, y + d, z + t), P(x, y + d, z + t)];
  const faces = [];
  if (t > 0) faces.push({ pts: [P(x, y + d, z + t), P(x + w, y + d, z + t), P(x + w, y + d, z), P(x, y + d, z)], fill: f.s1, stroke: f.line, sw: f.sw ?? 1 },
    { pts: [P(x + w, y + d, z + t), P(x + w, y, z + t), P(x + w, y, z), P(x + w, y + d, z)], fill: f.s2, stroke: f.line, sw: f.sw ?? 1 });
  faces.push({ pts: top, fill: f.top, stroke: f.line, sw: f.sw ?? 1 });
  return stencil(m, faces, { extra });
}

/** A Lucide icon lying flat on the plane at height z, its top towards `-axis` of the reading direction. */
export function flatIcon(m, name, [cx, cy, z], size, color, along) {
  const shape = iconShape(name);
  if (!shape) throw new Error(`no icon "${name}"; search with: drawio icons <words>`);
  const s = size / 24, [ux, uy] = along === "x" ? [C30, 0.5] : [C30, -0.5], [vx, vy] = along === "x" ? [-C30, 0.5] : [C30, 0.5];
  const w = (Math.abs(ux) + Math.abs(vx)) * size, h = (Math.abs(uy) + Math.abs(vy)) * size;
  const [ox, oy] = [w / 2 - (ux + vx) * size / 2, h / 2 - (uy + vy) * size / 2];
  const body = shape.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}"><g transform="matrix(${ux * s} ${uy * s} ${vx * s} ${vy * s} ${r2(ox)} ${r2(oy)})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
  const [px, py] = P(cx, cy, z);
  m.shape({ x: px - w / 2, y: py - h / 2, w, h, role: "deco", style: `shape=image;html=1;imageAspect=0;image=data:image/svg+xml,${Buffer.from(svg).toString("base64")};` });
}

/** Face colours for a part: its tone's meaning first, else its accent, else plain white. */
export function facesOf(x, plain = { top: "#ffffff", s1: "#ececf0", s2: "#dedee3", line: "#7a7a82" }) {
  if (x.tone && x.tone !== "neutral") {
    const t = TONES[x.tone];
    if (!t) throw new Error(`"${x.id ?? x.title}": unknown tone "${x.tone}"`);
    return { top: t.fill, s1: mix(t.fill, t.line, 0.22), s2: mix(t.fill, t.line, 0.38), line: t.line, text: t.text, dashed: t.dashed };
  }
  if (x.accent) {
    const a = ACCENTS[x.accent];
    if (!a) throw new Error(`"${x.id ?? x.title}": unknown accent "${x.accent}" (${Object.keys(ACCENTS).join(", ")})`);
    return { ...a, text: a.text };
  }
  return { ...plain, text: C.ink };
}

export function mix(a, b, k) {
  const ch = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A name lying on a face: centred at plan point c, running along the face's x or y edge, in
 * `room` px along it and `deep` px across it (both measured on the face). Returns the cell and
 * the fact when the name does not fit, so the author can widen the part or shorten the name.
 */
export function faceName(m, html, plain, [cx, cy, z], along, room, deep, { size = 13, bold = true, color = C.ink, who } = {}) {
  const lines = wrap(plain, Math.max(20, room), size, { bold });
  const w = Math.max(...lines.map((l) => textWidth(l, size, { bold }))), h = lines.length * (size + 4);
  // A rectangle laid in a 60-degree parallelogram loses h / tan 60 of its length.
  const fits = w + h * 0.58 <= room + 1 && h <= deep * C30 + 1;
  const [px, py] = P(cx, cy, z), bw = Math.max(w, room) + 4;
  const value = lines.length > 1 && html === esc(plain) ? lines.map(esc).join("<br>") : html;
  const cell = m.shape({ x: px - bw / 2, y: py - h / 2, w: bw, h, value, role: "iso-name",
    style: `text;html=1;whiteSpace=nowrap;align=center;verticalAlign=middle;fontSize=${size};${bold ? "fontStyle=1;" : ""}fontColor=${color};rotation=${along === "x" ? 30 : -30};` });
  cell.rot = along === "x" ? 30 : -30;
  return fits ? null : `name "${plain}" does not fit on ${who ?? "its part"}: widen it or shorten the name`;
}

/** A white pill with a short word on a line ("USB", "reads"). */
export function pill(m, [px, py], text, color = C.grey, line = C.chipLine) {
  const w = textWidth(text, 11) + 18;
  return m.shape({ x: px - w / 2, y: py - 11, w, h: 22, value: esc(text), role: "label", style: S.label(color).replace(`strokeColor=${C.chipLine}`, `strokeColor=${line}`) });
}

/**
 * A pill naming a line given as screen segments: on the line near its middle where the line
 * shows past both its ends, else beside it; it slides along the line to stay clear of `hulls`.
 */
export function linePill(m, segs, text, color, hulls) {
  const len = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]), total = segs.reduce((t, g) => t + len(g), 0), w = textWidth(text, 11) + 18;
  const at = (d) => {
    for (const g of segs) {
      const l = len(g);
      if (d <= l || g === segs.at(-1)) { const t = Math.min(Math.max(d, Math.min(18, l / 2)), Math.max(l - 18, l / 2)) / (l || 1); return [[g[0][0] + (g[1][0] - g[0][0]) * t, g[0][1] + (g[1][1] - g[0][1]) * t], g, l]; }
      d -= l;
    }
  };
  const spots = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7].flatMap((k) => {
    const [[x, y], [a, b], l] = at(total * (0.5 + k * 0.06)), dx = b[0] - a[0], dy = b[1] - a[1];
    if (l >= w + 40) return [[x, y]];
    if (Math.abs(dx) < 1) return [[x + w / 2 + 8, y], [x - w / 2 - 8, y]];
    const off = 15 + (Math.abs(dy / dx) * w) / 2;
    return [[x, y - off], [x, y + off]];
  });
  const clear = ([x, y]) => {
    const probe = [-1, 0, 1].flatMap((u) => [-1, 0, 1].map((v) => [x + (u * w) / 2, y + v * 11]));
    return !hulls.some((h) => probe.some((q) => inPoly(h, q)) || h.some(([u, v]) => Math.abs(u - x) < w / 2 && Math.abs(v - y) < 11));
  };
  return pill(m, spots.find(clear) ?? spots[0], text, color);
}

/** A part's outline on screen, a convex hexagon going clockwise. */
export function hull(p) {
  const z0 = p.z, z1 = p.z + p.t;
  return [P(p.x, p.y, z1), P(p.x + p.w, p.y, z1), P(p.x + p.w, p.y, z0), P(p.x + p.w, p.y + p.d, z0), P(p.x, p.y + p.d, z0), P(p.x, p.y + p.d, z1)];
}
export const inPoly = (h, [u, v]) => h.every(([ax, ay], i) => { const [bx, by] = h[(i + 1) % h.length]; return (bx - ax) * (v - ay) - (by - ay) * (u - ax) >= -0.01; });

/** A flat label with a tick, hung above or below a screen point, on a stem `stem` px long. */
export function callout(m, [px, py], html, plain, f, below, stem = 0) {
  const w = textWidth(plain, 13) + 30, h = 30, s = below ? 1 : -1;
  if (stem) {
    m.edge({ points: [[px, py], [px, py + s * (stem + 4)]], style: `edgeStyle=none;html=1;endArrow=none;strokeColor=${f.line};strokeWidth=1.2;`, role: "deco" });
    m.shape({ x: px - 3, y: py - 3, w: 6, h: 6, role: "deco", style: `ellipse;html=1;fillColor=${f.line};strokeColor=#ffffff;` });
  }
  m.shape({ x: px - w / 2, y: below ? py + 10 + stem : py - 10 - h - stem, w, h, value: html, role: "label",
    style: `rounded=0;html=1;fontSize=13;fontColor=${C.ink};fillColor=#ffffff;strokeColor=${f.line};shadow=1;` });
  m.shape({ x: px - 7, y: below ? py + 2 + stem : py - 11 - stem, w: 14, h: 9, role: "deco",
    style: `triangle;direction=${below ? "north" : "south"};html=1;fillColor=#ffffff;strokeColor=${f.line};` });
}

/** A line through plan points [x, y, z], with an arrowhead at its end unless `arrow` is false. */
export function cable(m, pts3, { color = C.line, main = false, dashed = false, arrow = true, both = false } = {}) {
  const pts = pts3.map((p) => P(...p)).filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.5);
  const style = `edgeStyle=none;rounded=0;html=1;endArrow=${arrow ? "block" : "none"};endFill=1;endSize=6;strokeColor=${main ? C.blue : color};` +
    `${main ? "strokeWidth=1.8;" : "strokeWidth=1.4;"}${dashed ? "dashed=1;dashPattern=5 4;" : ""}${both ? "startArrow=block;startFill=1;startSize=6;" : ""}`;
  return m.edge({ points: pts, style, role: "cable" });
}

/** True when the rotated or plain label rectangles a and b overlap (separating axis test). */
export function labelsOverlap(a, b) {
  const corners = (s) => {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, t = ((s.rot ?? 0) * Math.PI) / 180, [c, n] = [Math.cos(t), Math.sin(t)];
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + (u * s.w / 2) * c - (v * s.h / 2) * n, cy + (u * s.w / 2) * n + (v * s.h / 2) * c]);
  };
  const A = corners(a), B = corners(b);
  for (const poly of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4], ax = y1 - y2, ay = x2 - x1;
    const pa = A.map(([x, y]) => x * ax + y * ay), pb = B.map(([x, y]) => x * ax + y * ay);
    if (Math.max(...pa) <= Math.min(...pb) + 1 || Math.max(...pb) <= Math.min(...pa) + 1) return false;
  }
  return true;
}

/** Facts for rotated names that cover each other or a pill or callout; check() covers two flat labels. */
export function labelFacts(m) {
  const out = [];
  const name = (s) => String(s.value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const ls = m.shapes.filter((s) => s.role === "iso-name" || s.role === "label");
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    if (ls[i].role === "label" && ls[j].role === "label") continue;
    const a = { ...ls[i], w: tight(ls[i]) }, b = { ...ls[j], w: tight(ls[j]) };
    if (labelsOverlap(a, b)) out.push(`labels overlap: "${name(ls[i])}" and "${name(ls[j])}"`);
  }
  return out;
}
// A rotated name's cell is as wide as its face; only its text counts for overlap.
const tight = (s) => (s.role === "iso-name" ? Math.min(s.w, Math.max(...String(s.value).split("<br>").map((l) => textWidth(l.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "x"), 13, { bold: true }))) + 6) : s.w);
