import { C, FONT, SMALL, TONES, esc, textWidth } from "./style.mjs";
import { Model, S } from "./model.mjs";
import { axis, fmt, line } from "./chart.mjs";

// One slice in blue for the part the reader should see, the rest in greys that stay apart.
const SLICES = [C.blue, "#a8afba", "#cfd4dc", "#6b7480", "#e6e8ec", "#e07a4f"];
const DOT = { neutral: C.ink, ...Object.fromEntries(Object.entries(TONES).filter(([k]) => k !== "neutral").map(([k, t]) => [k, t.line])) };

/** The title is drawn in the shared band above the picture, so the plot starts at the top. */
const title = () => 20;

/** Shares of one whole as a ring, biggest first from the top, with a key of names, values and percents. */
export function donut(spec) {
  const cats = spec.categories, vals = spec.series[0].values;
  if (spec.series.length !== 1) throw new Error("a donut takes one series");
  if (vals.some((v) => !(v >= 0))) throw new Error("a donut takes values of 0 or more");
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) throw new Error("a donut needs a value above 0");
  const m = new Model(spec.title ?? "donut");
  const y0 = title(m, spec, 520), D = 220, x0 = 20;
  const order = vals.map((v, i) => i);
  // Whole percents that add up to 100 (largest remainder); a slice under 1% reads "<1%" and
  // one over 99% (but not all) ">99%".
  const raw = vals.map((v) => (v / total) * 100), pct = raw.map(Math.floor);
  [...raw.keys()].sort((a, b) => (raw[b] - pct[b]) - (raw[a] - pct[a])).slice(0, 100 - pct.reduce((a, b) => a + b, 0)).forEach((i) => pct[i]++);
  let at = 0;
  order.forEach((i, k) => {
    const share = vals[i] / total;
    if (!share) return;
    const color = SLICES[k % SLICES.length];
    m.shape({ x: x0, y: y0, w: D, h: D, role: "deco",
      style: `shape=mxgraph.basic.partConcEllipse;startAngle=${at.toFixed(4)};endAngle=${Math.min(0.9999, at + share).toFixed(4)};arcWidth=0.38;fillColor=${color};strokeColor=#ffffff;strokeWidth=2;` });
    at += share;
    const ky = y0 + 20 + k * 30;
    m.shape({ x: x0 + D + 40, y: ky + 3, w: 14, h: 14, style: `rounded=1;fillColor=${color};strokeColor=none;`, role: "deco" });
    const text = `<b>${esc(cats[i])}</b>&nbsp;&nbsp;<font color="${C.grey}">${esc(fmt(vals[i], spec))} · ${raw[i] < 1 ? "&lt;1" : raw[i] > 99 && raw[i] < 100 ? "&gt;99" : pct[i]}%</font>`;
    m.shape({ x: x0 + D + 62, y: ky, w: textWidth(`${cats[i]}  ${fmt(vals[i], spec)} · 100%`, SMALL, { bold: true }) + 16, h: 20, value: text, style: S.text(C.ink, SMALL), role: "text" });
  });
  if (spec.center === undefined) m.defaults.add('"total" (center)');
  m.shape({ x: x0 + D * 0.25, y: y0 + D / 2 - 22, w: D * 0.5, h: 44, role: "text",
    value: `<b style="font-size:18px">${esc(fmt(total, spec))}</b><br><font color="${C.grey}">${esc(spec.center ?? "total")}</font>`, style: S.text(C.ink, SMALL, "center") });
  return m;
}

/** An axis name with its unit once, "Prompt size (k tokens)", so the ticks stay plain numbers. */
const axisName = (a) => (a.unit ? `${a.title ?? ""} (${a.unit})`.trim() : a.title);

/** Two measures per item: each point at (x, y), named beside it, coloured by its tone. */
export function scatter(spec) {
  const pts = spec.points ?? [];
  if (!pts.length) throw new Error("a scatter needs points: [{x, y, label}]");
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("every point needs a number x and y");
  const m = new Model(spec.title ?? "scatter");
  const ax = axis(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)));
  const ay = axis(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)));
  const W = spec.width ?? 520, H = spec.height ?? 320, y0 = title(m, spec, W) + 34, x0 = 90;
  const X = (v) => x0 + ((v - ax.bottom) / (ax.top - ax.bottom)) * W, Y = (v) => y0 + H - ((v - ay.bottom) / (ay.top - ay.bottom)) * H;
  const xs = spec.x ?? {}, ys = spec.y ?? {};
  for (let v = ay.bottom; v <= ay.top + 1e-9; v += ay.step) {
    line(m, [[x0, Y(v)], [x0 + W, Y(v)]], `endArrow=none;html=1;strokeColor=#e4e4e8;`);
    m.shape({ x: x0 - 64, y: Y(v) - 9, w: 58, h: 18, value: esc(fmt(Number(v.toFixed(10)), {})), style: S.text(C.grey, SMALL, "right"), role: "deco" });
  }
  for (let v = ax.bottom; v <= ax.top + 1e-9; v += ax.step) {
    line(m, [[X(v), y0], [X(v), y0 + H]], `endArrow=none;html=1;strokeColor=#e4e4e8;`);
    m.shape({ x: X(v) - 40, y: y0 + H + 4, w: 80, h: 18, value: esc(fmt(Number(v.toFixed(10)), {})), style: S.text(C.grey, SMALL, "center"), role: "deco" });
  }
  if (xs.title || xs.unit) m.shape({ x: x0, y: y0 + H + 26, w: W, h: 18, value: `<b>${esc(axisName(xs))}</b>`, style: S.text(C.grey, SMALL, "center"), role: "deco" });
  // The y axis is named above its top tick, read left to right, not turned on its side.
  if (ys.title || ys.unit) m.shape({ x: x0 - 64, y: y0 - 30, w: textWidth(axisName(ys), SMALL, { bold: true }) + 12, h: 18, value: `<b>${esc(axisName(ys))}</b>`, style: S.text(C.grey, SMALL), role: "deco" });
  for (const p of pts) {
    const tone = p.tone ?? "neutral";
    if (!DOT[tone]) throw new Error(`point "${p.label}": unknown tone "${tone}"`);
    if (tone !== "neutral") m.tones.add(tone);
    const cx = X(p.x), cy = Y(p.y);
    m.shape({ x: cx - 6, y: cy - 6, w: 12, h: 12, style: `ellipse;fillColor=${DOT[tone]};strokeColor=#ffffff;strokeWidth=1.5;`, role: "deco" });
    if (p.label) m.shape({ x: cx + 9, y: cy - 9, w: textWidth(p.label, SMALL) + 8, h: 18, value: esc(p.label), style: S.text(C.ink, SMALL), role: "text" });
  }
  return m;
}
