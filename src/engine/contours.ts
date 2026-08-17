import type { FacetMap, Region } from "./facets";

/** Flat list of points: [x0, y0, x1, y1, ...] in working-image coordinates. */
export type Loop = number[];

interface Chain {
  points: Loop;
  closed: boolean;
}

export function signedArea(points: Loop): number {
  const count = points.length / 2;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    sum += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1];
  }
  return sum / 2;
}

/**
 * Walks the unit edges between a region and everything else, then links them
 * into closed loops. Holes come out as separate loops wound opposite to the
 * outer loop, so filling with the nonzero rule leaves them empty.
 */
export function traceRegionLoops(map: FacetMap, region: Region): Loop[] {
  const { facetMap, width, height } = map;
  const stride = width + 1;
  const outgoing = new Map<number, number[]>();

  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const from = ay * stride + ax;
    const to = by * stride + bx;
    const list = outgoing.get(from);
    if (list) list.push(to);
    else outgoing.set(from, [to]);
  };

  const outside = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height || facetMap[y * width + x] !== region.id;

  for (let y = region.minY; y <= region.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      if (facetMap[y * width + x] !== region.id) continue;
      // Clockwise in screen coordinates, where y grows downward.
      if (outside(x, y - 1)) addEdge(x, y, x + 1, y);
      if (outside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (outside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (outside(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const loops: Loop[] = [];
  for (const startKey of Array.from(outgoing.keys())) {
    while ((outgoing.get(startKey)?.length ?? 0) > 0) {
      const loop: Loop = [];
      let current = startKey;
      while (true) {
        const list = outgoing.get(current);
        if (!list || list.length === 0) break;
        const next = list.pop()!;
        if (list.length === 0) outgoing.delete(current);
        loop.push(current % stride, Math.floor(current / stride));
        current = next;
        if (current === startKey) break;
      }
      if (loop.length >= 6) loops.push(loop);
    }
  }

  return loops;
}

/**
 * Chaikin corner cutting. Each pass replaces every corner with two points a
 * quarter of the way along its edges, turning sharp turns into curves. Open
 * polylines keep their end points so shared borders stay joined.
 */
export function smoothLoop(points: Loop, iterations: number, closed = true): Loop {
  let current = points;
  for (let pass = 0; pass < iterations; pass++) {
    const count = current.length / 2;
    if (count < 3) break;
    const next: Loop = [];
    if (!closed) next.push(current[0], current[1]);
    const edges = closed ? count : count - 1;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % count;
      const x0 = current[i * 2];
      const y0 = current[i * 2 + 1];
      const x1 = current[j * 2];
      const y1 = current[j * 2 + 1];
      next.push(x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25);
      next.push(x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75);
    }
    if (!closed) next.push(current[(count - 1) * 2], current[(count - 1) * 2 + 1]);
    current = next;
  }
  return current;
}

/**
 * Douglas-Peucker on an open polyline. This is what removes the staircase: a
 * run of single-pixel steps sits less than a pixel away from the straight line
 * through it, so the steps collapse while real corners survive.
 */
function simplifyOpen(points: Loop, tolerance: number): Loop {
  const count = points.length / 2;
  if (count < 3 || tolerance <= 0) return points;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: number[] = [0, count - 1];
  const toleranceSq = tolerance * tolerance;

  while (stack.length > 0) {
    const to = stack.pop()!;
    const from = stack.pop()!;
    if (to - from < 2) continue;
    const ax = points[from * 2];
    const ay = points[from * 2 + 1];
    const dx = points[to * 2] - ax;
    const dy = points[to * 2 + 1] - ay;
    const lengthSq = dx * dx + dy * dy;
    let worst = -1;
    let worstDistSq = -1;
    for (let i = from + 1; i < to; i++) {
      const px = points[i * 2] - ax;
      const py = points[i * 2 + 1] - ay;
      let distSq: number;
      if (lengthSq === 0) {
        distSq = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
        const ox = px - t * dx;
        const oy = py - t * dy;
        distSq = ox * ox + oy * oy;
      }
      if (distSq > worstDistSq) {
        worstDistSq = distSq;
        worst = i;
      }
    }
    if (worstDistSq > toleranceSq && worst > from) {
      keep[worst] = 1;
      stack.push(from, worst, worst, to);
    }
  }

  const out: Loop = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}

/** Split the ring in half so each half can be simplified as an open line. */
function simplifyClosed(points: Loop, tolerance: number): Loop {
  const count = points.length / 2;
  if (count < 8 || tolerance <= 0) return points;
  const half = count >> 1;
  const first = simplifyOpen(points.slice(0, (half + 1) * 2), tolerance);
  const second = simplifyOpen(points.slice(half * 2).concat(points.slice(0, 2)), tolerance);
  return first.concat(second.slice(2, second.length - 2));
}

function smoothingProfile(level: number): { tolerance: number; passes: number } {
  if (level <= 0) return { tolerance: 0, passes: 0 };
  return { tolerance: 0.35 + level * 0.45, passes: level >= 2 ? 3 : 2 };
}

interface ChainIndex {
  chains: Chain[];
  chainOfH: Int32Array;
  chainOfV: Int32Array;
  nodeStride: number;
}

/**
 * A chain is the stretch of border shared by the same two regions, running
 * between junctions where three or more regions meet. Smoothing each chain once
 * and giving the same points to both of its regions is what keeps neighbours
 * edge to edge instead of leaving cracks or overlaps.
 */
function buildChains(map: FacetMap, level: number): ChainIndex {
  const { facetMap, width, height } = map;
  const nodeStride = width + 1;
  const nodeRows = height + 1;
  const nodeCount = nodeStride * nodeRows;

  const labelAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : facetMap[y * width + x];
  // Horizontal segment (x,y)-(x+1,y) splits the pixels above and below it.
  const hSeg = (x: number, y: number) => x >= 0 && x < width && labelAt(x, y - 1) !== labelAt(x, y);
  // Vertical segment (x,y)-(x,y+1) splits the pixels left and right of it.
  const vSeg = (x: number, y: number) => y >= 0 && y < height && labelAt(x - 1, y) !== labelAt(x, y);

  const degree = (x: number, y: number) => {
    let d = 0;
    if (hSeg(x, y)) d++;
    if (hSeg(x - 1, y)) d++;
    if (vSeg(x, y)) d++;
    if (vSeg(x, y - 1)) d++;
    return d;
  };

  const chainOfH = new Int32Array(nodeCount).fill(-1);
  const chainOfV = new Int32Array(nodeCount).fill(-1);
  const chains: Chain[] = [];
  const { tolerance, passes } = smoothingProfile(level);

  const nextStep = (x: number, y: number): [number, number] | null => {
    if (hSeg(x, y) && chainOfH[y * nodeStride + x] === -1) return [x + 1, y];
    if (hSeg(x - 1, y) && chainOfH[y * nodeStride + x - 1] === -1) return [x - 1, y];
    if (vSeg(x, y) && chainOfV[y * nodeStride + x] === -1) return [x, y + 1];
    if (vSeg(x, y - 1) && chainOfV[(y - 1) * nodeStride + x] === -1) return [x, y - 1];
    return null;
  };

  const claim = (ax: number, ay: number, bx: number, by: number, chainId: number) => {
    if (ay === by) chainOfH[ay * nodeStride + Math.min(ax, bx)] = chainId;
    else chainOfV[Math.min(ay, by) * nodeStride + ax] = chainId;
  };

  const walk = (startX: number, startY: number, stopAtJunction: boolean) => {
    const chainId = chains.length;
    let x = startX;
    let y = startY;
    const points: Loop = [x, y];
    while (true) {
      const step = nextStep(x, y);
      if (!step) break;
      claim(x, y, step[0], step[1], chainId);
      x = step[0];
      y = step[1];
      points.push(x, y);
      if (x === startX && y === startY) break;
      if (stopAtJunction && degree(x, y) !== 2) break;
    }
    const closed = points.length > 2 && x === startX && y === startY;
    const raw = closed ? points.slice(0, points.length - 2) : points;
    const simplified = closed ? simplifyClosed(raw, tolerance) : simplifyOpen(raw, tolerance);
    chains.push({ points: smoothLoop(simplified, passes, closed), closed });
  };

  for (let y = 0; y < nodeRows; y++) {
    for (let x = 0; x < nodeStride; x++) {
      const d = degree(x, y);
      if (d === 0 || d === 2) continue;
      while (nextStep(x, y)) walk(x, y, true);
    }
  }
  // Whatever is left is a ring of degree-2 nodes, such as an island sitting
  // inside a single region with no junction anywhere along its border.
  for (let y = 0; y < nodeRows; y++) {
    for (let x = 0; x < nodeStride; x++) {
      while (nextStep(x, y)) walk(x, y, false);
    }
  }

  return { chains, chainOfH, chainOfV, nodeStride };
}

/**
 * Rebuilds one lattice loop out of the smoothed chains it runs along. A loop
 * always crosses a chain end to end, because chains only stop where three or
 * more regions meet.
 */
function stitchLoop(loop: Loop, index: ChainIndex): Loop {
  const { chains, chainOfH, chainOfV, nodeStride } = index;
  const count = loop.length / 2;
  const chainAt = (i: number) => {
    const j = (i + 1) % count;
    const ax = loop[i * 2];
    const ay = loop[i * 2 + 1];
    const bx = loop[j * 2];
    const by = loop[j * 2 + 1];
    if (ay === by) return chainOfH[ay * nodeStride + Math.min(ax, bx)];
    return chainOfV[Math.min(ay, by) * nodeStride + ax];
  };

  // Start where a chain starts, otherwise the first chain would be split across
  // the two ends of the sequence.
  let offset = 0;
  const firstChain = chainAt(0);
  for (let i = 1; i < count; i++) {
    if (chainAt(i) !== firstChain) {
      offset = i;
      break;
    }
  }

  const out: Loop = [];
  let consumed = 0;
  while (consumed < count) {
    const start = (consumed + offset) % count;
    const id = chainAt(start);
    let length = 1;
    while (consumed + length < count && chainAt((consumed + length + offset) % count) === id) length++;
    const chain = chains[id];

    if (!chain) {
      for (let k = 0; k < length; k++) {
        const at = (consumed + k + offset) % count;
        out.push(loop[at * 2], loop[at * 2 + 1]);
      }
    } else if (chain.closed) {
      // Rings are stored in an arbitrary direction; match this loop's winding so
      // holes stay wound against their outer loop.
      const forward = signedArea(chain.points) * signedArea(loop) >= 0;
      if (forward) {
        out.push(...chain.points);
      } else {
        for (let k = chain.points.length - 2; k >= 0; k -= 2) out.push(chain.points[k], chain.points[k + 1]);
      }
    } else {
      const points = chain.points;
      const startsHere =
        Math.abs(points[0] - loop[start * 2]) < 0.5 && Math.abs(points[1] - loop[start * 2 + 1]) < 0.5;
      if (startsHere) {
        for (let k = 0; k < points.length - 2; k += 2) out.push(points[k], points[k + 1]);
      } else {
        for (let k = points.length - 2; k >= 2; k -= 2) out.push(points[k], points[k + 1]);
      }
    }
    consumed += length;
  }

  return out.length >= 6 ? out : loop;
}

export function buildFacetOutlines(map: FacetMap, smoothing: number): Loop[][] {
  const raw = map.regions.map((region) => (region.pixelCount > 0 ? traceRegionLoops(map, region) : []));
  if (smoothing <= 0) return raw;
  const index = buildChains(map, smoothing);
  return raw.map((loops) => loops.map((loop) => stitchLoop(loop, index)));
}
