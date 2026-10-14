import { C, FONT, SMALL, TONES, esc, shapeTone, textWidth, wrap } from "./style.mjs";
import { Model, S } from "./model.mjs";

const ROW = 58, BAR = 38, AXIS = 34;

/**
 * Work over time: one row per lane, bars from `start` to `end` in the spec's unit, diamonds for
 * milestones with a dashed line down the chart. Units are numbers (day 0 is the left edge), or
 * ISO dates: then `end` is the last day the task runs, and the axis shows dates.
 */
export default async function timeline(spec) {
  const lanes = spec.lanes ?? [];
  const { tasks, miles, dateAt } = byDate(spec);
  if (!lanes.length) throw new Error("a timeline needs lanes");
  const laneIndex = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
  for (const t of tasks) {
    if (!(t.lane in laneIndex)) throw new Error(`task "${t.title}": unknown lane "${t.lane}"`);
    if (!(t.end > t.start)) throw new Error(`task "${t.title}": end must be after start`);
  }
  const span = Math.ceil(Math.max(spec.length ?? 0, ...tasks.map((t) => t.end), ...miles.map((m) => m.at), 1));
  const labelW = Math.max(...lanes.map((l) => textWidth(l.title, FONT, { bold: true }))) + 30;
  const unit = Math.max(36, Math.min(120, Math.floor(((spec.width ?? 1000) - labelW) / span)));
  const x0 = 20 + labelW, top = 20 + AXIS + (miles.length ? 26 : 0);
  const height = lanes.length * ROW;
  const m = new Model(spec.title ?? "timeline");
  const unitName = spec.unit ?? "Day";
  if (!dateAt && spec.unit === undefined) m.defaults.add('"Day" (unit)');

  // Axis: a tick label per unit, grid lines behind the bars.
  const every = Math.ceil(span / Math.floor((span * unit) / 70));
  for (let u = 0; u <= span; u++) {
    const x = x0 + u * unit;
    m.edges.push({ id: m.id("e"), source: null, target: null, points: [[x, top], [x, top + height]], style: `endArrow=none;html=1;strokeColor=#e4e4e8;`, label: "", role: "deco" });
    if (u < span && u % every === 0) m.shape({ x, y: 20, w: unit * every, h: 20, value: dateAt ? esc(dateAt(u)) : `${esc(unitName)} ${u + (spec.startAt ?? 1)}`, style: S.text(C.grey, SMALL, "center"), role: "deco" });
  }
  lanes.forEach((l, i) => {
    const y = top + i * ROW;
    // A thin rule between lanes; grid lines stay visible in every lane.
    m.edges.push({ id: m.id("e"), source: null, target: null, points: [[20, y + ROW], [x0 + span * unit, y + ROW]], style: `endArrow=none;html=1;strokeColor=${C.groupLine};`, label: "", role: "deco" });
    m.shape({ x: 28, y, w: labelW - 12, h: ROW, value: `<b>${esc(l.title)}</b>`, style: S.text(C.ink, FONT), role: "deco" });
  });
  for (const t of tasks) {
    const x = x0 + t.start * unit, w = (t.end - t.start) * unit - 4, y = top + laneIndex[t.lane] * ROW + (ROW - BAR) / 2;
    const { tone } = shapeTone(t), tt = TONES[tone];
    if (tone !== "neutral") m.tones.add(tone);
    const inBar = wrap(t.title, w - 12, SMALL, { bold: true });
    const fits = inBar.length <= 2 && inBar.every((l) => textWidth(l, SMALL, { bold: true }) <= w - 12);
    const fill = `fillColor=${tt.fill};strokeColor=${tt.line};${tt.dashed ? "dashed=1;" : ""}`;
    // A name too long for its bar is cut with an ellipsis, never moved where a later bar would hide it.
    const cut = fits ? inBar : [clip(t.title, w - 12)];
    m.shape({ x: x + 2, y, w, h: BAR, value: `<b>${cut.map(esc).join("<br>")}</b>`, style: `rounded=1;arcSize=20;html=1;whiteSpace=wrap;fontSize=${SMALL};fontColor=${tone === "neutral" ? C.ink : tt.text};${fill}` });
    if (!fits) m.facts.push(`task "${t.title}" does not fit its bar and is cut short: shorten it`);
  }
  for (const ms of miles) {
    const x = x0 + ms.at * unit;
    m.edges.push({ id: m.id("e"), source: null, target: null, points: [[x, top - 14], [x, top + height]], style: `endArrow=none;html=1;dashed=1;strokeWidth=1.5;strokeColor=${C.ink};`, label: "", role: "deco" });
    m.shape({ x: x - 8, y: top - 30, w: 16, h: 16, style: `rhombus;fillColor=${C.ink};strokeColor=${C.ink};`, role: "deco" });
    m.shape({ x: x + 12, y: top - 32, w: textWidth(ms.title, SMALL, { bold: true }) + 10, h: 20, value: `<b>${esc(ms.title)}</b>`, style: S.text(C.ink, SMALL), role: "text" });
  }
  return m;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

/**
 * Tasks and milestones in units from 0. Dates become offsets from `spec.from` (or the earliest
 * date) in days, or weeks when `unit` is "Week"; a task's end date is inclusive.
 */
function byDate(spec) {
  const tasks = spec.tasks ?? [], miles = spec.milestones ?? [];
  const values = [...tasks.flatMap((t) => [t.start, t.end]), ...miles.map((ms) => ms.at)];
  if (!values.some((v) => typeof v === "string")) return { tasks, miles };
  const real = (v) => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const bad = values.find((v) => !real(v));
  if (bad !== undefined) throw new Error(`timeline: "${bad}" is not a date like 2026-10-13; use dates everywhere or numbers everywhere`);
  if (spec.from !== undefined && !real(spec.from)) throw new Error(`timeline: "from" must be a date like 2026-10-13`);
  const origin = Date.parse(spec.from ?? values.sort()[0]), step = spec.unit === "Week" ? 7 : 1;
  const off = (d) => (Date.parse(d) - origin) / DAY / step;
  const early = values.find((v) => off(v) < 0);
  if (early) throw new Error(`timeline: ${early} is before "from" ${spec.from}`);
  let fmt;
  try { fmt = new Intl.DateTimeFormat(spec.locale ?? "en", { day: "numeric", month: "short", timeZone: "UTC" }); } catch { throw new Error(`timeline: "locale" ${JSON.stringify(spec.locale)} is not a language tag like "vi" or "en-GB"`); }
  return {
    tasks: tasks.map((t) => ({ ...t, start: off(t.start), end: off(t.end) + 1 / step })),
    miles: miles.map((ms) => ({ ...ms, at: off(ms.at) })),
    dateAt: (u) => fmt.format(new Date(origin + u * step * DAY)),
  };
}

/** The longest start of `s` that fits `max` px in bold small text, with an ellipsis. */
function clip(s, max) {
  let out = s;
  while (out && textWidth(`${out}…`, SMALL, { bold: true }) > max) out = out.slice(0, -1);
  return out ? `${out.trimEnd()}…` : "";
}
