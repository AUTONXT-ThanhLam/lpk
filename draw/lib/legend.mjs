import { ACCENTS, C, SMALL, TONES, esc, textWidth } from "./style.mjs";
import { S } from "./model.mjs";

const EDGE_MEANING = { main: "main", blue: "main", new: "new", orange: "warn", warn: "warn", red: "bad", bad: "bad", green: "ok", ok: "ok", external: "external", muted: "muted" };

/** Records the meaning an arrow's colour carries, for the legend. */
export function noteEdgeTone(m, tone) {
  const t = EDGE_MEANING[tone];
  if (t) m.lineTones.add(t);
}

/**
 * The picture's message in a band across its top: the title in ink, `sub` beside it in light
 * grey. Every type gets the same band, so pictures on one page read as one set.
 */
export function caption(m, spec) {
  if (!spec.title || !m.shapes.length) return;
  const b = m.bounds();
  const size = 22, w = Math.max(b.w + 40, textWidth(`${spec.title}  ${spec.sub ?? ""}`, size, { bold: true }) + 56);
  const sub = spec.sub ? ` <span style="color:#b4b4ba">${esc(spec.sub)}</span>` : "";
  m.shape({ x: b.x - 20, y: b.y - 92, w, h: 60, role: "deco", value: `<b>${esc(spec.title)}</b>${sub}`,
    style: `rounded=0;html=1;align=left;verticalAlign=middle;spacingLeft=24;fontSize=${size};fontColor=${C.ink};fillColor=#fcfcfc;strokeColor=none;shadow=1;` });
}

/**
 * A card at the picture's left naming what each accent stands for, when the accents mean
 * something here ("Sensor", "Actuator"): `key: [{label, accent}]`, titled by `keyTitle`.
 */
export function key(m, spec) {
  const rows = spec.key ?? [];
  if (!rows.length || !m.shapes.length || m.keyDone) return;
  for (const r of rows) if (!ACCENTS[r.accent] && !TONES[r.accent]) throw new Error(`key "${r.label}": unknown accent "${r.accent}" (${Object.keys(ACCENTS).join(", ")})`);
  const b = m.bounds();
  const title = spec.keyTitle ?? "Key";
  if (spec.keyTitle === undefined) m.defaults.add('"Key" (keyTitle)');
  const w = Math.max(textWidth(title, 15, { bold: true }), ...rows.map((r) => textWidth(r.label, 13) + 44)) + 40, h = 52 + rows.length * 28 + 6;
  const x = b.x - w - 40, y = b.y;
  m.shape({ x, y, w, h, value: `<b>${esc(title)}</b>`, role: "deco",
    style: `rounded=0;html=1;align=left;verticalAlign=top;spacingLeft=18;spacingTop=12;fontSize=15;fontColor=${C.ink};fillColor=#ffffff;strokeColor=#ececf0;shadow=1;` });
  rows.forEach((r, i) => {
    const a = ACCENTS[r.accent] ?? { fill: TONES[r.accent].fill, line: TONES[r.accent].line };
    m.shape({ x: x + 18, y: y + 50 + i * 28, w: 28, h: 16, role: "deco", style: `rounded=1;arcSize=50;html=1;fillColor=${a.top ?? a.fill};strokeColor=${a.line};` });
    m.shape({ x: x + 56, y: y + 46 + i * 28, w: w - 64, h: 24, value: esc(r.label), role: "deco", style: S.text(C.ink, 13) });
  });
}

/**
 * A one-line key under the picture for every colour it uses, so a reader never guesses what blue
 * or orange means. `spec.legend` renames entries (`{"new": "added by KD-12"}`) or, false, hides it.
 */
export function legend(m, spec) {
  const used = new Set([...m.tones, ...m.lineTones]);
  if (spec.legend === false || !used.size || !m.shapes.length) return;
  const names = { main: "main path", ...Object.fromEntries(Object.entries(TONES).map(([k, t]) => [k, t.legend])), ...(spec.legend ?? {}) };
  const order = ["main", "new", "warn", "bad", "ok", "external", "muted"].filter((t) => used.has(t));
  const b = m.bounds();
  let x = b.x, y = b.y + b.h + 24;
  for (const t of order) {
    if (spec.legend?.[t] === undefined) m.defaults.add(`"${names[t]}" (legend.${t})`);
    if (!m.tones.has(t)) m.edge({ points: [[x, y + 9], [x + 26, y + 9]], style: S.edge(t, { dashed: TONES[t]?.dashed }), role: "deco" });
    else m.shape({ x, y: y + 1, w: 26, h: 16, style: `rounded=1;arcSize=50;html=1;fillColor=${TONES[t].fill};strokeColor=${TONES[t].line};${TONES[t].dashed ? "dashed=1;" : ""}`, role: "deco" });
    const w = textWidth(names[t], SMALL) + 12;
    m.shape({ x: x + 32, y, w, h: 18, value: esc(names[t]), style: S.text(C.grey, SMALL), role: "deco" });
    x += 32 + w + 18;
  }
}
