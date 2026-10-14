import { C, EDGE, MONO, SANS, TONES, esc } from "./style.mjs";

/**
 * Shapes and edges with absolute geometry, written out as a draw.io file. A shape inside a group
 * is that group's child in the file, so it moves with the group when someone edits the diagram.
 */
export class Model {
  constructor(name) {
    this.name = name;
    this.shapes = [];
    this.edges = [];
    this.n = 0;
    this.facts = [];
    this.tones = new Set();
    /** Tones seen only on arrows, so the legend shows them as a line, not a box. */
    this.lineTones = new Set();
    /** Words drawn from a built-in English default, each with the spec key that replaces it. */
    this.defaults = new Set();
    /** An isometric scene is painted back to front: cells keep the order they were made in. */
    this.painter = false;
    this.k = 0;
  }

  id(prefix = "c") {
    return `${prefix}${++this.n}`;
  }

  /** role: group | node | chip | text | label (an edge label) | deco (lines, bars: never checked). */
  shape({ id, parent = null, x, y, w, h, value = "", style, role = "node" }) {
    const s = { id: id ?? this.id(), parent, x, y, w, h, value, style, role, k: this.k++ };
    this.shapes.push(s);
    return s;
  }

  /** points: the full route, first point on the source's border, last on the target's. The main path glows. */
  edge({ source = null, target = null, points, style, label = "", role = "edge" }) {
    const e = { id: this.id("e"), source, target, points, style, label, role, glow: style.includes(MAIN), k: this.k++ };
    this.edges.push(e);
    return e;
  }

  byId(id) {
    return this.shapes.find((s) => s.id === id);
  }

  bounds() {
    const xs = [], ys = [];
    for (const s of this.shapes) xs.push(s.x, s.x + s.w), ys.push(s.y, s.y + s.h);
    for (const e of this.edges) for (const [x, y] of e.points) xs.push(x), ys.push(y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  /** Every cell in the order it is painted, the main path's glow copies included as plain lines. */
  ordered() {
    const glows = this.edges.filter((e) => e.glow).map((e) => ({ ...e, id: `${e.id}g`, label: "", style: GLOW, role: "deco", glow: false, k: e.k - 0.5 }));
    // Decorations (lifelines, grid) first, then group panels, then the main path's glow, so the
    // glow shows on a panel and everything else draws over it.
    return this.painter
      ? [...this.shapes, ...this.edges, ...glows].sort((a, b) => a.k - b.k)
      : [...this.edges.filter((e) => e.role === "deco"), ...this.shapes.filter((s) => s.role === "group"), ...glows,
        ...this.shapes.filter((s) => s.role !== "group"), ...this.edges.filter((e) => e.role !== "deco")];
  }

  xml() {
    const r = (v) => Math.round(v * 10) / 10;
    const cells = [];
    const byId = (id) => this.byId(id);
    const order = this.ordered();
    for (const item of order) {
      if (item.points) { edgeXml(item); continue; }
      const s = item;
      const p = s.parent ? this.byId(s.parent) : null;
      const [x, y] = p ? [s.x - p.x, s.y - p.y] : [s.x, s.y];
      cells.push(`<mxCell id="${s.id}" value="${esc(s.value)}" style="${font(s.style)}" vertex="1" parent="${s.parent ?? 1}">` +
        `<mxGeometry x="${r(x)}" y="${r(y)}" width="${r(s.w)}" height="${r(s.h)}" as="geometry"/></mxCell>`);
    }
    function edgeXml(e) {
      if (!e.source || !e.target) {
        const [a, b] = [e.points[0], e.points.at(-1)];
        const mid = e.points.slice(1, -1).map(([x, y]) => `<mxPoint x="${r(x)}" y="${r(y)}"/>`).join("");
        cells.push(`<mxCell id="${e.id}" value="${esc(e.label)}" style="${font(e.style)}" edge="1" parent="1"><mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${r(a[0])}" y="${r(a[1])}" as="sourcePoint"/><mxPoint x="${r(b[0])}" y="${r(b[1])}" as="targetPoint"/>${mid ? `<Array as="points">${mid}</Array>` : ""}</mxGeometry></mxCell>`);
        return;
      }
      const src = byId(e.source), dst = byId(e.target);
      const [a, b] = [e.points[0], e.points.at(-1)];
      const frac = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
      // draw.io turns a shape's connection points with it: undo the quarter turn of direction=south.
      const rel = (s, [x, y]) => {
        const [u, v] = [(x - s.x) / s.w, (y - s.y) / s.h];
        return (s.style.includes("direction=south") ? [v, 1 - u] : [u, v]).map(frac);
      };
      const [ex, ey] = rel(src, a), [nx, ny] = rel(dst, b);
      const pts = e.points.slice(1, -1).map(([x, y]) => `<mxPoint x="${r(x)}" y="${r(y)}"/>`).join("");
      cells.push(`<mxCell id="${e.id}" value="${esc(e.label)}" style="${font(e.style)}exitX=${ex};exitY=${ey};exitPerimeter=0;entryX=${nx};entryY=${ny};entryPerimeter=0;" edge="1" source="${e.source}" target="${e.target}" parent="1">` +
        `<mxGeometry relative="1" as="geometry">${pts ? `<Array as="points">${pts}</Array>` : ""}</mxGeometry></mxCell>`);
    }
    return `<mxfile><diagram name="${esc(this.name)}"><mxGraphModel grid="1" gridSize="10" page="0" background="${C.canvas}">` +
      `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
  }
}

/** draw.io style strings for each kind of thing the house style draws. */
export const SHAPES = {
  box: "rounded=1;arcSize=6;",
  db: "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;",
  queue: "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;direction=south;",
  doc: "shape=document;boundedLbl=1;size=0.12;",
  cloud: "ellipse;shape=cloud;",
  hexagon: "shape=hexagon;perimeter=hexagonPerimeter2;size=0.1;",
  circle: "ellipse;",
  decision: "rhombus;",
  note: "shape=note;size=12;align=left;spacingLeft=10;",
  start: "ellipse;", end: "ellipse;shape=endState;",
};
/** Curved shapes draw their shadow as broken strokes in draw.io, so they stay flat. */
const FLAT = new Set(["db", "queue", "cloud", "doc"]);
export const edgeTone = (e) => e.tone ?? (e.main ? "main" : "grey");
/** The main path is drawn a little heavier, which is also how the file marks it to glow. */
const MAIN = "strokeWidth=1.8;";
const GLOW = `edgeStyle=none;rounded=0;html=1;endArrow=none;startArrow=none;strokeColor=${C.glow};strokeWidth=7;opacity=35;`;
/** Every label is set in Inter unless its style names a face. */
const font = (style) => (style.includes("fontFamily=") ? style : SANS + style);

export const S = {
  /** A soft panel: tinted, no heavy border; an accent tints it from the top. */
  group: (tone = "neutral", accent = null) => {
    const t = TONES[tone] ?? TONES.neutral;
    const fill = tone !== "neutral" ? `fillColor=${t.group[0]};strokeColor=${t.group[1]};` : accent ? `fillColor=${accent.fill};gradientColor=${C.group};gradientDirection=south;strokeColor=none;` : `fillColor=${C.group};strokeColor=none;`;
    return `rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;${fill}${t.dashed ? "dashed=1;" : ""}verticalAlign=top;align=left;spacingLeft=14;spacingTop=8;fontSize=14;fontColor=${C.ink};`;
  },
  /** A white card with a hairline and a soft shadow; a tone fills it with its meaning, an accent tints it. */
  node: (shape, tone = "neutral", accent = null) => {
    if (!SHAPES[shape]) throw new Error(`unknown node kind "${shape}" (${[...Object.keys(SHAPES), "table"].join(", ")})`);
    const t = TONES[tone];
    if (shape === "start" || shape === "end") return SHAPES[shape] + `fillColor=${C.ink};strokeColor=${C.ink};`;
    const [fill, line] = shape === "note" ? [C.note, C.noteLine] : tone === "neutral" && accent ? [accent.fill, accent.line] : [t.fill, t.line];
    return `whiteSpace=wrap;html=1;fontSize=14;fontColor=${tone === "muted" ? t.text : C.ink};shadow=${tone === "muted" || FLAT.has(shape) ? 0 : 1};` + SHAPES[shape] +
      `fillColor=${fill};strokeColor=${line};` + (t.dashed ? "dashed=1;" : "");
  },
  chip: `rounded=1;arcSize=50;html=1;${MONO}fontSize=11;fontColor=${C.ink};fillColor=${C.chip};strokeColor=${C.chipLine};`,
  text: (color = C.grey, size = 12, align = "left") => `text;html=1;align=${align};verticalAlign=middle;fontSize=${size};fontColor=${color};`,
  /** An arrow's label: a small white pill on the line. */
  label: (color) => `rounded=1;arcSize=50;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=${color};fillColor=#ffffff;strokeColor=${C.chipLine};`,
  edge: (tone = "grey", { dashed = false, both = false } = {}) => {
    const color = EDGE[tone];
    if (!color) throw new Error(`unknown arrow tone "${tone}" (${Object.keys(EDGE).join(", ")})`);
    return `edgeStyle=none;rounded=0;html=1;endArrow=block;endFill=1;endSize=6;strokeColor=${color};${tone === "main" || tone === "blue" || tone === "new" ? MAIN : "strokeWidth=1.2;"}` +
      (dashed ? "dashed=1;dashPattern=5 4;" : "") + (both ? "startArrow=block;startFill=1;startSize=6;" : "");
  },
};
