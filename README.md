# Paint by Number

Turn a photo into a printable paint-by-number kit: a numbered worksheet, the finished picture, and a palette with paint numbers and RGB values.

This is a from-scratch web app inspired by [drake7707’s generator](https://drake7707.github.io/paintbynumbersgenerator/). The original page hides important controls behind tiny “info” icons, and photos with a sky often get a muddy brown outline. This app explains every control in plain language and removes those false outlines.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

To build a static site:

```bash
npm run build
npm run preview
```

Everything runs in the browser. Photos never leave your computer.

## What you get

1. **Worksheet PNG** — white shapes, black outlines, and numbers. Print this.
2. **Finished PNG** — the completed painting, so you can see the target.
3. **Palette PNG** — each paint number with RGB and hex values.

The only required choices are **upload a photo** and **how many paint colors** you want (4–40).

## Why skies used to get a brown outline

Cameras and JPEGs mix neighboring colors at edges. A blue sky next to brown earth produces a thin band of gray-brown pixels. The original generator treated that mix as a real extra color, so a brown line wrapped the sky.

This app:

- Groups colors in **Lab** (how eyes see color), not raw RGB
- Softens those mixed edge pixels before grouping
- Reassigns thin “halo” pixels to the nearby interior color, not to the muddy mix
- Merges skinny leftover rings into the large neighboring shape

Use **Try sample sky** to see a horizon that would have produced a brown band.

## What each setting does

### If dark details (tree trunks, branches, eyes) disappear

Two different causes:

1. **Not enough paints.** Below roughly 18 colors there is often no paint dark enough for a trunk, so it is averaged into the greenery around it. Measured on a cherry-blossom photo, the very-dark share of the trunk band was 0.01% at 16 colors versus 7.1% at 24 colors (7.5% in the original).
2. **Merging elongated shapes.** A trunk is long and narrow, so an "is this shape too skinny?" test deletes it by design. The generator no longer merges shapes for being elongated — only true specks and 1px slivers are merged, and a number that does not fit is drawn smaller instead of the shape being removed.

### If you want more detail

The results line above the preview tells you which limit you are hitting. If the shape count sits at **Maximum number of shapes**, that cap is throwing detail away; if it is below the cap, the cap is irrelevant and these are the levers, measured on a 618×1024 cherry-blossom photo (error is the mean per-channel difference from the original, so lower keeps more of the photo):

| Change | Shapes | Error | Numbers too small to read |
| --- | --- | --- | --- |
| defaults | 644 | 16.60 | 4 |
| **Working size** 800 → 1200 | 655 | 16.22 | 0 |
| **Smallest paintable shape** 0.02% → 0.01% | 865 | 16.31 | 24 |
| **How many paint colors** 24 → 32 | 729 | 16.11 | 6 |
| **Texture smoothing** 2 → 1 | 686 | 16.47 | 6 |
| **Maximum number of shapes** 900 → 3000 | 644 | 16.60 | 4 |
| all four combined | 1081 | 15.79 | 11 |

**Working size** is the one to raise first: it is the only change that adds detail *and* makes numbers easier to read, because the smallest-shape limit is a share of the picture rather than a pixel count. Pushing everything to the maximum (32 colors, no soften, 6000 shapes) measured no better than the combined row above while adding 250 more shapes to paint.

### If the page is covered in confetti-like specks

Painterly or grainy sources (oil paintings, film grain, high-ISO photos) turn brush texture into thousands of unpaintable shapes. Raise **Texture smoothing**, then **Smallest paintable shape**.

### If the colors look wrong

Each paint is the **average** of the photo pixels behind that number, measured on the original image after all cleanup. Averaging is always a little duller than the photo, and too few paints forces unrelated colors to share one number. Adjust in this order:

1. **How many paint colors?** — the biggest lever. Skin, sky, and foliage each need several paints; at 8 colors they get merged into one muddy average.
2. **Color vividness** — raise above 100% if the paints feel washed out.
3. **How colors are grouped** (under *What each setting does*) — Lab is most accurate; RGB if one specific hue matters.
4. **Soften camera edges** — turn it off if it is dulling colors in a clean, non-JPEG image.
5. **Working size** — a larger size samples more of the photo before averaging.

### What each setting does

| Setting | What it changes |
| --- | --- |
| **How many paint colors?** | Maximum paints on the palette. Fewer is easier; more looks closer to the photo. |
| **Color vividness** | Saturation applied to the measured paint colors. 100% is the true photo average. |
| **Texture smoothing** | Extra blur passes that flatten brush strokes and grain before colors are chosen. |
| **Working size** | Longest side used for coloring. Bigger is slower and more detailed. Print files are enlarged from this. |
| **How colors are grouped** | Lab is recommended. RGB uses camera channels. HSL groups by hue. |
| **Soften camera edges first** | Light blur so JPEG specks do not become extra paints. |
| **Remove color halos** | Deletes thin wrong-color outlines around skies and other large areas. |
| **Smallest paintable shape** | Shapes below this share of the picture area merge into their neighbor. Area-relative, so it behaves the same on small and large images. |
| **Number size on the print** | Smallest height a digit is drawn at in the downloaded PNG. |
| **Maximum number of shapes** | Caps how many numbered areas appear. Lowering it drops detail. |
| **Edge smoothing** | Turns the pixel staircase along each shape into a flowing curve. `0` keeps square pixel edges. |
| **Print sharpness** | How much to enlarge the PNG for printing. 6× from 800px is about 16 inches at 300 dpi. |
| **Color grouping tightness** | When color clustering may stop. `1` is a good default. Smaller is slower and sometimes a bit cleaner. |
| **Repeatable result seed** | Same photo + settings + seed = the same paints. Change it for a different grouping. |

Numbers are measured on the **enlarged print**, not on the working image, so raising **Print sharpness** makes digits fit inside smaller shapes instead of merging that detail away. `npm run check:fidelity` renders a synthetic face and asserts small features such as eyes survive the simplification step.

### Why the edges are smooth and still gapless

Coloring works on pixels, so every shape starts with a staircase outline. Smoothing each shape on its own would pull neighbors apart and leave cracks between them. Instead the border network is cut into **chains** — the stretch of border shared by the same two shapes, running between the junctions where three or more shapes meet. Each chain is straightened and rounded once, and both of its shapes are rebuilt from that same curve, so neighbors still meet exactly. `npm run check:contours` verifies this: the smoothed shapes cover 99.97% of the picture, and a shape's area moves about 1% (median) from its pixel original.

Compared with the original site: “number of colors”, “cluster precision”, “random seed”, “clustering color space”, “narrow pixel cleanup”, “remove small facets”, and “maximum number of facets” are the same ideas, written so you can tell what will happen to the page you paint.
