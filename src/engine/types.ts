export type RGB = [number, number, number];
export type ColorSpace = "lab" | "rgb" | "hsl";

export interface Settings {
  maxColors: number;
  colorSpace: ColorSpace;
  clusterPrecision: number;
  randomSeed: number;
  maxDimension: number;
  softenEdges: boolean;
  textureSmoothing: number;
  removeHalos: boolean;
  vividness: number;
  /** Smallest shape to keep, in basis points of the picture area (1 = 0.01%). */
  minRegionAreaBp: number;
  numberSizePx: number;
  maxRegions: number;
  printScale: number;
  edgeSmoothing: number;
}

export const defaultSettings: Settings = {
  maxColors: 24,
  colorSpace: "lab",
  clusterPrecision: 1,
  randomSeed: 1,
  maxDimension: 800,
  softenEdges: true,
  textureSmoothing: 2,
  removeHalos: true,
  vividness: 1,
  minRegionAreaBp: 2,
  numberSizePx: 30,
  maxRegions: 900,
  printScale: 6,
  edgeSmoothing: 2,
};

export interface PaletteColor {
  number: number;
  rgb: RGB;
  hex: string;
  pixelCount: number;
  percent: number;
}

export interface Facet {
  id: number;
  colorIndex: number;
  pixelCount: number;
  labelX: number;
  labelY: number;
  labelRadius: number;
  /** Smoothed outline loops, each a flat [x0, y0, x1, y1, ...] point list. */
  outlines: number[][];
}

export interface ProcessResult {
  width: number;
  height: number;
  indices: Uint8Array;
  palette: PaletteColor[];
  facets: Facet[];
}

export interface ProgressUpdate {
  stage: string;
  progress: number;
  detail?: string;
}

export function hexFromRgb(rgb: RGB): string {
  return (
    "#" +
    rgb
      .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
