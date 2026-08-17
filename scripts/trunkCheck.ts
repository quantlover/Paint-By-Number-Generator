import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { processPaintByNumber } from "../src/engine/pipeline";
import { defaultSettings, type Settings } from "../src/engine/types";

const ORIGINAL = process.argv[2];
const PREVIOUS_OUTPUT = process.argv[3];

function load(path: string) {
  const png = PNG.sync.read(readFileSync(path), { checkCRC: false, skipRescale: true } as never);
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

const DARK = 100;

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tree trunks are the darkest content, so dark coverage tracks whether they survived. */
function darkPercent(data: Uint8ClampedArray | ArrayLike<number>, count: number) {
  let dark = 0;
  for (let i = 0; i < count; i++) {
    if (luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < DARK) dark++;
  }
  return (dark / count) * 100;
}

function darkPercentFromIndices(indices: Uint8Array, palette: { rgb: [number, number, number] }[]) {
  let dark = 0;
  for (let i = 0; i < indices.length; i++) {
    const rgb = palette[indices[i]].rgb;
    if (luma(rgb[0], rgb[1], rgb[2]) < DARK) dark++;
  }
  return (dark / indices.length) * 100;
}

/** Mid-ground band where the thin tree trunks stand, in 618x1024 coordinates. */
const CROP = { x0: 270, y0: 280, x1: 520, y1: 470 };

function cropStats(
  get: (i: number) => [number, number, number],
  reference: Uint8ClampedArray,
  width: number,
) {
  let error = 0;
  let veryDark = 0;
  let n = 0;
  for (let y = CROP.y0; y <= CROP.y1; y++) {
    for (let x = CROP.x0; x <= CROP.x1; x++) {
      const i = y * width + x;
      const [r, g, b] = get(i);
      error +=
        Math.abs(reference[i * 4] - r) + Math.abs(reference[i * 4 + 1] - g) + Math.abs(reference[i * 4 + 2] - b);
      if (luma(r, g, b) < 70) veryDark++;
      n++;
    }
  }
  return { mae: error / (n * 3), veryDarkPercent: (veryDark / n) * 100 };
}

const original = load(ORIGINAL);
const originalDark = darkPercent(original.data, original.width * original.height);
console.log(`original: ${original.width}x${original.height} dark=${originalDark.toFixed(2)}%`);

const originalCrop = cropStats(
  (i) => [original.data[i * 4], original.data[i * 4 + 1], original.data[i * 4 + 2]],
  original.data,
  original.width,
);
console.log(`  trunk band: veryDark=${originalCrop.veryDarkPercent.toFixed(2)}% (reference)`);

if (PREVIOUS_OUTPUT) {
  const prev = load(PREVIOUS_OUTPUT);
  const stats = cropStats(
    (i) => [prev.data[i * 4], prev.data[i * 4 + 1], prev.data[i * 4 + 2]],
    original.data,
    original.width,
  );
  console.log(
    `previous app output : trunkMAE=${stats.mae.toFixed(1)} trunkVeryDark=${stats.veryDarkPercent.toFixed(2)}%`,
  );
}

function writePng(
  path: string,
  indices: Uint8Array,
  palette: { rgb: [number, number, number] }[],
  width: number,
  height: number,
) {
  const png = new PNG({ width, height });
  for (let i = 0; i < indices.length; i++) {
    const rgb = palette[indices[i]].rgb;
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

function run(name: string, overrides: Partial<Settings>, writeTo?: string) {
  const settings: Settings = { ...defaultSettings, ...overrides };
  const t0 = Date.now();
  const result = processPaintByNumber(
    { data: new Uint8ClampedArray(original.data), width: original.width, height: original.height },
    settings,
  );
  const dark = darkPercentFromIndices(result.indices, result.palette);
  const stats =
    result.width === original.width
      ? cropStats((i) => result.palette[result.indices[i]].rgb, original.data, result.width)
      : null;
  console.log(
    `${name}: shapes=${result.facets.length} colors=${result.palette.length} dark=${dark.toFixed(2)}%` +
      (stats
        ? ` trunkMAE=${stats.mae.toFixed(1)} trunkVeryDark=${stats.veryDarkPercent.toFixed(2)}%`
        : " (resized, crop skipped)") +
      ` ms=${Date.now() - t0}`,
  );
  if (writeTo) writePng(writeTo, result.indices, result.palette, result.width, result.height);
}

// Match the source size so the trunk crop lines up with the reference.
const noResize = { maxDimension: Math.max(original.width, original.height) };

for (const maxColors of [16, 18, 20, 22, 24, 28, 32]) {
  run(`${String(maxColors).padStart(2)} colors          `, { ...noResize, maxColors });
}
run("old speckly settings", { ...noResize, textureSmoothing: 0, minRegionAreaBp: 1, maxRegions: 3000 });
run("NEW DEFAULTS        ", noResize, "tmp-check/new-finished.png");
