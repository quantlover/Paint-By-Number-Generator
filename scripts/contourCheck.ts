import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { buildFacetOutlines, signedArea, traceRegionLoops } from "../src/engine/contours";
import { buildRegions, mergeUnpaintableRegions } from "../src/engine/facets";
import { clusterImage } from "../src/engine/kmeans";

const path = process.argv[2];
const maxColors = Number(process.argv[3] ?? 24);
const png = PNG.sync.read(readFileSync(path), { checkCRC: false } as never);
const { indices, palette } = clusterImage(
  new Uint8ClampedArray(png.data),
  png.width,
  png.height,
  maxColors,
  "lab",
  1,
  1,
);
mergeUnpaintableRegions(indices, png.width, png.height, 40, 900, 1, palette);
const map = buildRegions(indices, png.width, png.height);
const live = map.regions.filter((r) => r.pixelCount > 0);
console.log(`image ${png.width}x${png.height}, regions ${live.length}`);

// Raw tracing must reproduce each region exactly, or the geometry is wrong.
let exact = 0;
for (const region of live) {
  const area = Math.abs(traceRegionLoops(map, region).reduce((sum, loop) => sum + signedArea(loop), 0));
  if (Math.abs(area - region.pixelCount) < 1e-6) exact++;
}
console.log(`raw traced area equals pixel count: ${exact}/${live.length}`);

for (const level of [1, 2, 3, 4]) {
  const outlines = buildFacetOutlines(map, level);
  let total = 0;
  const rows: { size: number; drift: number }[] = [];
  for (const region of live) {
    const loops = outlines[region.id];
    const area = Math.abs(loops.reduce((sum, loop) => sum + signedArea(loop), 0));
    total += area;
    rows.push({ size: region.pixelCount, drift: Math.abs(area - region.pixelCount) / region.pixelCount });
  }
  const imageArea = png.width * png.height;
  const band = (min: number, max: number) => {
    const picked = rows.filter((r) => r.size >= min && r.size < max).map((r) => r.drift);
    if (picked.length === 0) return `${min}-${max}: none`;
    picked.sort((a, b) => a - b);
    const median = picked[picked.length >> 1];
    return `${min}-${max}px (n=${picked.length}) median ${(median * 100).toFixed(1)}% worst ${(picked[picked.length - 1] * 100).toFixed(1)}%`;
  };
  console.log(`\nsmoothing ${level}: covers ${((total / imageArea) * 100).toFixed(2)}% of image`);
  console.log(`  ${band(0, 100)}`);
  console.log(`  ${band(100, 1000)}`);
  console.log(`  ${band(1000, 10000)}`);
  console.log(`  ${band(10000, Infinity)}`);
}
