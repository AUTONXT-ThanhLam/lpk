import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** The draw.io desktop app's command, or null. */
function drawio() {
  for (const c of [process.env.DRAWIO_BIN, "drawio", "/snap/bin/drawio", "/usr/bin/drawio", "/Applications/draw.io.app/Contents/MacOS/draw.io"]) {
    if (!c) continue;
    if (c.startsWith("/")) { if (existsSync(c)) return c; continue; }
    const w = spawnSync("which", [c], { encoding: "utf8" });
    if (w.status === 0) return w.stdout.trim();
  }
  return null;
}

/**
 * Exports a .drawio file to PNG next to it with the draw.io desktop app. The snap build reads
 * and writes only under ~/snap/drawio/common, so the file goes through a folder there. The GPU
 * rasteriser can paint stray copies of an edge near overlapping shadows, so it is turned off.
 */
export function exportPng(file, scale = 2) {
  const bin = drawio();
  if (!bin) return { error: "draw.io desktop app not found (install it, or set DRAWIO_BIN); the .drawio file is written, no PNG" };
  const snap = bin.includes("snap");
  const work = snap ? join(homedir(), "snap", "drawio", "common", "drawio-export") : null;
  if (work) mkdirSync(work, { recursive: true });
  const src = work ? join(work, basename(file)) : file;
  if (work) copyFileSync(file, src);
  const png = src.replace(/\.drawio$/, "") + ".png";
  const r = spawnSync(bin, ["-x", "-f", "png", "-s", String(scale), "-b", "16", "-o", png, src, "--disable-gpu", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])], { encoding: "utf8", timeout: 120000 });
  if (r.status !== 0 || !existsSync(png)) return { error: `draw.io export failed: ${(r.stderr || r.stdout || "").trim().split("\n").at(-1)}` };
  const out = file.replace(/\.drawio$/, "") + ".png";
  if (png !== out) copyFileSync(png, out);
  return { png: out };
}
