import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { processPaintByNumber } from "../src/engine/pipeline";
import { defaultSettings } from "../src/engine/types";
import type { ProcessResult } from "../src/engine/types";

const SUB = 4;

/** Even-odd scanline fill of a facet's loops, anti-aliased and painted in place. */
function fillFacet(rgb: Uint8Array, W: number, H: number, loops: number[][], color: number[], scale: number) {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 2) {
      const x = loop[i] * scale;
      const y = loop[i + 1] * scale;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(W - 1, Math.ceil(maxX));
  if (y1 < y0 || x1 < x0) return;

  const rowWidth = x1 - x0 + 1;
  const cov = new Float32Array(rowWidth);
  const crossings: number[] = [];

  for (let y = y0; y <= y1; y++) {
    cov.fill(0);
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB;
      crossings.length = 0;
      for (const loop of loops) {
        const count = loop.length / 2;
        for (let i = 0; i < count; i++) {
          const j = (i + 1) % count;
          const ay = loop[i * 2 + 1] * scale;
          const by = loop[j * 2 + 1] * scale;
          if (ay === by) continue;
          if (sy < Math.min(ay, by) || sy >= Math.max(ay, by)) continue;
          const ax = loop[i * 2] * scale;
          const bx = loop[j * 2] * scale;
          crossings.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const spanStart = Math.max(crossings[k], x0);
        const spanEnd = Math.min(crossings[k + 1], x1 + 1);
        if (spanEnd <= spanStart) continue;
        const first = Math.floor(spanStart);
        const last = Math.ceil(spanEnd) - 1;
        for (let px = first; px <= last; px++) {
          const left = Math.max(spanStart, px);
          const right = Math.min(spanEnd, px + 1);
          if (right > left) cov[px - x0] += (right - left) / SUB;
        }
      }
    }
    for (let px = 0; px < rowWidth; px++) {
      const a = Math.min(1, cov[px]);
      if (a <= 0) continue;
      const o = (y * W + (x0 + px)) * 3;
      for (let c = 0; c < 3; c++) rgb[o + c] = rgb[o + c] * (1 - a) + color[c] * a;
    }
  }
}

function render(result: ProcessResult, scale: number, smooth: boolean): { rgb: Uint8Array; W: number; H: number } {
  const W = Math.round(result.width * scale);
  const H = Math.round(result.height * scale);
  const rgb = new Uint8Array(W * H * 3);
  const { indices, palette, width: w } = result;
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const color = palette[indices[sy * w + Math.floor(x / scale)]].rgb;
      const o = (y * W + x) * 3;
      rgb[o] = color[0];
      rgb[o + 1] = color[1];
      rgb[o + 2] = color[2];
    }
  }
  if (smooth) {
    const ordered = [...result.facets].sort((a, b) => b.pixelCount - a.pixelCount);
    for (const facet of ordered) {
      if (facet.outlines.length === 0) continue;
      fillFacet(rgb, W, H, facet.outlines, palette[facet.colorIndex].rgb, scale);
    }
  }
  return { rgb, W, H };
}

function save(path: string, rgb: Uint8Array, W: number, H: number) {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

const src = process.argv[2];
const maxDimension = Number(process.argv[3] ?? 320);
const scale = Number(process.argv[4] ?? 6);
const overrides = JSON.parse(process.argv[5] ?? "{}");
const prefix = process.argv[6] ?? "edges";
const png = PNG.sync.read(readFileSync(src), { checkCRC: false } as never);
const settings = { ...defaultSettings, maxDimension, ...overrides };
const result = processPaintByNumber(
  { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height },
  settings,
);

const loopCount = result.facets.reduce((sum, f) => sum + f.outlines.length, 0);
const pointCount = result.facets.reduce(
  (sum, f) => sum + f.outlines.reduce((n, l) => n + l.length / 2, 0),
  0,
);
console.log(`facets: ${result.facets.length}, loops: ${loopCount}, points: ${pointCount}`);

const blocky = render(result, scale, false);
save(`tmp-check/${prefix}-blocky.png`, blocky.rgb, blocky.W, blocky.H);
const smooth = render(result, scale, true);
save(`tmp-check/${prefix}-smooth.png`, smooth.rgb, smooth.W, smooth.H);
console.log(`wrote tmp-check/${prefix}-{blocky,smooth}.png at ${smooth.W}x${smooth.H}`);
