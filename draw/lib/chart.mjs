import { ACCENTS, C, SMALL, esc, textWidth, wrap } from "./style.mjs";
import { Model, S } from "./model.mjs";
import { donut, scatter } from "./plot.mjs";

export const PALETTE = [C.blue, "#a8afba", "#e07a4f", C.ink, "#9cc0f5"];
const TONES = { blue: C.blue, grey: "#a8afba", orange: "#e07a4f", ink: C.ink, green: "#4f8f6c", red: "#d64545" };
const KINDS = ["bar", "hbar", "line", "waterfall", "donut", "scatter"];

/** A round axis from at most 0 to at least 0 covering every value, in steps of 1, 2 or 5 times a power of ten. */
export function axis(min, max) {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  if (hi === lo) return { bottom: 0, top: 1, step: 0.2 };
  const raw = (hi - lo) / 5, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw);
  return { bottom: Math.floor(lo / step) * step, top: Math.ceil(hi / step) * step, step };
}
/**
 * A value as the reader reads it: prefix, number, unit ("$2.5k", "12 ms"). Values on one chart
 * share `dp` decimals, so 3 sits beside 2.5 as "3.0"; a one-letter unit or % follows unspaced.
 */
export const fmt = (v, spec, dp = spec.dp) => {
  const n = dp === undefined || dp === null ? (Number.isInteger(v) ? Math.abs(v) : Number(Math.abs(v).toFixed(2))) : Math.abs(v).toFixed(dp);
  const unit = spec.unit ? (/^(%|[a-zA-Z]|×)$/.test(spec.unit) ? spec.unit : ` ${spec.unit}`) : "";
  return `${v < 0 ? "-" : ""}${spec.prefix ?? ""}${n}${unit}`;
};
/** The decimals the values need, at most 2. */
export const decimals = (vals) => Math.max(0, ...vals.map((v) => Math.min(2, (String(Number(v.toFixed(2))).split(".")[1] ?? "").length)));
export const line = (m, pts, style) => m.edges.push({ id: m.id("e"), source: null, target: null, points: pts, style, label: "", role: "deco" });

/**
 * Numbers as a picture: `bar` (columns, grouped when there are several series, stacked with
 * `stacked: true`), `hbar` (rows, for long category names), `line` (a trend), `waterfall` (a
 * start value and the changes that lead to the end), `donut` (shares of one whole) or `scatter`
 * (two measures per item). Every value is printed on its bar, slice or point.
 */
export default async function chart(spec) {
  const cats = [...(spec.categories ?? [])], series = spec.series ?? [];
  const kind = spec.chart ?? "bar";
  if (!KINDS.includes(kind)) throw new Error(`unknown chart "${kind}" (${KINDS.join(", ")})`);
  if (kind === "scatter") return scatter(spec);
  spec = { ...spec, dp: spec.dp ?? decimals(series.flatMap((s) => s.values ?? []).filter(Number.isFinite)) };
  if (!cats.length || !series.length) throw new Error("a chart needs categories and series");
  for (const s of series) if ((s.values ?? []).length !== cats.length) throw new Error(`series "${s.name}": ${s.values?.length ?? 0} values for ${cats.length} categories`);
  if (kind === "donut") return donut(spec);
  if (kind === "waterfall" && series.length !== 1) throw new Error("a waterfall takes one series: the start value, then each change");
  const stacked = Boolean(spec.stacked) && series.length > 1;
  const m = new Model(spec.title ?? "chart");
  for (const s of series) if (s.accent && !ACCENTS[s.accent]) throw new Error(`series "${s.name}": unknown accent "${s.accent}" (${Object.keys(ACCENTS).join(", ")})`);
  const color = (s, i) => TONES[s.tone] ?? ACCENTS[s.accent]?.line ?? PALETTE[i % PALETTE.length];
  const all = series.flatMap((s) => s.values);
  if (all.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error("every value must be a number");
  if ((kind === "hbar" || stacked) && Math.min(...all) < 0) throw new Error(`${stacked ? "a stacked chart" : "hbar"} takes values of 0 or more; use bar for values below 0`);
  // Each bar as [category, series, from, to]: side by side, stacked, or floating for a waterfall.
  const segs = [];
  if (kind === "waterfall") {
    let run = 0;
    series[0].values.forEach((v, ci) => { segs.push([ci, 0, ci ? run : 0, run + v]); run += v; });
    if (spec.total) segs.push([cats.length, 0, 0, run]);
  } else cats.forEach((_, ci) => { let base = 0; series.forEach((s, si) => { const v = s.values[ci]; segs.push(stacked ? [ci, si, base, (base += v)] : [ci, si, 0, v]); }); });
  const ends = segs.flatMap((g) => [g[2], g[3]]);
  const { bottom, top, step } = axis(Math.min(...ends), Math.max(...ends));
  if (kind === "waterfall" && spec.total) cats.push(spec.total);
  let y0 = 20;
  if (series.length > 1 && kind !== "waterfall") {
    let lx = 20;
    series.forEach((s, i) => {
      m.shape({ x: lx, y: y0 + 4, w: 12, h: 12, style: `rounded=1;fillColor=${color(s, i)};strokeColor=none;`, role: "deco" });
      const w = textWidth(s.name, SMALL) + 12;
      m.shape({ x: lx + 16, y: y0, w, h: 20, value: esc(s.name), style: S.text(C.ink), role: "text" });
      lx += w + 34;
    });
    y0 += 30;
  }
  const ticks = [];
  for (let k = 0; bottom + k * step <= top + 1e-9; k++) ticks.push(Number((bottom + k * step).toFixed(10)));
  const tickW = Math.max(...ticks.map((v) => textWidth(fmt(v, spec, null), SMALL))) + 10;

  if (kind === "hbar") {
    const labelW = Math.min(240, Math.max(...cats.map((c) => textWidth(c, SMALL)))) + 14;
    const rowH = Math.max(28, 22 * series.length + 10), W = spec.width ?? 520, x0 = 20 + labelW, H = rowH * cats.length;
    for (const v of ticks) {
      const x = x0 + (v / top) * W;
      line(m, [[x, y0], [x, y0 + H]], `endArrow=none;html=1;strokeColor=#e4e4e8;`);
      m.shape({ x: x - 40, y: y0 + H + 4, w: 80, h: 18, value: esc(fmt(v, spec, null)), style: S.text(C.grey, SMALL, "center"), role: "deco" });
    }
    cats.forEach((c, ci) => {
      const lines = wrap(c, labelW - 14, SMALL);
      m.shape({ x: 20, y: y0 + ci * rowH, w: labelW - 10, h: rowH, value: lines.map(esc).join("<br>"), style: S.text(C.ink, SMALL, "right"), role: "text" });
      const bh = stacked ? rowH - 10 : (rowH - 10) / series.length;
      for (const [, si, from, to] of segs.filter((g) => g[0] === ci)) {
        const s = series[si], xa = x0 + (from / top) * W, w = Math.max(1, ((to - from) / top) * W), y = y0 + ci * rowH + 5 + (stacked ? 0 : si * bh);
        m.shape({ x: xa, y, w, h: bh - 2, style: `rounded=0;fillColor=${color(s, si)};strokeColor=${stacked ? "#ffffff" : "none"};`, role: "deco" });
        if (stacked) { if (w > textWidth(fmt(to - from, spec), SMALL) + 8) m.shape({ x: xa, y, w, h: bh - 2, value: esc(fmt(to - from, spec)), style: S.text(ink(color(s, si)), SMALL, "center"), role: "deco" }); }
        else m.shape({ x: x0 + w + 4, y, w: 90, h: bh - 2, value: esc(fmt(to, spec)), style: S.text(C.ink, SMALL), role: "deco" });
      }
      if (stacked) { const total = series.reduce((a, s) => a + s.values[ci], 0); m.shape({ x: x0 + (total / top) * W + 4, y: y0 + ci * rowH + 5, w: 90, h: rowH - 12, value: `<b>${esc(fmt(total, spec))}</b>`, style: S.text(C.ink, SMALL), role: "deco" }); }
    });
    return m;
  }

  // The printed value of each bar, and the room its label needs: bars sit at least that far apart, so no two labels touch.
  const across = kind === "line" ? 1 : stacked || kind === "waterfall" ? 1 : series.length;
  const isTotal = (ci) => kind === "waterfall" && (ci === 0 || (ci === cats.length - 1 && Boolean(spec.total)));
  const valueText = ([ci, , from, to]) => { const v = (kind === "waterfall" && !isTotal(ci)) || stacked ? to - from : to; return `${kind === "waterfall" && !isTotal(ci) && v > 0 ? "+" : ""}${fmt(v, spec)}`; };
  // Several lines: each value carries a dot in its line's colour, so it names its line wherever it sits.
  const dot = kind === "line" && series.length > 1 ? 14 : 0;
  const need = Math.max(...(kind === "line" ? all.map((v) => fmt(v, spec)) : segs.map(valueText)).map((t) => textWidth(t, SMALL))) + 8 + dot;
  // When the tallest bar or point nearly reaches the top tick, its value needs room above the plot, clear of the legend.
  const peak = kind === "line" ? Math.max(...all) : Math.max(...ends);
  y0 += Math.max(0, 14 - ((top - peak) / (top - bottom)) * (spec.height ?? 260));
  const H = spec.height ?? 260, x0 = 20 + tickW, groupW = Math.max(56, (spec.width ?? 600) / cats.length, (need * across) / (stacked ? 0.72 : 0.9)), W = groupW * cats.length;
  const yOf = (v) => y0 + H - ((v - bottom) / (top - bottom)) * H;
  for (const v of ticks) {
    const y = yOf(v);
    line(m, [[x0, y], [x0 + W, y]], `endArrow=none;html=1;strokeColor=${v === 0 ? C.soft : "#e4e4e8"};`);
    m.shape({ x: 16, y: y - 9, w: tickW - 6, h: 18, value: esc(fmt(v, spec, null)), style: S.text(C.grey, SMALL, "right"), role: "deco" });
  }
  let floor = y0 + H + 6; // the category names go below the lowest value printed under a bar
  if (kind !== "line") {
    // A stacked bar holds its values inside, so it is as wide as the widest; side by side, each bar gets a slot as wide as its label.
    const bw = Math.min(stacked ? Math.max(44, need) : kind === "bar" ? 44 : 56, (groupW * 0.72) / across), slot = Math.max(bw, need);
    const better = spec.better === "down" ? -1 : 1;
    segs.forEach((seg, k) => {
      const [ci, si, from, to] = seg;
      const gx = x0 + ci * groupW + (groupW - slot * across) / 2, x = gx + (across > 1 ? si : 0) * slot + (slot - bw) / 2;
      const y = Math.min(yOf(from), yOf(to)), h = Math.max(Math.abs(yOf(to) - yOf(from)), 1);
      const fill = kind === "waterfall" ? (isTotal(ci) ? TONES.grey : (to - from) * better >= 0 ? TONES.green : TONES.red) : color(series[si], si);
      m.shape({ x: x + 1, y, w: bw - 2, h, style: `rounded=0;fillColor=${fill};strokeColor=${stacked ? "#ffffff" : "none"};`, role: "deco" });
      const text = esc(valueText(seg)), lx = x + bw / 2 - need / 2;
      if (stacked) { if (h > 18) m.shape({ x: lx, y, w: need, h, value: text, style: S.text(ink(fill), SMALL, "center"), role: "deco" }); }
      else {
        const under = kind === "waterfall" ? to < from : to < 0;
        m.shape({ x: lx, y: under ? y + h + 2 : y - 18, w: need, h: 16, value: text, style: S.text(C.ink, SMALL, "center"), role: "label" });
        if (under) floor = Math.max(floor, y + h + 22);
      }
      if (kind === "waterfall" && k < segs.length - 1) line(m, [[x + bw - 1, yOf(to)], [x0 + (ci + 1) * groupW + (groupW - bw) / 2 + 1, yOf(to)]], `endArrow=none;html=1;dashed=1;strokeColor=${C.soft};`);
    });
    if (stacked) cats.forEach((_, ci) => { const total = series.reduce((a, s) => a + s.values[ci], 0), x = x0 + ci * groupW; m.shape({ x, y: yOf(total) - 18, w: groupW, h: 16, value: `<b>${esc(fmt(total, spec))}</b>`, style: S.text(C.ink, SMALL, "center"), role: "deco" }); });
  } else {
    const columns = cats.map(() => []);
    series.forEach((s, si) => {
      const pts = s.values.map((v, ci) => [x0 + ci * groupW + groupW / 2, yOf(v)]);
      line(m, pts, `endArrow=none;html=1;rounded=0;strokeWidth=2.5;strokeColor=${color(s, si)};`);
      pts.forEach(([x, y], ci) => {
        m.shape({ x: x - 4, y: y - 4, w: 8, h: 8, style: `ellipse;fillColor=#ffffff;strokeColor=${color(s, si)};strokeWidth=2;`, role: "deco" });
        columns[ci].push({ x, y, text: `${dot ? `<font color="${color(s, si)}">●</font>&nbsp;` : ""}${esc(fmt(s.values[ci], spec))}` });
      });
    });
    // Top to bottom in each column, a value goes above its point, else below it while that stays above the axis, else on top of the column's values.
    for (const col of columns) {
      let below = -Infinity, above = Infinity;
      for (const p of col.sort((a, b) => a.y - b.y)) {
        const under = Math.max(p.y + 6, below + 1);
        const y = p.y - 22 > below ? p.y - 22 : under + 16 <= y0 + H - 2 ? under : above - 17;
        m.shape({ x: p.x - need / 2, y, w: need, h: 16, value: p.text, style: S.text(C.ink, SMALL, "center"), role: "label" });
        below = Math.max(below, y + 16);
        above = Math.min(above, y);
      }
    }
  }
  cats.forEach((c, ci) => {
    const lines = wrap(c, groupW - 8, SMALL);
    m.shape({ x: x0 + ci * groupW, y: floor, w: groupW, h: lines.length * 16 + 4, value: lines.map(esc).join("<br>"), style: S.text(C.ink, SMALL, "center") + "verticalAlign=top;", role: "text" });
  });
  return m;
}

/** Text colour that reads on a bar of colour `hex`: white on dark, ink on light. */
export function ink(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? "#ffffff" : C.ink;
}
