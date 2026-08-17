import { hslToRgb, lab2rgb, rgb2lab, rgbToHsl } from "./color";
import { mulberry32 } from "./rng";
import type { ColorSpace, RGB } from "./types";

interface ColorBucket {
  rgb: RGB;
  values: [number, number, number];
  weight: number;
  pixels: number[];
}

function toClusterSpace(rgb: RGB, space: ColorSpace): [number, number, number] {
  if (space === "hsl") return rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (space === "lab") return rgb2lab(rgb);
  return [rgb[0], rgb[1], rgb[2]];
}

function fromClusterSpace(values: [number, number, number], space: ColorSpace): RGB {
  if (space === "hsl") return hslToRgb(values[0], values[1], values[2]);
  if (space === "lab") return lab2rgb(values);
  return [values[0], values[1], values[2]];
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  const d0 = a[0] - b[0];
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

export function clusterImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  k: number,
  colorSpace: ColorSpace,
  minDelta: number,
  seed: number,
): { indices: Uint8Array; palette: RGB[] } {
  const chop = 2;
  const buckets = new Map<string, ColorBucket>();
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const r = data[o] >> chop << chop;
    const g = data[o + 1] >> chop << chop;
    const b = data[o + 2] >> chop << chop;
    const key = `${r},${g},${b}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.pixels.push(i);
      existing.weight += 1;
    } else {
      const rgb: RGB = [r, g, b];
      buckets.set(key, {
        rgb,
        values: toClusterSpace(rgb, colorSpace),
        weight: 1,
        pixels: [i],
      });
    }
  }

  const samples = Array.from(buckets.values());
  for (const sample of samples) sample.weight /= pixelCount;

  const clusterCount = Math.max(1, Math.min(k, samples.length));
  const random = mulberry32(seed || 1);
  const centroids: [number, number, number][] = [];

  let first = Math.floor(random() * samples.length);
  centroids.push([...samples[first].values] as [number, number, number]);

  const closest = new Float64Array(samples.length);
  for (let c = 1; c < clusterCount; c++) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const d = dist2(samples[i].values, centroids[c - 1]);
      closest[i] = c === 1 ? d : Math.min(closest[i], d);
      sum += closest[i] * samples[i].weight;
    }
    let pick = random() * sum;
    let chosen = samples.length - 1;
    for (let i = 0; i < samples.length; i++) {
      pick -= closest[i] * samples[i].weight;
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push([...samples[chosen].values] as [number, number, number]);
  }

  const assignment = new Uint8Array(samples.length);
  let delta = Infinity;
  const maxIter = 40;

  for (let iter = 0; iter < maxIter && delta > minDelta; iter++) {
    const sums = Array.from({ length: clusterCount }, () => [0, 0, 0, 0] as [number, number, number, number]);

    for (let i = 0; i < samples.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < clusterCount; c++) {
        const d = dist2(samples[i].values, centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assignment[i] = best;
      const w = samples[i].weight;
      sums[best][0] += samples[i].values[0] * w;
      sums[best][1] += samples[i].values[1] * w;
      sums[best][2] += samples[i].values[2] * w;
      sums[best][3] += w;
    }

    delta = 0;
    for (let c = 0; c < clusterCount; c++) {
      if (sums[c][3] === 0) {
        const rescue = samples[Math.floor(random() * samples.length)].values;
        centroids[c] = [...rescue] as [number, number, number];
        continue;
      }
      const next: [number, number, number] = [
        sums[c][0] / sums[c][3],
        sums[c][1] / sums[c][3],
        sums[c][2] / sums[c][3],
      ];
      delta += Math.sqrt(dist2(centroids[c], next));
      centroids[c] = next;
    }
  }

  const palette: RGB[] = centroids.map((centroid) => {
    const rgb = fromClusterSpace(centroid, colorSpace);
    return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
  });

  const unique = new Map<string, number>();
  const compactPalette: RGB[] = [];
  const remap = new Uint8Array(palette.length);
  for (let c = 0; c < palette.length; c++) {
    const key = palette[c].join(",");
    const existing = unique.get(key);
    if (existing === undefined) {
      remap[c] = compactPalette.length;
      unique.set(key, compactPalette.length);
      compactPalette.push(palette[c]);
    } else {
      remap[c] = existing;
    }
  }

  const indices = new Uint8Array(pixelCount);
  for (let i = 0; i < samples.length; i++) {
    const colorIndex = remap[assignment[i]];
    for (const pixel of samples[i].pixels) indices[pixel] = colorIndex;
  }

  return { indices, palette: compactPalette };
}
