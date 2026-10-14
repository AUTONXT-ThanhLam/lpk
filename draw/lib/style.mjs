import { readFileSync } from "node:fs";
import { join } from "node:path";

const vendor = (f) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "vendor", f), "utf8"));

/**
 * The signature palette: a soft grey canvas, white cards with hairline lines, ink text, blue for
 * the main path, lavender, sage, sand and coral as accents.
 */
export const C = {
  ink: "#1d1d1f", grey: "#6b6b72", line: "#3a3a40", soft: "#a3a3ab",
  canvas: "#f7f7f8", card: "#ffffff", cardLine: "#cfcfd6",
  blue: "#3d82f6", blueFill: "#edf4ff", orange: "#c4562c", orangeFill: "#fdf1ea", orangeLine: "#e07a4f",
  group: "#efeff2", groupLine: "#e2e2e7", chip: "#ffffff", chipLine: "#d5d5dc", note: "#fffaeb", noteLine: "#e9cf7a",
  glow: "#9cc2ff",
};
export const FONT = 14, SMALL = 12;
/** Inter, loaded by draw.io from Google Fonts wherever the file is opened; code names in a mono face. */
export const SANS = "fontFamily=Inter,Helvetica,Arial,sans-serif;fontSource=https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DInter%3Awght%40400%3B600%3B700;";
export const MONO = "fontFamily=JetBrains Mono,Menlo,Consolas,DejaVu Sans Mono,Courier New,monospace;fontSource=https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DJetBrains%2BMono;";

/**
 * What each colour means. `line` strokes boxes and arrows, `fill` fills boxes, `text` colours a
 * box's second line, `group` tints a group, `legend` is what the legend says unless the spec renames it.
 */
export const TONES = {
  neutral: { line: C.cardLine, fill: C.card, text: C.grey, group: [C.group, C.groupLine] },
  new: { line: "#3d82f6", fill: "#edf4ff", text: "#1f5fc4", group: ["#eaf2fe", "#c3d8fb"], legend: "new in this change" },
  warn: { line: "#e07a4f", fill: "#fdf1ea", text: "#b44d22", group: ["#fcf2ec", "#f3cdb9"], legend: "needs care" },
  bad: { line: "#d64545", fill: "#fdeeed", text: "#ad2a2a", group: ["#fcf1f0", "#f0c3c0"], legend: "removed or failing" },
  ok: { line: "#4f8f6c", fill: "#edf5f0", text: "#2c6a49", group: ["#eef5f1", "#bfd9ca"], legend: "works today" },
  external: { line: "#a8875f", fill: "#f7f1ea", text: "#76562f", group: ["#f6f1eb", "#dfcdb6"], dashed: true, legend: "outside our system" },
  muted: { line: "#c4c4cb", fill: "#ffffff", text: "#9a9aa0", group: ["#f6f6f8", "#dcdce1"], dashed: true, legend: "out of scope" },
};
/** Arrow colours by name or by meaning; `main` is the one path the reader should follow. */
export const EDGE = { grey: C.line, neutral: C.line, blue: C.blue, main: C.blue, orange: "#d0623a", warn: "#d0623a", red: "#d64545", bad: "#d64545",
  green: "#4f8f6c", ok: "#4f8f6c", external: "#a8875f", muted: "#b4b4bb", new: C.blue };

/**
 * Decorative colours. An accent tints a part so the eye groups like with like; it means nothing
 * by itself and never enters the legend (a `key` names accents when they do mean something).
 * `head` is the gradient of a header, `top`/`s1`/`s2` the three faces of an isometric block.
 */
export const ACCENTS = {
  blue: { line: "#3d82f6", fill: "#edf4ff", text: "#1f4fa3", head: ["#5b9cf8", "#a9cbff"], top: "#eaf2ff", s1: "#d3e3ff", s2: "#bcd4fd" },
  lavender: { line: "#7d6ff0", fill: "#f1effe", text: "#3b2f9a", head: ["#b4a6ff", "#e6e1fd"], top: "#efecff", s1: "#dcd6fd", s2: "#cbc3fa" },
  sage: { line: "#5f8f76", fill: "#edf4f0", text: "#2c5640", head: ["#8aa89a", "#dde7e2"], top: "#ecf3ef", s1: "#d6e5dc", s2: "#c3d8cb" },
  sand: { line: "#a8875f", fill: "#f7f2ec", text: "#6a4c28", head: ["#d6c3ae", "#f4ece4"], top: "#f7f1ea", s1: "#ebdfd0", s2: "#dfcdb6" },
  coral: { line: "#e07a4f", fill: "#fdf1ea", text: "#8a3a17", head: ["#ee9068", "#f9d3c0"], top: "#fdeee6", s1: "#f8d7c6", s2: "#f2c3aa" },
  slate: { line: "#5f6b7a", fill: "#eff1f4", text: "#2f3946", head: ["#8994a3", "#dfe3e9"], top: "#eef0f3", s1: "#dde1e7", s2: "#c9cfd8" },
};
/** The accent of a part, or null; an unknown name is refused with the list. */
export function accentOf(x) {
  if (!x?.accent) return null;
  const a = ACCENTS[x.accent];
  if (!a) throw new Error(`"${x.id ?? x.title}": unknown accent "${x.accent}" (${Object.keys(ACCENTS).join(", ")})`);
  return a;
}
const LEGACY = { new: "new", warn: "warn", muted: "muted", bad: "bad", ok: "ok", external: "external" };

/** A node's shape and tone: `kind` names the shape, `tone` the meaning; the old kinds new / warn / muted still work. */
export function shapeTone(n) {
  const kind = n.kind ?? "box";
  if (LEGACY[kind]) return { shape: "box", tone: LEGACY[kind] };
  const tone = n.tone ?? "neutral";
  if (!TONES[tone]) throw new Error(`"${n.id ?? n.title}": unknown tone "${tone}" (${Object.keys(TONES).join(", ")})`);
  return { shape: kind, tone };
}

// Inter's advance widths in 1/1000 em, regular and bold, measured from the font draw.io loads.
const INTER = vendor("inter.json");

/** Width in px of one line of text, an upper estimate: unknown glyphs count as wide. */
export function textWidth(s, size = FONT, { bold = false, mono = false } = {}) {
  if (mono) return s.length * size * 0.6;
  const W = bold ? INTER.bold : INTER.regular;
  let em = 0;
  for (const ch of s) em += W[ch] ?? (ch.charCodeAt(0) > 0x2e7f ? 1000 : 640);
  return (em / 1000) * size * 1.04;
}

/** Splits text into lines no wider than max px, keeping the author's own line breaks. */
export function wrap(s, max, size = SMALL, opts) {
  const out = [];
  for (const para of String(s ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, opts) > max) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out.filter((l, i, a) => l || a.length === 1);
}

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let lucide, simple;
const icons = () => (lucide ??= vendor("lucide.json"));
/** Brand logos from Simple Icons: slug -> [title, hex, path]. Named in a spec as `logo:<slug>`. */
const logos = () => (simple ??= vendor("simple-icons.json"));

/** A Lucide icon's drawing as [tag, attributes] pairs, or undefined. */
export const iconShape = (name) => icons().nodes[name];

/** True when a Lucide icon or a `logo:` of that name exists. */
export const hasIcon = (name) => (name.startsWith("logo:") ? Boolean(logos()[name.slice(5)]) : Boolean(icons().nodes[name]));

/** Icon names whose name or tags contain every word of the query, best first. */
export function findIcons(query, limit = 12) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const { nodes, tags } = icons();
  const scored = [];
  for (const name of Object.keys(nodes)) {
    const hay = [name, ...(tags[name] ?? [])].join(" ");
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push([words.filter((w) => name.includes(w)).length, -name.length, name]);
  }
  const found = scored.sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, limit).map((s) => `${s[2]}: ${(tags[s[2]] ?? []).slice(0, 5).join(", ")}`);
  // A product logo only on whole words of its name: "cache" is not Cachet, "go" is not Argo.
  const whole = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
  const brands = Object.entries(logos()).filter(([slug, [title]]) => words.every((w) => whole(w).test(`${slug} ${title.toLowerCase()}`)))
    .sort((a, b) => a[0].length - b[0].length).slice(0, 6).map(([slug, [title]]) => `logo:${slug}: ${title} logo`);
  return [...brands, ...found];
}

/** Relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
function luminance(hex) {
  const c = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * A Lucide icon as an inline <img> for an HTML label, stroked in `color`. A `logo:<slug>` is the
 * brand's logo in its own colour, which says which product it is; a colour too pale to see on
 * white (yellow, mint) is drawn in ink.
 */
export function iconImg(name, color = C.ink, size = 16) {
  if (name.startsWith("logo:")) {
    const logo = logos()[name.slice(5)];
    if (!logo) throw new Error(`no logo "${name}"; search with: drawio icons <brand>`);
    const fill = 1.05 / (luminance(logo[1]) + 0.05) < 1.5 ? C.ink : `#${logo[1]}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${fill}"><path d="${logo[2]}"/></svg>`;
    return `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="vertical-align:-3px">`;
  }
  const shape = icons().nodes[name];
  if (!shape) throw new Error(`no icon "${name}"; search with: drawio icons <words>`);
  const body = shape.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="vertical-align:-3px">`;
}
