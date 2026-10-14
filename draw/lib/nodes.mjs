import { C, FONT, MONO, SMALL, TONES, accentOf, esc, iconImg, shapeTone, textWidth, wrap } from "./style.mjs";
import { S } from "./model.mjs";

const PAD = 14, TITLE_LH = 18, DESC_LH = 16, CHIP_H = 24, CHIP_GAP = 6, MAX_TEXT = 190;
const SECTION = { blue: TONES.new.text, new: TONES.new.text, orange: TONES.warn.text, warn: TONES.warn.text, red: TONES.bad.text, bad: TONES.bad.text,
  green: TONES.ok.text, ok: TONES.ok.text, external: TONES.external.text, grey: C.grey };

/** Box text is measured in Inter, so it is drawn in Inter: backticks are dropped, the rest escaped. */
const plain = (s) => String(s).replace(/`/g, "");
const rich = (s) => esc(plain(s));
const chipW = (t) => textWidth(t, SMALL, { mono: true }) + 20;

/** An agent's box shows a robot beside its own icon, so a reader tells agents from services. */
const icons = (n) => [...(n.agent && n.icon !== "bot" ? ["bot"] : []), ...(n.icon ? [n.icon] : [])];

function lines(n) {
  const iconW = icons(n).length * 22;
  const title = wrap(plain(n.title ?? ""), MAX_TEXT - iconW, FONT, { bold: true });
  const desc = n.desc ? wrap(plain(n.desc), MAX_TEXT, SMALL) : [];
  const widest = Math.max(...title.map((l, i) => textWidth(l, FONT, { bold: true }) + (i ? 0 : iconW)), ...desc.map((l) => textWidth(l, SMALL)), 0);
  return { title, desc, widest };
}

/** Rows of chips that fit in `inner` px: [[{text, w}]]. */
function chipRows(chips, inner) {
  const rows = [[]];
  let x = 0;
  for (const text of chips) {
    const w = chipW(text);
    if (x && x + w > inner) rows.push([]), (x = 0);
    rows.at(-1).push({ text, w });
    x += w + CHIP_GAP;
  }
  return rows;
}

/** The width and height a node needs for its text, icon, chip sections or table fields. */
export function measure(n) {
  const kind = shapeTone(n).shape;
  if (kind === "start") return { w: 22, h: 22 };
  if (kind === "end") return { w: 26, h: 26 };
  if (kind === "table") {
    const cols = (n.fields ?? []).map((f) => [f.name, f.type ?? "", f.key ?? ""]);
    const cw = [0, 1, 2].map((i) => Math.max(0, ...cols.map((c) => textWidth(c[i], SMALL, { mono: true }))));
    const w = Math.max(textWidth(n.title, FONT, { bold: true }) + (n.icon ? 22 : 0) + 2 * PAD, cw[0] + cw[1] + cw[2] + 48);
    return { w: Math.ceil(w), h: 32 + cols.length * 22 + 6, cw };
  }
  const { title, desc, widest } = lines(n);
  let w = widest + 2 * PAD, h = 2 * PAD - 4 + title.length * TITLE_LH + desc.length * DESC_LH;
  if (n.sections?.length) {
    const natural = Math.max(...n.sections.flatMap((s) => [textWidth(s.label ?? "", SMALL, { bold: true }), (s.chips ?? []).reduce((a, c) => a + chipW(c) + CHIP_GAP, 0)]));
    w = Math.max(w, Math.min(natural + 2 * PAD, 360));
    for (const s of n.sections) h += (s.label ? 22 : 4) + chipRows(s.chips ?? [], w - 2 * PAD).length * (CHIP_H + CHIP_GAP);
    h += 4;
  }
  if (kind === "decision") return { w: Math.ceil(w * 1.6), h: Math.ceil(h * 1.6) };
  if (kind === "cloud") return { w: Math.ceil(Math.max(w, 120) * 1.35), h: Math.ceil(Math.max(h, 44) * 1.5) };
  if (kind === "circle") return { w: Math.ceil(w + 28), h: Math.ceil(Math.max(h, 44) + 16) };
  if (kind === "hexagon") w += 28;
  if (kind === "queue") w += 20;
  if (kind === "doc") h += 12;
  if (kind === "db") h += n.sections?.length ? 28 : 16;
  return { w: Math.ceil(Math.max(w, n.minWidth ?? 120)), h: Math.ceil(Math.max(h, n.minHeight ?? 44)) };
}

/** A title in Inter SemiBold, measured as bold so it always fits. */
export const strong = (s) => `<span style="font-weight:600">${s}</span>`;

function label(n, color, tone, accent) {
  const { title, desc } = lines(n);
  const icon = icons(n).map((name) => `${iconImg(name, tone !== "neutral" ? TONES[tone].line : accent ? accent.line : C.ink)}&nbsp;`).join("");
  const t = title.map((l, i) => (i ? "" : icon) + strong(rich(l))).join("<br>");
  return desc.length ? `${t}<br><font style="font-size:${SMALL}px" color="${color}">${desc.map(rich).join("<br>")}</font>` : t;
}

/** Draws node n at x,y with size w,h (from measure, possibly stretched by the layout). */
export function drawNode(m, n, { x, y, w, h }, parent = null) {
  const { shape: kind, tone } = shapeTone(n);
  const accent = accentOf(n);
  if (tone !== "neutral") m.tones.add(tone);
  if (accent && tone !== "neutral") m.facts.push(`"${n.title ?? n.id}" has both a tone and an accent: the tone's colour is drawn; drop one`);
  if (kind === "start" || kind === "end") return m.shape({ id: n.id, parent, x, y, w, h, style: S.node(kind) });
  if (kind === "table") return drawTable(m, n, tone, { x, y, w, h }, parent);
  const descColor = tone === "neutral" && accent ? accent.text : TONES[tone].text;
  const hasSections = Boolean(n.sections?.length);
  const style = S.node(kind, tone, accent) + (hasSections ? `verticalAlign=top;align=left;spacingLeft=${PAD - 2};spacingTop=${PAD - 6 + (kind === "db" ? 12 : 0)};boundedLbl=0;container=1;collapsible=0;` : "");
  const shape = m.shape({ id: n.id, parent, x, y, w, h, value: label(n, descColor, tone, accent), style });
  if (!hasSections) return shape;
  const { title, desc } = lines(n);
  let cy = y + (kind === "db" ? 12 : 0) + PAD - 4 + title.length * TITLE_LH + desc.length * DESC_LH + 4;
  for (const s of n.sections) {
    if (s.label) {
      m.shape({ parent: shape.id, x: x + PAD - 4, y: cy, w: w - 2 * PAD, h: 18, value: s.tone && s.tone !== "grey" ? strong(rich(s.label)) : rich(s.label), style: S.text(SECTION[s.tone] ?? C.grey), role: "text" });
      cy += 22;
    } else cy += 4;
    for (const row of chipRows(s.chips ?? [], w - 2 * PAD)) {
      let cx = x + PAD;
      for (const c of row) {
        m.shape({ parent: shape.id, x: cx, y: cy, w: c.w, h: CHIP_H, value: esc(c.text), style: S.chip, role: "chip" });
        cx += c.w + CHIP_GAP;
      }
      cy += CHIP_H + CHIP_GAP;
    }
  }
  return shape;
}

function drawTable(m, n, tone, { x, y, w, h }, parent) {
  const { cw } = measure(n);
  const t = TONES[tone];
  const icon = n.icon ? `${iconImg(n.icon, tone === "neutral" ? C.ink : t.line)}&nbsp;` : "";
  const fill = `fillColor=${tone === "neutral" ? "#f4f4f6" : t.fill};strokeColor=${t.line};${t.dashed ? "dashed=1;" : ""}`;
  const shape = m.shape({ id: n.id, parent, x, y, w, h, value: `${icon}${strong(rich(n.title))}`,
    style: `swimlane;startSize=30;html=1;rounded=1;arcSize=6;container=1;collapsible=0;shadow=1;fontSize=14;fontColor=${C.ink};swimlaneFillColor=#ffffff;${fill}` });
  (n.fields ?? []).forEach((f, i) => {
    const ry = y + 34 + i * 22;
    if (f.new) m.tones.add("new");
    const cols = [[f.name, C.ink, cw[0]], [f.type ?? "", C.grey, cw[1]], [f.key ?? "", TONES.warn.text, cw[2]]];
    let cx = x + 12;
    for (const [text, color, width] of cols) {
      if (text) m.shape({ parent: shape.id, x: cx, y: ry, w: width + 8, h: 20, value: f.new && color === C.ink ? `<b>${esc(text)}</b>` : esc(text),
        style: MONO + S.text(f.new && color === C.ink ? TONES.new.text : color), role: "text" });
      cx += width + 12;
    }
  });
  return shape;
}

/** Group header: icon and title, a light subtitle beside it, an orange rule line under it. */
export function groupHeader(g) {
  if (!g.title && !g.icon && !g.sub && !g.note) return { value: "", height: 16, width: 48 };
  const accent = accentOf(g);
  const icon = g.icon ? `${iconImg(g.icon, accent ? accent.line : C.ink)}&nbsp;` : "";
  let v = `${icon}<span style="font-size:15px;font-weight:600">${rich(g.title ?? "")}</span>`;
  if (g.sub) v += `&nbsp;&nbsp;<font style="font-size:${SMALL}px" color="${C.soft}">${rich(g.sub)}</font>`;
  if (g.note) v += `<br><b><font style="font-size:${SMALL}px" color="${C.orange}">${rich(g.note)}</font></b>`;
  const width = textWidth(plain(g.title ?? ""), 15, { bold: true }) + (g.icon ? 22 : 0) + (g.sub ? textWidth(plain(g.sub), SMALL) + 12 : 0);
  return { value: v, height: g.note ? 58 : 40, width: Math.max(width, g.note ? textWidth(plain(g.note), SMALL, { bold: true }) : 0) + 48 };
}
