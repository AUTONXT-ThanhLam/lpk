import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model, S } from "../lib/model.mjs";
import { check } from "../lib/check.mjs";

const root = join(import.meta.dirname, "..");
const bin = join(root, "bin", "drawio");
const examples = join(root, "skills", "diagram", "examples");
const tmp = mkdtempSync(join(tmpdir(), "drawio-test-"));
const run = (...args) => spawnSync("node", [bin, ...args], { encoding: "utf8", timeout: 60000 });

test("every example renders to a draw.io file with no overlap, no arrow through a box and no crossing", () => {
  for (const f of readdirSync(examples).filter((f) => f.endsWith(".json"))) {
    const out = join(tmp, f.replace(".json", ".drawio"));
    const r = run("render", join(examples, f), "-o", out, "--no-png");
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    assert.match(r.stdout, /0 arrow crossings\n(\d+ boxes, .*\n)?(built-in English words drawn: .*\n)?no overlaps, no arrow through a box, no label on a box/, `${f}: ${r.stdout}`);
    const xml = readFileSync(out, "utf8");
    const ids = new Set([...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, src, dst] of xml.matchAll(/source="([^"]+)" target="([^"]+)"/g)) assert.ok(ids.has(src) && ids.has(dst), `${f}: edge ${src} -> ${dst}`);
  }
});

test("render reports boxes that overlap, and refuses an edge to an unknown box", () => {
  const spec = join(tmp, "overlap.json");
  writeFileSync(spec, JSON.stringify({ nodes: [{ id: "a", title: "A", row: 0, col: 0 }, { id: "b", title: "B", row: 0, col: 0 }] }));
  assert.match(run("render", spec, "--no-png").stdout, /- overlap: "A" and "B"/);
  writeFileSync(spec, JSON.stringify({ nodes: [{ id: "a", title: "A" }], edges: [{ from: "a", to: "nope" }] }));
  const r = run("render", spec, "--no-png");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown id "nope"/);
  writeFileSync(spec, JSON.stringify({ nodes: [{ id: "a", title: "A" }, { id: "b", title: "B" }], edges: [{ from: "a", to: "b", fromSide: "lef" }] }));
  assert.match(run("render", spec, "--no-png").stderr, /fromSide "lef" is not one of top, right, bottom, left/);
});

test("the check names an arrow that runs through a box and a label that sits on one", () => {
  const m = new Model("t");
  for (const [id, x] of [["a", 0], ["mid", 200], ["b", 400]]) m.shape({ id, x, y: 0, w: 100, h: 50, value: id, style: S.node("box") });
  m.edge({ source: "a", target: "b", points: [[100, 25], [400, 25]], style: S.edge() });
  m.shape({ x: 210, y: 10, w: 40, h: 18, value: "lbl", style: S.label("#000"), role: "label" });
  const { facts } = check(m);
  assert.ok(facts.includes('arrow through box: a -> b crosses "mid"'), facts.join("\n"));
  assert.ok(facts.includes('label on box: "lbl" on "mid"'), facts.join("\n"));
});

test("what the skill names exists: example files, CLI commands, the manifest", () => {
  const skill = readFileSync(join(root, "skills", "diagram", "SKILL.md"), "utf8");
  for (const [, f] of skill.matchAll(/`([a-z0-9-]+\.json)`/g)) assert.ok(readdirSync(examples).includes(f), f);
  const usage = run().stderr;
  for (const [, verb] of skill.matchAll(/bin\/drawio"? ([a-z]+)/g)) assert.match(usage, new RegExp(`drawio ${verb} `), verb);
  assert.equal(JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")).name, "drawio");
  assert.match(run("icons", "database").stdout, /^database: /m);
});

test("what a reader reads stays apart: bar and line values, nested frames, mind map labels, an untitled group", () => {
  const cells = (spec) => {
    const file = join(tmp, "apart.json");
    writeFileSync(file, JSON.stringify(spec));
    assert.equal(run("render", file, "-o", join(tmp, "apart.drawio"), "--no-png").status, 0);
    const xml = readFileSync(join(tmp, "apart.drawio"), "utf8");
    return [...xml.matchAll(/<mxCell id="[^"]*" value="([^"]*)"[^>]*><mxGeometry x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(([, value, x, y, w, h]) => ({ value, x: +x, y: +y, w: +w, h: +h }));
  };
  const apart = (list) => list.forEach((a, i) => list.slice(i + 1).forEach((b) => assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.value} on ${b.value}`)));
  const series = [[42.5, 30, 12], [40, 31, 12], [45, 29, 11]].map((values, i) => ({ name: `s${i}`, values }));
  apart(cells({ type: "chart", chart: "bar", unit: "s", categories: ["a", "b", "c"], series }).filter((c) => /^\d.*s$/.test(c.value)));
  apart(cells({ type: "chart", chart: "line", categories: ["a", "b", "c"], series }).filter((c) => /^\d|●/.test(c.value)));
  const seq = cells({ type: "sequence", participants: [{ id: "w", title: "Worker" }, { id: "db", title: "DB" }],
    steps: [{ from: "w", to: "db", label: "insert" }, { from: "w", to: "db", label: "update" }, { from: "w", to: "db", label: "ack" }],
    frames: [{ kind: "loop", label: "each", from: 1, to: 3 }, { kind: "alt", label: "new", from: 1, to: 2, else: { at: 2, label: "known" } }] });
  const [loop, alt] = ["loop [each]", "alt [new]"].map((t) => seq.find((c) => c.value.includes(t)));
  assert.ok(alt.x > loop.x && alt.y > loop.y && alt.x + alt.w < loop.x + loop.w, "the alt frame sits inside the loop");
  const retry = cells({ type: "sequence", participants: [{ id: "w", title: "Worker" }, { id: "db", title: "DB" }],
    steps: [{ from: "w", to: "db", label: "read" }, { from: "w", to: "db", label: "poll" }, { from: "w", to: "db", label: "give up" }],
    frames: [{ kind: "alt", label: "found", from: 1, to: 3, else: { at: 2, label: "missing" } }, { kind: "loop", label: "retry", from: 2, to: 3 }] });
  const [miss, again] = ["[missing]", "loop [retry]"].map((t) => retry.find((c) => c.value.includes(t)));
  assert.ok(miss.y + miss.h <= again.y, "the else condition sits above the loop it holds");
  const mind = cells({ type: "tree", direction: "RIGHT", root: { title: "Root", children: [{ title: "Alpha", via: "depends on heavily" }, { title: "Beta", via: "uses" }] } });
  apart(mind.filter((c) => c.value && !c.value.startsWith("<")));
  apart(cells({ type: "tree", root: { title: "Cached?", children: [{ title: "A", via: "yes, and still fresh enough" }, { title: "B", via: "no" }] } }).filter((c) => c.value));
  assert.ok(!cells({ type: "graph", nodes: [{ id: "a", title: "A", in: "g" }], groups: [{ id: "g" }] }).some((c) => c.value.includes("undefined")));
});

test("isometric pictures report a name that does not fit and refuse what cannot be drawn", () => {
  const render = (spec) => {
    const file = join(tmp, "iso.json");
    writeFileSync(file, JSON.stringify(spec));
    return run("render", file, "-o", join(tmp, "iso.drawio"), "--no-png");
  };
  const slab = { view: "iso", groups: [{ id: "box", title: "Box", row: 0, col: 0 }],
    nodes: [{ id: "a", title: "A", in: "box", row: 0, col: 0 }, { id: "b", title: "Sensor", row: 0, col: 1 }], edges: [{ from: "b", to: "a" }] };
  const ok = render(slab);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /no overlaps/);
  slab.nodes[0] = { id: "a", title: "A service name long enough to wrap to five lines on its tile", icon: "cpu", in: "box", row: 0, col: 0 };
  slab.nodes.push({ id: "c", title: "B", in: "box", row: 1, col: 0 });
  assert.match(render(slab).stdout, /- name "A service name long enough[^"]*" does not fit on its tile/);
  const refused = [
    [{ type: "stack", layers: [{ title: "L" }], items: [{ id: "a", title: "A" }], links: [{ from: "a", to: "zz" }] }, /unknown id "zz"/],
    [{ type: "cubes", size: [3, 3], labels: [{ title: "X", at: [3, 0] }] }, /outside the 3 x 3 field/],
    [{ type: "cubes", size: [3, 3], groups: [{ title: "P", accent: "blue", cells: [[0, 0]] }, { title: "Q", accent: "sage", cells: [[0, 0]] }] }, /in both "P" and "Q"/],
    [{ view: "flat", nodes: [{ id: "a", title: "A" }] }, /unknown view "flat"/],
  ];
  for (const [spec, why] of refused) {
    const r = render(spec);
    assert.equal(r.status, 2, JSON.stringify(spec));
    assert.match(r.stderr, why);
  }
});

test("render prints the counts the reading rules are about, and donut shares that add up", () => {
  const spec = join(tmp, "counts.json");
  writeFileSync(spec, JSON.stringify({ nodes: [{ id: "a", title: "API" }, { id: "b", title: "Queue", tone: "warn" }, { id: "c", title: "Worker" }],
    edges: [{ from: "a", to: "b", main: true }, { from: "b", to: "c", dashed: true }, { from: "a", to: "c", dashed: true, label: "nightly" }] }));
  assert.match(run("render", spec, "--no-png").stdout, /\n3 boxes, 1 tone beside grey and the main path \(warn\)\n/);
  const donut = (values) => {
    writeFileSync(spec, JSON.stringify({ type: "chart", chart: "donut", categories: values.map((v, i) => `c${i}`), series: [{ name: "n", values }] }));
    const out = join(tmp, "donut.drawio");
    assert.equal(run("render", spec, "-o", out, "--no-png").status, 0);
    return [...readFileSync(out, "utf8").matchAll(/· (&amp;[lg]t;)?(\d+)%/g)].map((m) => `${m[1] ? (m[1].includes("lt") ? "<" : ">") : ""}${m[2]}`);
  };
  assert.deepEqual(donut([1, 1, 1]), ["34", "33", "33"]);
  assert.deepEqual(donut([999, 1]), [">99", "<1"]);
  assert.deepEqual(donut([0.4, 0.4, 99.2]), ["<1", "<1", ">99"]);
});

test("what a reader would count or convert by hand, the spec says by name: dates, step ids, columns, default words", () => {
  const spec = join(tmp, "byname.json"), out = join(tmp, "byname.drawio");
  const render = (o) => { writeFileSync(spec, JSON.stringify(o)); const r = run("render", spec, "-o", out, "--no-png"); return { ...r, xml: r.status ? "" : readFileSync(out, "utf8") }; };
  const lanes = [{ id: "be", title: "Backend" }];
  const dated = render({ type: "timeline", lanes, tasks: [{ title: "API", lane: "be", start: "2026-10-13", end: "2026-10-15" }], milestones: [{ title: "Demo", at: "2026-10-16" }] });
  const numbered = render({ type: "timeline", unit: "Day", lanes, tasks: [{ title: "API", lane: "be", start: 0, end: 3 }], milestones: [{ title: "Demo", at: 3 }] });
  const bar = (xml) => xml.match(/value="&lt;b&gt;API&lt;\/b&gt;"[^>]*>\s*<mxGeometry x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).slice(1);
  assert.deepEqual(bar(dated.xml), bar(numbered.xml), "an inclusive end date covers the same days as end 3");
  assert.match(dated.xml, /value="Oct 13"/);
  assert.match(render({ type: "timeline", lanes, tasks: [{ title: "API", lane: "be", start: "2026-10-13", end: 3 }] }).stderr, /"3" is not a date/);
  assert.match(render({ type: "timeline", lanes, tasks: [{ title: "API", lane: "be", start: "2026-02-30", end: "2026-03-02" }] }).stderr, /"2026-02-30" is not a date/);
  const seq = (frames) => render({ type: "sequence", participants: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
    steps: [{ from: "a", to: "b", label: "ask", id: "ask" }, { from: "b", to: "a", label: "ok", reply: true, id: "ok" }, { from: "b", to: "a", label: "no", reply: true, id: "no" }], frames });
  const frame = (r) => r.xml.match(/style="[^"]*rounded=0;html=1;fillColor=none;[^"]*"[^>]*><mxGeometry ([^/]*)/)[1];
  assert.equal(frame(seq([{ kind: "alt", label: "valid", from: "ok", to: "no", else: { at: "no" } }])), frame(seq([{ kind: "alt", label: "valid", from: 2, to: 3, else: { at: 3 } }])));
  assert.match(seq([{ kind: "alt", from: "nope" }]).stderr, /no step with id "nope"/);
  const swim = JSON.parse(readFileSync(join(examples, "swimlane.json"), "utf8"));
  const auto = render(swim).xml;
  assert.equal(render({ ...swim, steps: swim.steps.map((s, i) => ({ ...s, at: i })) }).xml, auto, "columns follow the arrows");
  swim.edges.push({ from: swim.steps.at(-1).id, to: swim.steps[0].id });
  assert.match(render(swim).stderr, /sit on a loop of arrows: give one of them "at"/);
  writeFileSync(spec, JSON.stringify({ nodes: [{ id: "a", title: "API", tone: "warn" }] }));
  assert.match(run("render", spec, "-o", out, "--no-png").stdout, /built-in English words drawn: "needs care" \(legend\.warn\)/);
});
