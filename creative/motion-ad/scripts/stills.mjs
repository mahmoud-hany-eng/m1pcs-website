// Render selected frames of a composition as PNG stills (one bundle, one browser).
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";

const [comp, outDir, ...frames] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: comp });
for (const f of frames.map(Number)) {
  const output = path.join(outDir, `s${String(f).padStart(4, "0")}.png`);
  await renderStill({ composition, serveUrl, output, frame: f, chromiumOptions: { gl: "angle" } });
  console.log("still", f);
}
