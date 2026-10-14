/** Each spec `type` and the module that draws it. */
export const TYPES = {
  graph: "./graph.mjs", tree: "./tree.mjs", swimlane: "./swimlane.mjs", matrix: "./matrix.mjs", quadrant: "./quadrant.mjs",
  sequence: "./sequence.mjs", timeline: "./timeline.mjs", chart: "./chart.mjs", board: "./board.mjs",
  stack: "./stack.mjs", cubes: "./cubes.mjs",
};

/** Builds the model for any spec. */
export async function build(spec) {
  if ((spec.type ?? "graph") === "graph" && spec.view === "iso") return (await import("./isograph.mjs")).default(spec);
  if (spec.view && spec.view !== "iso") throw new Error(`unknown view "${spec.view}" (iso)`);
  const mod = TYPES[spec.type ?? "graph"];
  if (!mod) throw new Error(`unknown type "${spec.type}" (${Object.keys(TYPES).join(", ")})`);
  return (await import(mod)).default(spec);
}
