import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { createSampleLandscape, imageDataFromFile, previewUrlFromImageData } from "./engine/sample";
import { downloadCanvas, renderCompleted, renderPalette, renderWorksheet } from "./engine/render";
import { defaultSettings, type ProcessResult, type Settings } from "./engine/types";
import PaintWorker from "./worker/pbn.worker.ts?worker";

type Tab = "worksheet" | "finished" | "palette";

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [source, setSource] = useState<ImageData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [tab, setTab] = useState<Tab>("worksheet");
  const [zoom, setZoom] = useState<number | "fit">(100);
  const workerRef = useRef<Worker | null>(null);

  const canvases = useMemo(() => {
    if (!result) return null;
    return {
      worksheet: renderWorksheet(result, settings.printScale, settings.numberSizePx),
      finished: renderCompleted(result, settings.printScale),
      palette: renderPalette(result.palette),
    };
  }, [result, settings.printScale, settings.numberSizePx]);

  function setImage(data: ImageData) {
    setSource(data);
    setPreviewUrl(previewUrlFromImageData(data));
    setResult(null);
    setError(null);
  }

  async function onFile(file: File) {
    try {
      setImage(await imageDataFromFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that image");
    }
  }

  function generate() {
    if (!source) return;
    workerRef.current?.terminate();
    const worker = new PaintWorker();
    workerRef.current = worker;
    setBusy(true);
    setError(null);
    setStage("Starting");
    setProgress(0);

    const copy = new Uint8ClampedArray(source.data);
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === "progress") {
        setStage(data.detail ? `${data.stage} — ${data.detail}` : data.stage);
        setProgress(data.progress);
      } else if (data.type === "result") {
        setResult(data.result);
        setBusy(false);
        setStage("Ready to print");
        setProgress(1);
        worker.terminate();
      } else if (data.type === "error") {
        setError(data.message);
        setBusy(false);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      setError("The generator hit an unexpected error.");
      setBusy(false);
      worker.terminate();
    };
    worker.postMessage({ image: { data: copy, width: source.width, height: source.height }, settings }, [copy.buffer]);
  }

  async function downloadAll() {
    if (!canvases) return;
    await downloadCanvas(canvases.worksheet, "paint-by-number-worksheet.png");
    await downloadCanvas(canvases.finished, "paint-by-number-finished.png");
    await downloadCanvas(canvases.palette, "paint-by-number-palette.png");
  }

  return (
    <div className="app">
      <header className="hero">
        <h1>Paint by Number</h1>
        <p>
          Upload a photo, choose how many paints you want, and download a printable worksheet, the finished
          picture, and a numbered RGB palette. Thin muddy outlines — the brown line that often wraps a blue
          sky — are removed automatically.
        </p>
      </header>

      <div className="layout">
        <aside className="panel controls">
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void onFile(file);
            }}
          >
            {previewUrl ? <img className="preview-thumb" src={previewUrl} alt="Uploaded photo" /> : null}
            <p>Drop a photo here, or browse your computer.</p>
            <div className="row-actions">
              <label className="btn">
                Upload photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onFile(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setImage(createSampleLandscape())}
              >
                Try sample sky
              </button>
            </div>
          </div>

          <div className="field">
            <div className="field-head">
              <label htmlFor="maxColors">How many paint colors?</label>
              <span className="value">{settings.maxColors}</span>
            </div>
            <input
              id="maxColors"
              type="range"
              min={4}
              max={40}
              value={settings.maxColors}
              onChange={(event) => setSettings({ ...settings, maxColors: Number(event.target.value) })}
            />
            <p className="help">
              Maximum paints on your palette. Below about 18, dark details such as tree trunks have no dark
              paint to land on and get absorbed by the color around them. 20–28 keeps them; 30+ is detailed but
              slower to paint.
            </p>
          </div>

          <div className="field">
            <div className="field-head">
              <label htmlFor="vividness">Color vividness</label>
              <span className="value">{Math.round(settings.vividness * 100)}%</span>
            </div>
            <input
              id="vividness"
              type="range"
              min={60}
              max={160}
              step={5}
              value={Math.round(settings.vividness * 100)}
              onChange={(event) => setSettings({ ...settings, vividness: Number(event.target.value) / 100 })}
            />
            <p className="help">
              100% mixes the true average color of the photo behind each number. Averaging always looks a little
              duller than the original, so raise this if the paints feel washed out.
            </p>
          </div>

          <button type="button" className="btn primary" disabled={!source || busy} onClick={generate}>
            {busy ? "Generating…" : "Create paint-by-number"}
          </button>

          {busy || stage ? (
            <div className="status">
              {stage}
              <div className="progress-bar">
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </div>
          ) : null}

          {error ? <div className="error">{error}</div> : null}

          <details className="advanced">
            <summary>What each setting does</summary>
            <div className="advanced-body">
              <div className="field">
                <div className="field-head">
                  <span className="label">Working size</span>
                  <span className="value">{settings.maxDimension}px</span>
                </div>
                <input
                  type="range"
                  min={400}
                  max={1200}
                  step={50}
                  value={settings.maxDimension}
                  onChange={(event) => setSettings({ ...settings, maxDimension: Number(event.target.value) })}
                />
                <p className="help">
                  Large photos are shrunk to this longest side before coloring. Bigger keeps more detail and is
                  slower. The PNG you print is enlarged from this size, so 800px is usually plenty.
                </p>
              </div>

              <div className="field">
                <label htmlFor="colorSpace">How colors are grouped</label>
                <select
                  id="colorSpace"
                  value={settings.colorSpace}
                  onChange={(event) =>
                    setSettings({ ...settings, colorSpace: event.target.value as Settings["colorSpace"] })
                  }
                >
                  <option value="lab">Lab — recommended</option>
                  <option value="rgb">RGB — camera channels</option>
                  <option value="hsl">HSL — by hue</option>
                </select>
                <p className="help">
                  Lab is the default because a blue sky stays one blue instead of picking up brown from the
                  ground or from mixed pixels at the horizon. Try RGB if a specific hue matters more than
                  overall accuracy. HSL averages hues around the color wheel, so reds and purples can come out
                  wrong.
                </p>
              </div>

              <label className="field">
                <span className="label">
                  <input
                    type="checkbox"
                    checked={settings.softenEdges}
                    onChange={(event) => setSettings({ ...settings, softenEdges: event.target.checked })}
                  />{" "}
                  Soften camera edges first
                </span>
                <p className="help">
                  Photos and JPEGs create muddy in-between pixels where two colors meet. A light blur hides
                  those specks so they are less likely to become a fake extra paint color.
                </p>
              </label>

              <div className="field">
                <div className="field-head">
                  <span className="label">Texture smoothing</span>
                  <span className="value">{settings.textureSmoothing}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={settings.textureSmoothing}
                  onChange={(event) =>
                    setSettings({ ...settings, textureSmoothing: Number(event.target.value) })
                  }
                />
                <p className="help">
                  Flattens brush strokes, canvas grain, and photo noise before colors are chosen. Raise it for
                  paintings or grainy photos that produce thousands of confetti-like specks. Lower it for clean,
                  flat images.
                </p>
              </div>

              <label className="field">
                <span className="label">
                  <input
                    type="checkbox"
                    checked={settings.removeHalos}
                    onChange={(event) => setSettings({ ...settings, removeHalos: event.target.checked })}
                  />{" "}
                  Remove color halos
                </span>
                <p className="help">
                  Turns off the thin wrong-color outline that often appears around a sky, a face, or a building.
                  Those outlines are mixed edge pixels, not a real object in the photo.
                </p>
              </label>

              <div className="field">
                <div className="field-head">
                  <span className="label">Smallest paintable shape</span>
                  <span className="value">{(settings.minRegionAreaBp / 100).toFixed(2)}% of picture</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={settings.minRegionAreaBp}
                  onChange={(event) =>
                    setSettings({ ...settings, minRegionAreaBp: Number(event.target.value) })
                  }
                />
                <p className="help">
                  Shapes smaller than this share of the picture are merged into the neighboring paint. Measured
                  as a share, not pixels, so it behaves the same on small and large images. Low values keep eyes
                  and fine detail; raise it if the page has too many tiny islands to paint.
                </p>
              </div>

              <div className="field">
                <div className="field-head">
                  <span className="label">Number size on the print</span>
                  <span className="value">{settings.numberSizePx} px</span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={60}
                  step={2}
                  value={settings.numberSizePx}
                  onChange={(event) =>
                    setSettings({ ...settings, numberSizePx: Number(event.target.value) })
                  }
                />
                <p className="help">
                  Smallest height a digit is drawn at in the downloaded PNG. Bigger digits are easier to read;
                  because they are measured on the enlarged print, detail in the photo is kept either way.
                </p>
              </div>

              <div className="field">
                <div className="field-head">
                  <span className="label">Maximum number of shapes</span>
                  <span className="value">{settings.maxRegions}</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={6000}
                  step={50}
                  value={settings.maxRegions}
                  onChange={(event) => setSettings({ ...settings, maxRegions: Number(event.target.value) })}
                />
                <p className="help">
                  Caps how many separate numbered areas appear. A lower cap makes a simpler page that is faster
                  to paint, but it also drops detail — keep it high if the picture is losing its subject.
                </p>
              </div>

              <div className="field">
                <div className="field-head">
                  <span className="label">Edge smoothing</span>
                  <span className="value">{settings.edgeSmoothing}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={4}
                  value={settings.edgeSmoothing}
                  onChange={(event) =>
                    setSettings({ ...settings, edgeSmoothing: Number(event.target.value) })
                  }
                />
                <p className="help">
                  Rounds the stair-step pixel edges of each color area into smooth curves. 0 keeps the blocky
                  pixel edges; higher values round corners more. Shape colors and numbers are unaffected.
                </p>
              </div>

              <div className="field">
                <div className="field-head">
                  <span className="label">Print sharpness</span>
                  <span className="value">{settings.printScale}×</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  value={settings.printScale}
                  onChange={(event) => setSettings({ ...settings, printScale: Number(event.target.value) })}
                />
                <p className="help">
                  How much to enlarge the page for printing. A higher value means numbers fit inside smaller
                  shapes, so raise this instead of merging detail away. 6× from 800px is about 16 inches at
                  300 dpi.
                </p>
              </div>

              <div className="field">
                <label htmlFor="precision">Color grouping tightness</label>
                <input
                  id="precision"
                  type="number"
                  min={0.2}
                  step={0.2}
                  value={settings.clusterPrecision}
                  onChange={(event) =>
                    setSettings({ ...settings, clusterPrecision: Number(event.target.value) })
                  }
                />
                <p className="help">
                  The generator stops grouping colors when they barely move. A smaller number spends longer
                  picking better paints. 1 is a solid default. You rarely need to change this.
                </p>
              </div>

              <div className="field">
                <label htmlFor="seed">Repeatable result seed</label>
                <input
                  id="seed"
                  type="number"
                  min={1}
                  value={settings.randomSeed}
                  onChange={(event) => setSettings({ ...settings, randomSeed: Number(event.target.value) })}
                />
                <p className="help">
                  Color grouping starts from a random guess. The same photo, settings, and seed give the same
                  paints every time. Change the seed if you want a different grouping.
                </p>
              </div>
            </div>
          </details>
        </aside>

        <section className="panel results">
          {!result || !canvases ? (
            <p className="empty">
              Your worksheet, finished painting, and palette will show up here. Start with your own photo or the
              sample sky — that sample includes a muddy horizon so you can see the halo cleanup working.
            </p>
          ) : (
            <>
              <div className="tabs">
                <button type="button" className={`tab ${tab === "worksheet" ? "active" : ""}`} onClick={() => setTab("worksheet")}>
                  Printable worksheet
                </button>
                <button type="button" className={`tab ${tab === "finished" ? "active" : ""}`} onClick={() => setTab("finished")}>
                  Finished picture
                </button>
                <button type="button" className={`tab ${tab === "palette" ? "active" : ""}`} onClick={() => setTab("palette")}>
                  Palette + RGB
                </button>
              </div>

              <div className="result-stats">
                <strong>{result.facets.length}</strong> shapes to paint,{" "}
                <strong>{result.palette.length}</strong> paints,{" "}
                {result.width}×{result.height} working size.
                {result.facets.length >= settings.maxRegions ? (
                  <span className="warn">
                    {" "}
                    At the shape cap — detail is being merged away. Raise <em>Maximum number of shapes</em>.
                  </span>
                ) : (
                  <span>
                    {" "}
                    Below the {settings.maxRegions} cap, so for more detail lower <em>Smallest paintable shape</em> or
                    raise <em>Working size</em>.
                  </span>
                )}
              </div>

              <div className="zoom-row">
                <span>Zoom</span>
                {([
                  ["fit", "Fit"],
                  [50, "50%"],
                  [100, "100%"],
                  [150, "150%"],
                  [200, "200%"],
                ] as const).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={`tab ${zoom === value ? "active" : ""}`}
                    onClick={() => setZoom(value)}
                  >
                    {label}
                  </button>
                ))}
                <p className="help">
                  Fit shrinks the whole page to the window, which makes numbers look tiny. Use 100% and scroll
                  to read every digit, then download the PNG to print at full size.
                </p>
              </div>

              <div className="frame">
                {tab === "worksheet" ? <CanvasView canvas={canvases.worksheet} zoom={zoom} /> : null}
                {tab === "finished" ? <CanvasView canvas={canvases.finished} zoom={zoom} /> : null}
                {tab === "palette" ? <CanvasView canvas={canvases.palette} zoom={zoom} /> : null}
              </div>

              <div className="download-row">
                <button type="button" className="btn" onClick={() => downloadCanvas(canvases.worksheet, "paint-by-number-worksheet.png")}>
                  Download worksheet PNG
                </button>
                <button type="button" className="btn" onClick={() => downloadCanvas(canvases.finished, "paint-by-number-finished.png")}>
                  Download finished PNG
                </button>
                <button type="button" className="btn" onClick={() => downloadCanvas(canvases.palette, "paint-by-number-palette.png")}>
                  Download palette PNG
                </button>
                <button type="button" className="btn secondary" onClick={() => void downloadAll()}>
                  Download all three
                </button>
              </div>

              <div className="palette-list">
                {result.palette.map((color) => (
                  <div className="swatch" key={color.number}>
                    <div
                      className="chip"
                      style={{
                        background: `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`,
                        color: color.rgb[0] * 0.3 + color.rgb[1] * 0.6 + color.rgb[2] * 0.1 > 160 ? "#111" : "#fff",
                      }}
                    >
                      {color.number}
                    </div>
                    <div>
                      <strong>RGB {color.rgb[0]}, {color.rgb[1]}, {color.rgb[2]}</strong>
                      <br />
                      <small>
                        {color.hex} · {color.percent.toFixed(1)}%
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function CanvasView({ canvas, zoom }: { canvas: HTMLCanvasElement; zoom: number | "fit" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (zoom === "fit") {
      canvas.style.width = "100%";
      canvas.style.maxWidth = "100%";
    } else {
      canvas.style.width = `${Math.round((canvas.width * zoom) / 100)}px`;
      canvas.style.maxWidth = "none";
    }
    canvas.style.height = "auto";
    host.replaceChildren(canvas);
  }, [canvas, zoom]);
  return <div ref={hostRef} />;
}
