import type { Facet } from "./types";
import { buildRegions, type FacetMap } from "./facets";

export function placeLabels(indices: Uint8Array, width: number, height: number, prebuilt?: FacetMap): Facet[] {
  const map: FacetMap = prebuilt ?? buildRegions(indices, width, height);
  const facets: Facet[] = [];

  for (const region of map.regions) {
    const rw = region.maxX - region.minX + 1;
    const rh = region.maxY - region.minY + 1;
    const dt = new Float32Array(rw * rh);
    const INF = 1e9;

    for (let y = region.minY; y <= region.maxY; y++) {
      for (let x = region.minX; x <= region.maxX; x++) {
        const inside = map.facetMap[y * width + x] === region.id;
        const lx = x - region.minX;
        const ly = y - region.minY;
        if (!inside) {
          dt[ly * rw + lx] = 0;
          continue;
        }
        const border =
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          map.facetMap[y * width + (x - 1)] !== region.id ||
          map.facetMap[y * width + (x + 1)] !== region.id ||
          map.facetMap[(y - 1) * width + x] !== region.id ||
          map.facetMap[(y + 1) * width + x] !== region.id;
        dt[ly * rw + lx] = border ? 0 : INF;
      }
    }

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        if (dt[i] === 0) continue;
        let best = dt[i];
        if (x > 0) best = Math.min(best, dt[i - 1] + 1);
        if (y > 0) best = Math.min(best, dt[i - rw] + 1);
        if (x > 0 && y > 0) best = Math.min(best, dt[i - rw - 1] + 1.414);
        if (x + 1 < rw && y > 0) best = Math.min(best, dt[i - rw + 1] + 1.414);
        dt[i] = best;
      }
    }

    for (let y = rh - 1; y >= 0; y--) {
      for (let x = rw - 1; x >= 0; x--) {
        const i = y * rw + x;
        if (dt[i] === 0) continue;
        let best = dt[i];
        if (x + 1 < rw) best = Math.min(best, dt[i + 1] + 1);
        if (y + 1 < rh) best = Math.min(best, dt[i + rw] + 1);
        if (x + 1 < rw && y + 1 < rh) best = Math.min(best, dt[i + rw + 1] + 1.414);
        if (x > 0 && y + 1 < rh) best = Math.min(best, dt[i + rw - 1] + 1.414);
        dt[i] = best;
      }
    }

    let bestX = region.minX;
    let bestY = region.minY;
    let bestR = -1;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const r = dt[y * rw + x];
        if (r > bestR) {
          bestR = r;
          bestX = region.minX + x;
          bestY = region.minY + y;
        }
      }
    }

    facets.push({
      id: region.id,
      colorIndex: region.colorIndex,
      pixelCount: region.pixelCount,
      labelX: bestX + 0.5,
      labelY: bestY + 0.5,
      labelRadius: Math.max(0, bestR),
      outlines: [],
    });
  }

  return facets;
}
