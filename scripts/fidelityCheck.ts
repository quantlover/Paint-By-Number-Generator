import { processPaintByNumber } from "../src/engine/pipeline";
import type { Settings } from "../src/engine/types";
import { defaultSettings } from "../src/engine/types";

const W = 400;
const H = 300;

function makeFace() {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, rgb: [number, number, number]) => {
    const o = (y * W + x) * 4;
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      put(x, y, y < 120 ? [110, 175, 225] : [95, 140, 80]);
    }
  }
  // head
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - 200) / 70;
      const dy = (y - 150) / 90;
      if (dx * dx + dy * dy < 1) put(x, y, [225, 190, 160]);
    }
  }
  const disc = (cx: number, cy: number, r: number, rgb: [number, number, number]) => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, rgb);
      }
    }
  };
  disc(175, 130, 5, [35, 30, 30]); // left eye
  disc(225, 130, 5, [35, 30, 30]); // right eye
  for (let x = 180; x < 220; x++) for (let y = 190; y < 195; y++) put(x, y, [160, 70, 70]); // mouth
  return { data, width: W, height: H };
}

function darkPixelsIn(indices: Uint8Array, palette: { rgb: [number, number, number] }[], box: number[]) {
  const [x0, y0, x1, y1] = box;
  let dark = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rgb = palette[indices[y * W + x]].rgb;
      if (rgb[0] + rgb[1] + rgb[2] < 330) dark++;
    }
  }
  return dark;
}

function meanError(image: { data: Uint8ClampedArray }, indices: Uint8Array, palette: { rgb: [number, number, number] }[]) {
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    const rgb = palette[indices[i]].rgb;
    sum += Math.abs(image.data[i * 4] - rgb[0]) + Math.abs(image.data[i * 4 + 1] - rgb[1]) + Math.abs(image.data[i * 4 + 2] - rgb[2]);
  }
  return sum / (W * H * 3);
}

/** How far each paint sits from the average of the photo pixels it covers. */
function paletteDrift(
  image: { data: Uint8ClampedArray },
  indices: Uint8Array,
  palette: { rgb: [number, number, number] }[],
) {
  const sums = palette.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < indices.length; i++) {
    const s = sums[indices[i]];
    s[0] += image.data[i * 4];
    s[1] += image.data[i * 4 + 1];
    s[2] += image.data[i * 4 + 2];
    s[3]++;
  }
  let worst = 0;
  sums.forEach((s, c) => {
    if (s[3] === 0) return;
    const d = Math.hypot(
      s[0] / s[3] - palette[c].rgb[0],
      s[1] / s[3] - palette[c].rgb[1],
      s[2] / s[3] - palette[c].rgb[2],
    );
    if (d > worst) worst = d;
  });
  return worst;
}

function run(name: string, settings: Settings) {
  const image = makeFace();
  const t0 = Date.now();
  const result = processPaintByNumber({ ...image, data: new Uint8ClampedArray(image.data) }, settings);
  const scaleX = result.width / W;
  const eyesL = darkPixelsIn(
    result.indices,
    result.palette,
    [Math.round(165 * scaleX), Math.round(120 * scaleX), Math.round(185 * scaleX), Math.round(140 * scaleX)],
  );
  const eyesR = darkPixelsIn(
    result.indices,
    result.palette,
    [Math.round(215 * scaleX), Math.round(120 * scaleX), Math.round(235 * scaleX), Math.round(140 * scaleX)],
  );
  console.log(
    `${name}: shapes=${result.facets.length} colors=${result.palette.length} leftEyeDark=${eyesL} rightEyeDark=${eyesR} err=${meanError(image, result.indices, result.palette).toFixed(1)} worstPaletteDrift=${paletteDrift(image, result.indices, result.palette).toFixed(1)} ms=${Date.now() - t0}`,
  );
}

const oldish: Settings = { ...defaultSettings, minRegionAreaBp: 15, maxRegions: 400, printScale: 5 };
run("aggressive     ", oldish);
run("default(new)   ", defaultSettings);
