import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { processPaintByNumber } from "../src/engine/pipeline";
import { defaultSettings } from "../src/engine/types";
import type { ProcessResult, Settings } from "../src/engine/types";

const png = PNG.sync.read(readFileSync(process.argv[2]), { checkCRC: false } as never);
const original = png.data;

/** Mean absolute error against the full-resolution photo, so runs at different
 * working sizes stay comparable. Lower means more of the photo survived. */
function fidelity(result: ProcessResult): number {
  let total = 0;
  for (let y = 0; y < png.height; y++) {
    const sy = Math.min(result.height - 1, Math.floor((y * result.height) / png.height));
    for (let x = 0; x < png.width; x++) {
      const sx = Math.min(result.width - 1, Math.floor((x * result.width) / png.width));
      const rgb = result.palette[result.indices[sy * result.width + sx]].rgb;
      const o = (y * png.width + x) * 4;
      total += Math.abs(original[o] - rgb[0]) + Math.abs(original[o + 1] - rgb[1]) + Math.abs(original[o + 2] - rgb[2]);
    }
  }
  return total / (png.width * png.height * 3);
}

/** Digits smaller than this on the print are hard to read while painting. */
function tinyNumbers(result: ProcessResult, settings: Settings): number {
  let tiny = 0;
  for (const facet of result.facets) {
    const digits = String(result.palette[facet.colorIndex].number).length;
    const room = Math.max(facet.labelRadius, 0.7) * 2 * settings.printScale;
    const fitted = room / Math.sqrt(0.3364 * digits * digits + 0.5184);
    if (fitted < 14) tiny++;
  }
  return tiny;
}

const configs: [string, Partial<Settings>][] = [
  ["defaults", {}],
  ["smallest shape 0.01%", { minRegionAreaBp: 1 }],
  ["working size 1200", { maxDimension: 1200 }],
  ["texture smoothing 0", { textureSmoothing: 0 }],
  ["texture smoothing 1", { textureSmoothing: 1 }],
  ["colors 32", { maxColors: 32 }],
  ["shape cap 3000", { maxRegions: 3000 }],
  ["soften edges off", { softenEdges: false }],
  ["more detail", { minRegionAreaBp: 1, maxDimension: 1200, textureSmoothing: 1, maxRegions: 3000 }],
  [
    "max detail",
    { minRegionAreaBp: 1, maxDimension: 1200, textureSmoothing: 0, maxRegions: 6000, maxColors: 32, softenEdges: false },
  ],
];

console.log(`photo ${png.width}x${png.height}`);
console.log("config                | shapes | MAE  | shapes<200px | tiny numbers | ms");
for (const [name, overrides] of configs) {
  const settings = { ...defaultSettings, ...overrides };
  const started = Date.now();
  const result = processPaintByNumber(
    { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height },
    settings,
  );
  const ms = Date.now() - started;
  const small = result.facets.filter((f) => f.pixelCount < 200).length;
  console.log(
    `${name.padEnd(21)} | ${String(result.facets.length).padStart(6)} | ${fidelity(result).toFixed(2).padStart(4)} | ` +
      `${String(small).padStart(12)} | ${String(tinyNumbers(result, settings)).padStart(12)} | ${ms}`,
  );
}
