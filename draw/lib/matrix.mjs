import { C, FONT, SMALL, TONES, accentOf, esc, iconImg, textWidth } from "./style.mjs";
import { Model, S } from "./model.mjs";

const ROW = 36, HEAD = 44, STRIPE = 5, MARK = { true: ["check", TONES.ok.line], false: ["x", TONES.bad.line] };

/**
 * A table the eye reads by colour: an option comparison (`true` draws a green check, `false` a
 * red cross, `null` a dash), a RACI or any grid of short words. A column or row with a `tone`
 * is tinted (the recommended option); a cell `{text, tone}` colours one cell. `heat: true`
 * shades number cells from white to blue by value, one hue, so darker always means more.
 */
export default async function matrix(spec) {
  const cols = (spec.columns ?? []).map((c) => (typeof c === "string" ? { title: c } : c));
  const rows = (spec.rows ?? []).map((r) => (typeof r === "string" ? { title: r } : r));
  const cells = spec.cells ?? [];
  if (!cols.length || !rows.length) throw new Error("a matrix needs columns and rows");
  if (cells.length !== rows.length || cells.some((r) => r.length !== cols.length)) throw new Error(`cells must be ${rows.length} rows of ${cols.length} values`);
  for (const x of [...cols, ...rows]) if (x.tone && !TONES[x.tone]) throw new Error(`"${x.title}": unknown tone "${x.tone}"`);
  for (const x of [...cols, ...rows]) accentOf(x);
  const cell = (v) => (v !== null && typeof v === "object" ? v : { text: v });
  const text = (v) => (v === true || v === false || v === null || v === undefined ? "" : String(v));
  const nums = cells.flat().map((v) => cell(v).text).filter((v) => typeof v === "number");
  const [lo, hi] = [Math.min(...nums), Math.max(...nums)];

  const rowW = Math.max(...rows.map((r) => textWidth(r.title, FONT, { bold: true }) + (r.icon ? 22 : 0))) + 28;
  const colW = cols.map((c, j) => Math.max(72, textWidth(c.title, FONT, { bold: true }) + (c.icon ? 22 : 0) + 24,
    ...cells.map((r) => textWidth(text(cell(r[j]).text) + (spec.unit ? ` ${spec.unit}` : ""), SMALL) + 24)));
  const x0 = 20 + rowW, y0 = 20;
  const colX = colW.map((_, j) => x0 + colW.slice(0, j).reduce((a, b) => a + b, 0));
  const W = rowW + colW.reduce((a, b) => a + b, 0);
  const m = new Model(spec.title ?? "matrix");
  const tone = (t) => { if (t && t !== "neutral") m.tones.add(t); return t && t !== "neutral" ? TONES[t] : null; };
  const icon = (name, t) => (name ? `${iconImg(name, t ? t.line : C.ink)}&nbsp;` : "");

  // Column heads as in a slide: an accent or toned column gets a coloured head and a stripe under it
  // and at its foot; a plain one a hairline under its head.
  const H = HEAD + rows.length * ROW;
  m.shape({ x: 20, y: y0, w: rowW - 6, h: HEAD, style: `rounded=0;fillColor=${C.group};strokeColor=none;`, role: "deco" });
  cols.forEach((c, j) => {
    const t = tone(c.tone), a = t ? null : accentOf(c);
    const fill = t ? `fillColor=${t.fill};` : a ? `fillColor=${a.head[0]};gradientColor=${a.head[1]};gradientDirection=east;` : `fillColor=${C.group};`;
    m.shape({ x: colX[j] + 3, y: y0, w: colW[j] - 6, h: t || a ? HEAD - STRIPE : HEAD - 2, value: `${icon(c.icon, t ?? a)}<span style="font-weight:600">${esc(c.title)}</span>`, role: "deco",
      style: `rounded=0;html=1;fontSize=${FONT + 1};fontColor=${t ? t.text : C.ink};${fill}strokeColor=none;` });
    if (!t && !a) m.shape({ x: colX[j] + 3, y: y0 + HEAD - 2, w: colW[j] - 6, h: 2, style: `rounded=0;fillColor=${C.cardLine};strokeColor=none;`, role: "deco" });
    else for (const y of [y0 + HEAD - STRIPE, y0 + H]) m.shape({ x: colX[j] + 3, y, w: colW[j] - 6, h: STRIPE, style: `rounded=0;fillColor=${t ? t.line : a.head[0]};strokeColor=none;opacity=${a ? 80 : 100};`, role: "deco" });
  });
  rows.forEach((r, i) => {
    const y = y0 + HEAD + i * ROW, rt = tone(r.tone);
    m.shape({ x: 20, y, w: rowW - 6, h: ROW, value: `${icon(r.icon, rt)}<span style="font-weight:600">${esc(r.title)}</span>`, role: "deco",
      style: `rounded=0;html=1;align=left;spacingLeft=12;fontSize=${FONT};fontColor=${rt ? rt.text : C.ink};fillColor=${rt ? rt.fill : C.group};strokeColor=#ffffff;` });
    cols.forEach((c, j) => {
      const v = cell(cells[i][j]), t = tone(v.tone) ?? rt ?? tone(c.tone);
      let fill = t ? t.fill : i % 2 ? "#fafafb" : "#ffffff", color = t ? t.text : C.ink, value;
      if (v.text in MARK && typeof v.text === "boolean") value = iconImg(...MARK[v.text], 18);
      else if (v.text === null || v.text === undefined) { value = "—"; color = C.soft; }
      else value = esc(text(v.text) + (spec.unit && typeof v.text === "number" ? ` ${spec.unit}` : ""));
      if (spec.heat && typeof v.text === "number" && !v.tone) {
        const k = hi > lo ? (v.text - lo) / (hi - lo) : 1;
        fill = mix("#ffffff", C.blue, 0.08 + 0.82 * k);
        color = k > 0.55 ? "#ffffff" : C.ink;
      }
      m.shape({ x: colX[j] + 3, y, w: colW[j] - 6, h: ROW, value, role: "deco",
        style: `rounded=0;html=1;fontSize=${SMALL};fontColor=${color};fillColor=${fill};strokeColor=#eeeef1;` });
    });
  });
  return m;
}

/** The colour a share `k` of the way from hex a to hex b. */
function mix(a, b, k) {
  const ch = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k).toString(16).padStart(2, "0")).join("")}`;
}
