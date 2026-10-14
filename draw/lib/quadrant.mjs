import { C, FONT, SMALL, esc, shapeTone, TONES, iconImg, textWidth } from "./style.mjs";
import { Model, S } from "./model.mjs";

const SIZE = 440;

/**
 * Items placed on two axes split into four quadrants: impact against effort, risk against
 * likelihood. `x` / `y` name each axis `{title, low, high}`; `quadrants` names the four in
 * reading order (top-left, top-right, bottom-left, bottom-right); each item has `x` and `y`
 * from 0 to 1. `highlight` (an index) tints the quadrant to look at in `highlightTone` (`new`,
 * the default, for the one to pick; `warn` or `bad` for the one to act on); its title, in the
 * same colour, names it, so it takes no legend entry. Overlapping items and items on a dividing line are reported, so nudge them.
 */
export default async function quadrant(spec) {
  const items = spec.items ?? [], q = spec.quadrants ?? [];
  if (!items.length) throw new Error("a quadrant needs items");
  for (const it of items) if (!(it.x >= 0 && it.x <= 1 && it.y >= 0 && it.y <= 1)) throw new Error(`item "${it.title}": x and y go from 0 to 1`);
  const m = new Model(spec.title ?? "quadrant");
  const ax = spec.x ?? {}, ay = spec.y ?? {};
  const x0 = 20 + 34, y0 = 20, half = SIZE / 2;
  const tint = spec.highlight ?? null, lit = TONES[spec.highlightTone ?? "new"];
  if (!lit) throw new Error(`highlightTone "${spec.highlightTone}" (${Object.keys(TONES).join(", ")})`);
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([cx, cy], k) => {
    const on = tint === k;
    m.shape({ x: x0 + cx * half, y: y0 + cy * half, w: half, h: half, role: "deco",
      style: `rounded=0;fillColor=${on ? lit.fill : k % 3 ? "#fafafb" : C.group};strokeColor=${on ? lit.line : C.groupLine};` });
    if (q[k]) m.shape({ x: x0 + cx * half + 10, y: y0 + cy * half + (cy ? half - 28 : 8), w: half - 20, h: 20, role: "deco",
      value: `<b>${esc(q[k])}</b>`, style: S.text(on ? lit.text : C.soft, SMALL, cx ? "right" : "left") });
  });
  const axis = (pts) => m.edges.push({ id: m.id("e"), source: null, target: null, points: pts, style: S.edge("grey"), label: "", role: "deco" });
  axis([[x0, y0 + SIZE], [x0 + SIZE + 12, y0 + SIZE]]);
  axis([[x0, y0 + SIZE], [x0, y0 - 12]]);
  const lab = (x, y, w, v, align, extra = "") => m.shape({ x, y, w, h: 18, value: esc(v ?? ""), style: S.text(C.grey, SMALL, align) + extra, role: "deco" });
  lab(x0, y0 + SIZE + 4, 120, ax.low, "left"); lab(x0 + SIZE - 120, y0 + SIZE + 4, 120, ax.high, "right");
  lab(x0 + half - 120, y0 + SIZE + 4, 240, ax.title, "center", "fontStyle=1;");
  lab(x0 - 34 - 70 + 9, y0 + SIZE - 60 - 9, 140, ay.low, "center", "rotation=-90;");
  lab(x0 - 34 - 70 + 9, y0 + 60 - 9, 140, ay.high, "center", "rotation=-90;");
  lab(x0 - 34 - 120 + 9, y0 + half - 9, 240, ay.title, "center", "rotation=-90;fontStyle=1;");
  for (const it of items) {
    const { tone } = shapeTone(it), t = TONES[tone];
    if (tone !== "neutral") m.tones.add(tone);
    const w = textWidth(it.title, 13, { bold: true }) + (it.icon ? 22 : 0) + 24, h = 30;
    if (w > SIZE / 2 - 16) throw new Error(`item "${it.title}": too long for the plot; keep it to a few words`);
    const cx = x0 + it.x * SIZE, cy = y0 + (1 - it.y) * SIZE;
    const x = Math.min(x0 + SIZE - w - 4, Math.max(x0 + 4, cx - w / 2)), y = Math.min(y0 + SIZE - h - 4, Math.max(y0 + 4, cy - h / 2));
    if ((x < x0 + half && x + w > x0 + half) || (y < y0 + half && y + h > y0 + half))
      m.facts.push(`item "${it.title}" sits on the line between two quadrants: move its x or y away from 0.5`);
    const icon = it.icon ? `${iconImg(it.icon, tone === "neutral" ? C.ink : t.line, 15)}&nbsp;` : "";
    m.shape({ x, y, w, h, value: `${icon}<b>${esc(it.title)}</b>`,
      style: `rounded=1;arcSize=40;html=1;fontSize=13;fontColor=${C.ink};fillColor=${t.fill};strokeColor=${t.line};${t.dashed ? "dashed=1;" : ""}` });
  }
  return m;
}
