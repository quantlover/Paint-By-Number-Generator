import { rgbDistance } from "./color";
import type { RGB } from "./types";

function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

export function boxBlur(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const o = (yy * width + xx) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return out;
}

function markThinPixels(indices: Uint8Array, width: number, height: number, thin: Uint8Array): void {
  thin.fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cur = indices[idx(x, y, width)];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (indices[idx(xx, yy, width)] === cur) same++;
        }
      }

      const left = x > 0 ? indices[idx(x - 1, y, width)] : cur;
      const right = x + 1 < width ? indices[idx(x + 1, y, width)] : cur;
      const top = y > 0 ? indices[idx(x, y - 1, width)] : cur;
      const bottom = y + 1 < height ? indices[idx(x, y + 1, width)] : cur;
      const strip = (cur !== top && cur !== bottom) || (cur !== left && cur !== right);
      if (strip || same <= 3) thin[idx(x, y, width)] = 1;
    }
  }
}

/**
 * Mixed camera/JPEG pixels at color boundaries often become a muddy third
 * color (the classic brown ring around a blue sky). Thin pixels are reassigned
 * to the most common nearby *interior* color, not the closest RGB mix.
 */
export function removeColorHalos(indices: Uint8Array, width: number, height: number, palette: RGB[], rounds = 3): void {
  const thin = new Uint8Array(width * height);
  const next = new Uint8Array(indices.length);
  const colorCount = palette.length;
  const counts = new Uint16Array(Math.max(colorCount, 1));

  for (let round = 0; round < rounds; round++) {
    markThinPixels(indices, width, height, thin);
    next.set(indices);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = idx(x, y, width);
        if (!thin[i]) continue;

        counts.fill(0);
        let interiorVotes = 0;
        const radius = 3;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const j = idx(xx, yy, width);
            if (thin[j]) continue;
            counts[indices[j]]++;
            interiorVotes++;
          }
        }

        if (interiorVotes === 0) {
          for (let dy = -radius; dy <= radius; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= height) continue;
            for (let dx = -radius; dx <= radius; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= width) continue;
              counts[indices[idx(xx, yy, width)]]++;
            }
          }
        }

        let best = indices[i];
        let bestCount = -1;
        for (let c = 0; c < colorCount; c++) {
          if (counts[c] > bestCount) {
            bestCount = counts[c];
            best = c;
          }
        }
        if (bestCount > 0) next[i] = best;
      }
    }
    indices.set(next);
  }

  // Classic 1px strip cleanup as a last pass, preferring the larger interior.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y, width);
      const cur = indices[i];
      const top = indices[idx(x, y - 1, width)];
      const bottom = indices[idx(x, y + 1, width)];
      const left = indices[idx(x - 1, y, width)];
      const right = indices[idx(x + 1, y, width)];
      if (cur !== top && cur !== bottom) {
        indices[i] = top === bottom ? top : majorityOrCloser(top, bottom, cur, palette, indices, x, y, width, height);
      } else if (cur !== left && cur !== right) {
        indices[i] = left === right ? left : majorityOrCloser(left, right, cur, palette, indices, x, y, width, height);
      }
    }
  }
}

function majorityOrCloser(
  a: number,
  b: number,
  cur: number,
  palette: RGB[],
  indices: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let aCount = 0;
  let bCount = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      const v = indices[idx(xx, yy, width)];
      if (v === a) aCount++;
      else if (v === b) bCount++;
    }
  }
  if (aCount !== bCount) return aCount > bCount ? a : b;
  const da = rgbDistance(palette[cur], palette[a]);
  const db = rgbDistance(palette[cur], palette[b]);
  return da <= db ? a : b;
}

export function majorityFilter(indices: Uint8Array, width: number, height: number, rounds = 1): void {
  const next = new Uint8Array(indices.length);
  const neighborhood = new Uint8Array(9);
  for (let round = 0; round < rounds; round++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            neighborhood[n++] = indices[idx(xx, yy, width)];
          }
        }
        let best = neighborhood[0];
        let bestCount = 0;
        for (let i = 0; i < n; i++) {
          const color = neighborhood[i];
          let count = 0;
          for (let j = 0; j < n; j++) if (neighborhood[j] === color) count++;
          if (count > bestCount) {
            bestCount = count;
            best = color;
          }
        }
        next[idx(x, y, width)] = best;
      }
    }
    indices.set(next);
  }
}
