import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [a, b, out, xs, ys, ws, hs] = process.argv.slice(2);
const x0 = Number(xs);
const y0 = Number(ys);
const w = Number(ws);
const h = Number(hs);

const left = PNG.sync.read(readFileSync(a));
const right = PNG.sync.read(readFileSync(b));
const gap = 12;
const png = new PNG({ width: w * 2 + gap, height: h });

const copy = (src: PNG, dx: number) => {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * src.width + (x + x0)) * 4;
      const d = (y * png.width + (x + dx)) * 4;
      png.data[d] = src.data[s];
      png.data[d + 1] = src.data[s + 1];
      png.data[d + 2] = src.data[s + 2];
      png.data[d + 3] = 255;
    }
  }
};

copy(left, 0);
copy(right, w + gap);
writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out} (${png.width}x${png.height})`);
