import { removeColorHalos } from "./cleanup";
import type { RGB } from "./types";

/** Synthetic blue-sky / brown-ground image with a muddy horizon row. */
export function haloCleanupRemovesMuddyHorizon(): boolean {
  const width = 40;
  const height = 24;
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < 11) indices[y * width + x] = 0;
      else if (y === 11) indices[y * width + x] = 2;
      else indices[y * width + x] = 1;
    }
  }
  const palette: RGB[] = [
    [80, 160, 220],
    [122, 78, 48],
    [132, 108, 86],
  ];
  removeColorHalos(indices, width, height, palette, 3);
  for (let x = 0; x < width; x++) {
    if (indices[11 * width + x] === 2) return false;
  }
  return true;
}
