import { rgbDistance } from "./color";
import type { RGB } from "./types";

export interface Region {
  id: number;
  colorIndex: number;
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  perimeter: number;
  neighborBorder: Map<number, number>;
}

export interface FacetMap {
  width: number;
  height: number;
  facetMap: Int32Array;
  regions: Region[];
}

export function buildRegions(indices: Uint8Array, width: number, height: number): FacetMap {
  const facetMap = new Int32Array(width * height).fill(-1);
  const regions: Region[] = [];
  const stack = new Int32Array(width * height);

  for (let start = 0; start < width * height; start++) {
    if (facetMap[start] !== -1) continue;
    const color = indices[start];
    const id = regions.length;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let perimeter = 0;
    let sp = 0;
    stack[sp++] = start;
    facetMap[start] = id;

    while (sp > 0) {
      const p = stack[--sp];
      const x = p % width;
      const y = (p / width) | 0;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const right = x + 1 < width ? p + 1 : -1;
      const left = x > 0 ? p - 1 : -1;
      const down = y + 1 < height ? p + width : -1;
      const up = y > 0 ? p - width : -1;
      const neighbors = [right, left, down, up];
      for (const n of neighbors) {
        if (n < 0) {
          perimeter++;
          continue;
        }
        if (indices[n] !== color) {
          perimeter++;
          continue;
        }
        if (facetMap[n] === -1) {
          facetMap[n] = id;
          stack[sp++] = n;
        }
      }
    }

    regions.push({
      id,
      colorIndex: color,
      pixelCount: count,
      minX,
      minY,
      maxX,
      maxY,
      perimeter,
      neighborBorder: new Map(),
    });
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const a = facetMap[p];
      if (x + 1 < width) {
        const b = facetMap[p + 1];
        if (a !== b) {
          bump(regions[a].neighborBorder, b);
          bump(regions[b].neighborBorder, a);
        }
      }
      if (y + 1 < height) {
        const b = facetMap[p + width];
        if (a !== b) {
          bump(regions[a].neighborBorder, b);
          bump(regions[b].neighborBorder, a);
        }
      }
    }
  }

  return { width, height, facetMap, regions };
}

function bump(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function squareFits(facetMap: Int32Array, width: number, id: number, x: number, y: number, r: number): boolean {
  if (facetMap[y * width + x] !== id) return false;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (facetMap[(y + dy) * width + (x + dx)] !== id) return false;
    }
  }
  return true;
}

/** True when a solid (2r+1)² block of the region exists, i.e. it is not a sliver. */
function hasThickness(region: Region, facetMap: Int32Array, width: number, minRadius: number): boolean {
  const bw = region.maxX - region.minX + 1;
  const bh = region.maxY - region.minY + 1;
  const r = minRadius;
  if (Math.min(bw, bh) < r * 2 + 1) return false;

  const cx = Math.round((region.minX + region.maxX) / 2);
  const cy = Math.round((region.minY + region.maxY) / 2);
  if (
    cx - r >= region.minX &&
    cx + r <= region.maxX &&
    cy - r >= region.minY &&
    cy + r <= region.maxY &&
    squareFits(facetMap, width, region.id, cx, cy, r)
  ) {
    return true;
  }

  const stride = Math.min(bw, bh) > 48 ? 2 : 1;
  for (let y = region.minY + r; y <= region.maxY - r; y += stride) {
    for (let x = region.minX + r; x <= region.maxX - r; x += stride) {
      if (squareFits(facetMap, width, region.id, x, y, r)) return true;
    }
  }
  return false;
}

/**
 * Only genuine specks and 1px slivers are merged. Elongated shapes are kept: a
 * tree trunk or branch is long and narrow by nature, and merging it repaints it
 * with a neighbour's color. Numbers that do not fit are drawn smaller instead.
 */
function needsMerge(
  region: Region,
  facetMap: Int32Array,
  width: number,
  minPixels: number,
  minThickness: number,
): boolean {
  if (region.pixelCount < minPixels) return true;
  return !hasThickness(region, facetMap, width, minThickness);
}

/**
 * Merging replaces detail with a neighbour's paint, so the target is scored on
 * shared border length damped by how different the two paints look. Otherwise a
 * dark pupil surrounded by skin gets repainted as skin.
 */
function pickMergeTarget(victim: Region, regions: Region[], mergedIds: Set<number>, palette?: RGB[]): number {
  let best = -1;
  let bestScore = -1;
  for (const [nid, shared] of victim.neighborBorder) {
    const neighbor = regions[nid];
    if (!neighbor || neighbor.pixelCount <= 0) continue;
    if (mergedIds.has(nid)) continue;
    let score = shared;
    if (palette) {
      const distance = rgbDistance(palette[victim.colorIndex], palette[neighbor.colorIndex]);
      score = shared / (1 + distance / 48);
    }
    if (score > bestScore) {
      bestScore = score;
      best = nid;
    }
  }
  return best;
}

export function mergeUnpaintableRegions(
  indices: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
  maxRegions: number,
  minThickness = 1,
  palette?: RGB[],
): void {
  for (let pass = 0; pass < 12; pass++) {
    const { facetMap, regions } = buildRegions(indices, width, height);
    const live = regions.filter((r) => r.pixelCount > 0);
    const unpaintableIds = new Set<number>();
    for (const region of live) {
      if (needsMerge(region, facetMap, width, minPixels, minThickness)) unpaintableIds.add(region.id);
    }

    let overBudget = Math.max(0, live.length - unpaintableIds.size - maxRegions);
    if (unpaintableIds.size === 0 && overBudget === 0) break;

    const victims = live
      .filter((r) => unpaintableIds.has(r.id) || overBudget > 0)
      .sort((a, b) => a.pixelCount - b.pixelCount);

    const mergedIds = new Set<number>();
    for (const victim of victims) {
      const unpaintable = unpaintableIds.has(victim.id);
      if (!unpaintable) {
        if (overBudget <= 0) continue;
        overBudget--;
      }

      const target = pickMergeTarget(victim, regions, mergedIds, palette);
      if (target < 0) continue;

      const newColor = regions[target].colorIndex;
      for (let y = victim.minY; y <= victim.maxY; y++) {
        for (let x = victim.minX; x <= victim.maxX; x++) {
          const p = y * width + x;
          if (facetMap[p] === victim.id) indices[p] = newColor;
        }
      }
      mergedIds.add(victim.id);
    }

    if (mergedIds.size === 0) break;
  }
}

export function compactColors(indices: Uint8Array, palette: [number, number, number][]): {
  indices: Uint8Array;
  palette: [number, number, number][];
  counts: number[];
} {
  const used = new Map<number, number>();
  const newPalette: [number, number, number][] = [];
  const counts: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i];
    let mapped = used.get(old);
    if (mapped === undefined) {
      mapped = newPalette.length;
      used.set(old, mapped);
      newPalette.push(palette[old]);
      counts.push(0);
    }
    indices[i] = mapped;
    counts[mapped]++;
  }
  return { indices, palette: newPalette, counts };
}
