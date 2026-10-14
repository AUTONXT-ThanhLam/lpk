import { createRequire } from "node:module";
import { EDGE, SMALL, accentOf, esc, textWidth } from "./style.mjs";
import { Model, S, edgeTone } from "./model.mjs";
import { noteEdgeTone } from "./legend.mjs";
import { drawNode, groupHeader, measure } from "./nodes.mjs";
import grid from "./grid.mjs";
import { checkSides } from "./wires.mjs";

const ELK = createRequire(import.meta.url)("../vendor/elk.bundled.js");

/**
 * Boxes and arrows laid out by ELK's layered algorithm: architecture, flow, state machine, ERD.
 * Groups nest (`in`), edges route orthogonally around boxes, labels get room of their own.
 */
export default async function graph(spec) {
  const groups = spec.groups ?? [], nodes = spec.nodes ?? [], edges = spec.edges ?? [];
  if ([...groups, ...nodes].some((x) => "row" in x || "col" in x)) return checkIds(groups, nodes, edges) ?? grid(spec);
  checkIds(groups, nodes, edges);


  const headers = Object.fromEntries(groups.map((g) => [g.id, groupHeader(g)]));
  const elkNode = (x) => {
    if (headers[x.id]) {
      const h = headers[x.id];
      return {
        id: x.id,
        layoutOptions: {
          "elk.padding": `[top=${h.height + 14},left=20,bottom=20,right=20]`,
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.nodeSize.minimum": `(${Math.ceil(h.width)},${h.height + 40})`,
        },
        children: [...groups, ...nodes].filter((c) => c.in === x.id).map(elkNode),
      };
    }
    const { w, h } = measure(x);
    if (x.kind !== "decision") return { id: x.id, width: w, height: h };
    // A diamond is joined at its four corners, never at the empty corners of its bounding box.
    const at = { N: [w / 2, 0, "NORTH"], S: [w / 2, h, "SOUTH"], E: [w, h / 2, "EAST"], W: [0, h / 2, "WEST"] };
    return { id: x.id, width: w, height: h, layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: Object.entries(at).map(([k, [px, py, side]]) => ({ id: `${x.id}:${k}`, x: px, y: py, width: 0, height: 0, layoutOptions: { "elk.port.side": side } })) };
  };
  // Into a decision at the side facing the flow; out of it forward first, then to either side.
  const flow = (spec.direction ?? "RIGHT") === "DOWN" ? { in: "N", out: ["S", "E", "W"] } : { in: "W", out: ["E", "S", "N"] };
  const outSeen = {};
  const end = (id, dir) => {
    if (nodes.find((n) => n.id === id)?.kind !== "decision") return id;
    if (dir === "in") return `${id}:${flow.in}`;
    outSeen[id] = (outSeen[id] ?? -1) + 1;
    return `${id}:${flow.out[Math.min(outSeen[id], 2)]}`;
  };
  const root = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": spec.direction ?? "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeLabel": "6",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.spacing.componentComponent": "48",
      ...(spec.layout ?? {}),
    },
    children: [...groups, ...nodes].filter((x) => !x.in).map(elkNode),
    edges: edges.map((e, i) => ({
      id: `edge${i}`, sources: [end(e.from, "out")], targets: [end(e.to, "in")],
      labels: e.label ? [{ layoutOptions: { "elk.edgeLabels.placement": spec.labels === "tail" ? "TAIL" : "CENTER" }, text: e.label, width: textWidth(e.label, SMALL) + 10, height: 18 }] : [],
    })),
  };
  const laid = await new ELK().layout(root);

  const m = new Model(spec.title ?? "diagram");
  const abs = {};
  const walk = (n, ox, oy, parent) => {
    for (const c of n.children ?? []) {
      const box = { x: ox + c.x, y: oy + c.y, w: c.width, h: c.height };
      abs[c.id] = box;
      if (headers[c.id]) {
        const g = groups.find((x) => x.id === c.id);
        m.shape({ id: c.id, parent, ...box, value: headers[c.id].value, style: S.group(g.tone, accentOf(g)), role: "group" });
        if (g.tone && g.tone !== "neutral") m.tones.add(g.tone);
        Object.assign(m.shapes.at(-1), { header: headers[c.id].height, headerW: headers[c.id].width });
        walk(c, box.x, box.y, c.id);
      } else drawNode(m, nodes.find((x) => x.id === c.id), box, parent);
    }
  };
  walk(laid, 0, 0, null);

  // An edge's coordinates are relative to the group that contains it in ELK's output.
  const offsetOf = (container) => (container && container !== "root" ? abs[container] : { x: 0, y: 0 });
  const allEdges = [];
  const collect = (n) => { for (const e of n.edges ?? []) allEdges.push(e); for (const c of n.children ?? []) collect(c); };
  collect(laid);
  const drawn = [];
  for (const le of allEdges) {
    const e = edges[Number(le.id.slice(4))];
    const o = offsetOf(le.container);
    const sec = le.sections?.[0];
    if (!sec) continue;
    const points = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => [p.x + o.x, p.y + o.y]);
    drawn.push({ e, points, labels: (le.labels ?? []).map((l) => ({ ...l, x: l.x + o.x, y: l.y + o.y })) });
  }
  mergeIntoEnds(drawn, nodes, abs, (spec.direction ?? "RIGHT") === "DOWN");
  for (const { e, points, labels, tail } of drawn) {
    const tone = edgeTone(e);
    noteEdgeTone(m, tone);
    m.edge({ source: e.from, target: tail ? null : e.to, points, style: S.edge(tone, e) + (tail ? "endArrow=none;" : "") });
    for (const l of labels) m.shape({ x: l.x, y: l.y, w: l.width, h: l.height, value: esc(e.label), style: S.label(EDGE[tone]), role: "label" });
  }
  return m;
}

/**
 * Arrows into an end node join into one, so the end shows one arrowhead: the branch closest to
 * the centre goes on in, every other branch runs across into it where it already turns.
 */
function mergeIntoEnds(drawn, nodes, abs, down) {
  // Work in flow coordinates: f along the flow, c across it.
  const fc = (p) => (down ? [p[1], p[0]] : [p[0], p[1]]), xy = ([f, c]) => (down ? [c, f] : [f, c]);
  for (const n of nodes.filter((x) => x.kind === "end")) {
    const b = abs[n.id], [front, mid] = down ? [b.y, b.x + b.w / 2] : [b.x, b.y + b.h / 2];
    const into = drawn.filter((d) => {
      if (d.e.to !== n.id || d.points.length < 2) return false;
      const [p, q] = d.points.slice(-2).map(fc);
      return p[1] === q[1] && q[0] <= front + 1;
    });
    if (into.length < 2) continue;
    into.sort((d1, d2) => Math.abs(fc(d1.points.at(-1))[1] - mid) - Math.abs(fc(d2.points.at(-1))[1] - mid));
    const tp = into[0].points.map(fc), trunk = tp.at(-1)[1], from = tp.at(-2)[0];
    // A branch meets the trunk only on the trunk's last piece; one that cannot keeps its own arrowhead.
    const onTrunk = (f) => f >= from && f <= front - 8;
    for (const d of into.slice(1)) {
      const pts = d.points.map(fc), bend = pts.length >= 3 && pts.at(-3)[0] === pts.at(-2)[0];
      if (bend && onTrunk(pts.at(-2)[0])) d.points = [...pts.slice(0, -2), [pts.at(-2)[0], trunk]].map(xy);
      else if (onTrunk(front - 20) && pts.at(-2)[0] <= front - 20) d.points = [...pts.slice(0, -1), [front - 20, pts.at(-1)[1]], [front - 20, trunk]].map(xy);
      else continue;
      d.tail = true;
    }
  }
}

/** Throws on a missing or duplicate id, an unknown group, or an edge to nothing. */
function checkIds(groups, nodes, edges) {
  const ids = new Set();
  for (const x of [...groups, ...nodes]) {
    if (!x.id) throw new Error(`every group and node needs an id: ${JSON.stringify(x).slice(0, 80)}`);
    if (ids.has(x.id)) throw new Error(`duplicate id "${x.id}"`);
    ids.add(x.id);
  }
  for (const x of [...groups, ...nodes]) if (x.in && !groups.some((g) => g.id === x.in)) throw new Error(`"${x.id}" is in unknown group "${x.in}"`);
  for (const e of edges) for (const end of [e.from, e.to]) if (!ids.has(end)) throw new Error(`edge ${e.from} -> ${e.to}: unknown id "${end}"`);
  checkSides(edges);
}
