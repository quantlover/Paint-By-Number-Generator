export function createSampleLandscape(): ImageData {
  const width = 640;
  const height = 400;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const sky = ctx.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, "#6eb3e8");
  sky.addColorStop(1, "#9fd0f0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, 230);

  ctx.fillStyle = "#f4f1ea";
  roundedCloud(ctx, 90, 70, 70, 28);
  roundedCloud(ctx, 380, 50, 90, 32);
  roundedCloud(ctx, 500, 95, 60, 22);

  ctx.fillStyle = "#e8c15a";
  ctx.beginPath();
  ctx.arc(560, 58, 28, 0, Math.PI * 2);
  ctx.fill();

  // Intentional muddy blend at the horizon — this is what used to become a brown ring.
  const blend = ctx.createLinearGradient(0, 218, 0, 242);
  blend.addColorStop(0, "rgba(110, 179, 232, 0)");
  blend.addColorStop(0.45, "rgba(132, 108, 86, 0.85)");
  blend.addColorStop(1, "rgba(122, 78, 48, 1)");
  ctx.fillStyle = blend;
  ctx.fillRect(0, 218, width, 28);

  ctx.fillStyle = "#7a4e30";
  ctx.beginPath();
  ctx.moveTo(0, 248);
  ctx.lineTo(140, 180);
  ctx.lineTo(260, 250);
  ctx.lineTo(400, 160);
  ctx.lineTo(560, 240);
  ctx.lineTo(width, 200);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#5f8a4a";
  ctx.fillRect(0, 300, width, 100);
  ctx.fillStyle = "#4e743c";
  ctx.beginPath();
  ctx.ellipse(160, 340, 90, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(420, 350, 110, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3e5a32";
  ctx.fillRect(286, 250, 16, 70);
  ctx.fillStyle = "#4f7d3e";
  ctx.beginPath();
  ctx.moveTo(294, 180);
  ctx.lineTo(350, 270);
  ctx.lineTo(238, 270);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#d9d3c6";
  ctx.fillRect(70, 268, 70, 48);
  ctx.fillStyle = "#b23b2f";
  ctx.beginPath();
  ctx.moveTo(64, 268);
  ctx.lineTo(105, 232);
  ctx.lineTo(146, 268);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, width, height);
}

function roundedCloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.45, h, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.4, y - h * 0.2, w * 0.4, h * 0.9, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.75, y + h * 0.1, w * 0.38, h * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function imageDataFromFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read the image"));
        return;
      }
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be opened as an image"));
    };
    image.src = url;
  });
}

export function previewUrlFromImageData(data: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
