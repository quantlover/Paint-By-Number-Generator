import { hslToRgb, lab2rgb, rgb2lab, rgbToHsl } from "./color";
import { hexFromRgb, type PaletteColor, type RGB } from "./types";

/**
 * The clustering centroids describe the blurred image before halos were removed
 * and small shapes merged, so they drift away from what each area finally
 * contains. Re-averaging the untouched source pixels per color keeps the paint
 * you mix matching the photo.
 */
export function refinePaletteFromPixels(
  indices: Uint8Array,
  source: Uint8ClampedArray,
  colorCount: number,
  vividness = 1,
): { colors: RGB[]; counts: number[] } {
  const sums = Array.from({ length: colorCount }, () => [0, 0, 0, 0]);

  for (let i = 0; i < indices.length; i++) {
    const bucket = sums[indices[i]];
    if (!bucket) continue;
    const o = i * 4;
    const lab = rgb2lab([source[o], source[o + 1], source[o + 2]]);
    bucket[0] += lab[0];
    bucket[1] += lab[1];
    bucket[2] += lab[2];
    bucket[3]++;
  }

  const colors: RGB[] = [];
  const counts: number[] = [];
  for (let c = 0; c < colorCount; c++) {
    const [l, a, b, n] = sums[c];
    counts.push(n);
    if (n === 0) {
      colors.push([0, 0, 0]);
      continue;
    }
    let rgb = lab2rgb([l / n, a / n, b / n]);
    if (vividness !== 1) {
      const [h, s, lightness] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      rgb = hslToRgb(h, Math.max(0, Math.min(1, s * vividness)), lightness);
    }
    colors.push([Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])]);
  }

  return { colors, counts };
}

export function remapIndicesByArea(
  indices: Uint8Array,
  colors: RGB[],
  counts: number[],
): { indices: Uint8Array; palette: PaletteColor[] } {
  const total = counts.reduce((sum, n) => sum + n, 0) || 1;
  const order = colors.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
  const remap = new Uint8Array(colors.length);
  const palette: PaletteColor[] = order.map((oldIndex, i) => {
    remap[oldIndex] = i;
    return {
      number: i + 1,
      rgb: colors[oldIndex],
      hex: hexFromRgb(colors[oldIndex]),
      pixelCount: counts[oldIndex],
      percent: (counts[oldIndex] / total) * 100,
    };
  });
  const next = new Uint8Array(indices.length);
  for (let i = 0; i < indices.length; i++) next[i] = remap[indices[i]];
  return { indices: next, palette };
}
