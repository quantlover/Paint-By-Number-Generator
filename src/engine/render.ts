import type { Facet, PaletteColor, ProcessResult, RGB } from "./types";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create PNG"));
    }, "image/png");
  });
}

export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  downloadBlob(await canvasToPngBlob(canvas), filename);
}

function traceOutlines(ctx: CanvasRenderingContext2D, loops: number[][], scale: number): void {
  for (const loop of loops) {
    const count = loop.length / 2;
    if (count < 3) continue;
    ctx.moveTo(loop[0] * scale, loop[1] * scale);
    for (let i = 1; i < count; i++) ctx.lineTo(loop[i * 2] * scale, loop[i * 2 + 1] * scale);
    ctx.closePath();
  }
}

/** True when the result predates outline tracing, so pixel edges are the only option. */
function hasOutlines(result: ProcessResult): boolean {
  return result.facets.some((facet) => facet.outlines.length > 0);
}

function strokePixelEdges(ctx: CanvasRenderingContext2D, result: ProcessResult, scale: number): void {
  const { indices, width: w, height: h } = result;
  ctx.beginPath();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = indices[y * w + x];
      if (x + 1 < w && indices[y * w + x + 1] !== color) {
        const px = (x + 1) * scale;
        ctx.moveTo(px, y * scale);
        ctx.lineTo(px, (y + 1) * scale);
      }
      if (y + 1 < h && indices[(y + 1) * w + x] !== color) {
        const py = (y + 1) * scale;
        ctx.moveTo(x * scale, py);
        ctx.lineTo((x + 1) * scale, py);
      }
    }
  }
  ctx.stroke();
}

export function renderWorksheet(result: ProcessResult, scale: number, numberPx = 15): HTMLCanvasElement {
  const width = result.width * scale;
  const height = result.height * scale;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#222222";
  ctx.lineWidth = Math.max(1.5, scale * 0.5);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.rect(0.5, 0.5, width - 1, height - 1);
  ctx.stroke();

  if (hasOutlines(result)) {
    ctx.beginPath();
    for (const facet of result.facets) traceOutlines(ctx, facet.outlines, scale);
    ctx.stroke();
  } else {
    strokePixelEdges(ctx, result, scale);
  }

  drawLabels(ctx, result.facets, result.palette, scale, "#111111", true, numberPx);
  return canvas;
}

export function renderCompleted(
  result: ProcessResult,
  scale: number,
  showNumbers = false,
  numberPx = 15,
): HTMLCanvasElement {
  const width = result.width * scale;
  const height = result.height * scale;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const { indices, palette, width: w, height: h } = result;

  // Blocky base first: smoothed outlines shrink each shape by a fraction of a
  // pixel, and this keeps those seams filled with the neighbouring color instead
  // of showing through as cracks.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = palette[indices[y * w + x]].rgb;
      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  if (hasOutlines(result)) {
    // Largest first, so a shape nested inside another paints over its parent.
    const ordered = [...result.facets].sort((a, b) => b.pixelCount - a.pixelCount);
    for (const facet of ordered) {
      if (facet.outlines.length === 0) continue;
      const color = palette[facet.colorIndex].rgb;
      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      ctx.beginPath();
      traceOutlines(ctx, facet.outlines, scale);
      ctx.fill();
    }
  }

  if (showNumbers) {
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, scale * 0.2);
    ctx.lineJoin = "round";
    if (hasOutlines(result)) {
      ctx.beginPath();
      for (const facet of result.facets) traceOutlines(ctx, facet.outlines, scale);
      ctx.stroke();
    } else {
      strokePixelEdges(ctx, result, scale);
    }
    drawLabels(ctx, result.facets, palette, scale, "#111111", false, numberPx);
  }

  return canvas;
}

function contrastText(rgb: RGB): string {
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return luminance > 0.55 ? "#1a1a1a" : "#ffffff";
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  facets: Facet[],
  palette: PaletteColor[],
  scale: number,
  fallback: string,
  worksheet: boolean,
  numberPx: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  const maxFont = numberPx * 2.2;
  // Narrow shapes such as tree trunks are kept rather than merged, so their
  // number is allowed to shrink below the target instead of disappearing.
  const minFont = Math.max(9, numberPx * 0.5);
  for (const facet of facets) {
    const number = String(palette[facet.colorIndex].number);
    // Diameter of the largest circle inside the shape, in printed pixels. A digit
    // box is about 0.58em wide and 0.72em tall, so it fits when its diagonal
    // stays within that circle.
    const room = Math.max(facet.labelRadius, 0.7) * 2 * scale;
    const digits = number.length;
    const fitted = room / Math.sqrt(0.3364 * digits * digits + 0.5184);
    const fontSize = Math.min(maxFont, Math.max(minFont, fitted));
    ctx.font = `700 ${fontSize}px Arial, "Helvetica Neue", sans-serif`;
    const x = facet.labelX * scale;
    const y = facet.labelY * scale;
    ctx.lineWidth = Math.max(2, fontSize * 0.26);
    ctx.strokeStyle = worksheet ? "#ffffff" : "rgba(255,255,255,0.85)";
    ctx.strokeText(number, x, y);
    ctx.fillStyle = worksheet ? fallback : "#111111";
    ctx.fillText(number, x, y);
  }
}

export function renderPalette(palette: PaletteColor[]): HTMLCanvasElement {
  const columns = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(palette.length))));
  const rows = Math.ceil(palette.length / columns);
  const cellW = 280;
  const cellH = 168;
  const margin = 36;
  const header = 92;
  const canvas = document.createElement("canvas");
  canvas.width = margin * 2 + columns * cellW;
  canvas.height = margin * 2 + header + rows * cellH;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#f7f1e6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1f2a24";
  ctx.font = '700 36px "Fraunces", serif';
  ctx.fillText("Paint by Number palette", margin, margin + 36);
  ctx.font = '500 16px "Source Sans 3", sans-serif';
  ctx.fillStyle = "#5c675f";
  ctx.fillText("Match each number on the worksheet to these RGB mix values.", margin, margin + 64);

  palette.forEach((color, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = margin + col * cellW;
    const y = margin + header + row * cellH;
    const swatchW = 84;
    const swatchH = 84;
    ctx.fillStyle = `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
    ctx.fillRect(x, y, swatchW, swatchH);
    ctx.strokeStyle = "#cbbfaa";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, swatchW, swatchH);

    ctx.fillStyle = contrastText(color.rgb);
    ctx.font = '700 28px "Source Sans 3", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(color.number), x + swatchW / 2, y + swatchH / 2);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#1f2a24";
    ctx.font = '700 22px "Source Sans 3", sans-serif';
    ctx.fillText(`Color ${color.number}`, x + swatchW + 16, y + 28);
    ctx.font = '500 16px "Source Sans 3", sans-serif';
    ctx.fillStyle = "#3f4a43";
    ctx.fillText(`RGB  ${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]}`, x + swatchW + 16, y + 52);
    ctx.fillText(`HEX  ${color.hex}`, x + swatchW + 16, y + 74);
    ctx.fillStyle = "#6b756e";
    ctx.fillText(`${color.percent.toFixed(1)}% of the painting`, x + swatchW + 16, y + 96);
  });

  return canvas;
}

