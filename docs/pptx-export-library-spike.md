# PPTX Export Library Spike

## Decision

Keep the first implementation on a scoped PptxGenJS exporter with
`html-to-image` raster fallbacks. Do not add `dom-to-pptx` to the app runtime.

## PptxGenJS Path

- `pptxgenjs@4.0.1` is already used by the implementation.
- It works in the Vite browser build and the VS Code webview download path.
- It gives direct control over text boxes, shapes, tables, images, notes, and
  warning/report accounting.
- It does not solve arbitrary DOM conversion by itself, so Cosmic Canvas owns a
  narrow conversion layer and uses raster fallback for unsupported regions.

## Raster Fallback Path

- `html-to-image@1.11.13` is used only for browser-side PNG capture.
- Exact-image export captures each slide as one full-slide image when a live
  iframe/canvas is available.
- Hybrid export can rasterize unsupported subtrees while keeping supported text,
  shapes, and tables editable.
- When no live canvas is available, the exporter falls back to an SVG
  `foreignObject` snapshot and records that in the report.

## dom-to-pptx Findings

Checked package metadata with:

```bash
npm view dom-to-pptx version name description license dist.unpackedSize dependencies peerDependencies --json
npm view dom-to-pptx exports main module browser bin --json
npm pack dom-to-pptx --pack-destination tmp/pptx/spikes
```

Observed:

- Current npm package: `dom-to-pptx@2.0.3`.
- Tarball package size: 5.4 MB.
- Unpacked package size: 11.7 MB.
- Browser bundle: `dist/dom-to-pptx.bundle.js`, about 3.7 MB before minification.
- Runtime dependencies include `puppeteer` and `@puppeteer/browsers`, plus
  `html2canvas`, `jszip`, `opentype.js`, `fonteditor-core`, `pako`, and
  `pptxgenjs`.
- The package exposes a browser bundle and CLI, but the runtime dependency graph
  is too heavy for this VS Code custom editor feature.

## Acceptance Result

`dom-to-pptx` fails the adoption gate for this release because it materially
bloats the extension package and introduces Puppeteer/browser-management
dependencies that are not appropriate for a client-side VS Code webview export
path. It also reduces our control over per-element warnings and fidelity
reporting, which is core to the product promise.

Keep it as a future reference only if the package later ships a smaller
browser-only converter with explicit reporting hooks.
