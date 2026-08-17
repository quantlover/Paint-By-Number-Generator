import { boxBlur, majorityFilter, removeColorHalos } from "./cleanup";
import { buildFacetOutlines } from "./contours";
import { buildRegions, compactColors, mergeUnpaintableRegions } from "./facets";
import { clusterImage } from "./kmeans";
import { placeLabels } from "./labels";
import { refinePaletteFromPixels, remapIndicesByArea } from "./palette";
import type { ProcessResult, ProgressUpdate, Settings } from "./types";

function resizePixels(
  data: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = sx - x0;
      const o = (y * dstW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const p00 = data[(y0 * srcW + x0) * 4 + c];
        const p10 = data[(y0 * srcW + x1) * 4 + c];
        const p01 = data[(y1 * srcW + x0) * 4 + c];
        const p11 = data[(y1 * srcW + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bot = p01 + (p11 - p01) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

export function processPaintByNumber(
  image: { data: Uint8ClampedArray; width: number; height: number },
  settings: Settings,
  onProgress?: (update: ProgressUpdate) => void,
): ProcessResult {
  const report = (stage: string, progress: number, detail?: string) => {
    onProgress?.({ stage, progress, detail });
  };

  report("Preparing photo", 0.05);
  let { data, width, height } = image;
  const longest = Math.max(width, height);
  if (longest > settings.maxDimension) {
    const scale = settings.maxDimension / longest;
    const nextW = Math.max(1, Math.round(width * scale));
    const nextH = Math.max(1, Math.round(height * scale));
    data = resizePixels(data, width, height, nextW, nextH);
    width = nextW;
    height = nextH;
  }

  // Kept unblurred so the final palette can be measured against the real photo.
  const sourcePixels = data;
  let clusterInput = data;
  if (settings.softenEdges) {
    report("Softening camera edges", 0.12, "Hides muddy JPEG pixels that become fake outline colors");
    clusterInput = boxBlur(data, width, height);
  }
  for (let pass = 0; pass < settings.textureSmoothing; pass++) {
    report("Smoothing texture", 0.15, "Flattening brush strokes and grain so they do not become specks");
    clusterInput = boxBlur(clusterInput, width, height);
  }

  report("Choosing paint colors", 0.25, `Grouping the photo into ${settings.maxColors} colors`);
  const clustered = clusterImage(
    clusterInput,
    width,
    height,
    settings.maxColors,
    settings.colorSpace,
    settings.clusterPrecision,
    settings.randomSeed,
  );
  const indices = clustered.indices;
  let palette = clustered.palette;

  if (settings.removeHalos) {
    report("Removing color halos", 0.55, "Clearing thin wrong-color outlines around skies and other large areas");
    removeColorHalos(indices, width, height, palette);
    majorityFilter(indices, width, height, 1);
  }

  // Relative to picture area so the same setting behaves the same on a small
  // thumbnail and a large photo.
  const minPixels = Math.max(8, Math.round((width * height * settings.minRegionAreaBp) / 10000));
  report("Simplifying tiny shapes", 0.7, `Merging shapes smaller than ${minPixels}px`);
  mergeUnpaintableRegions(indices, width, height, minPixels, settings.maxRegions, 1, palette);

  report("Measuring paint colors", 0.82, "Averaging the real photo pixels behind each number");
  const compacted = compactColors(indices, palette);
  const refined = refinePaletteFromPixels(
    compacted.indices,
    sourcePixels,
    compacted.palette.length,
    settings.vividness,
  );
  const remapped = remapIndicesByArea(compacted.indices, refined.colors, refined.counts);

  report("Placing numbers", 0.88);
  const regionMap = buildRegions(remapped.indices, width, height);
  const facets = placeLabels(remapped.indices, width, height, regionMap);

  report("Smoothing edges", 0.94, "Tracing rounded outlines instead of pixel staircases");
  const outlines = buildFacetOutlines(regionMap, settings.edgeSmoothing);
  for (const facet of facets) facet.outlines = outlines[facet.id] ?? [];

  report("Done", 1);
  return {
    width,
    height,
    indices: remapped.indices,
    palette: remapped.palette,
    facets,
  };
}
