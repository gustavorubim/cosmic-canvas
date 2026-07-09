# PPTX Export Fidelity Plan

## Goal

Add a Cosmic Canvas export path that saves detected HTML presentations as `.pptx`
files with the best practical balance between visual fidelity and later
PowerPoint editability.

The product promise should be precise:

- Exported `.pptx` files preserve slide order, slide size, titles, text, images,
  tables, simple charts, fills, borders, and common positioning with high
  fidelity.
- Text, basic shapes, tables, and supported SVG/chart objects remain editable in
  PowerPoint.
- Unsupported browser-only styling is safely flattened or approximated, and the
  export report tells the user exactly what happened.
- "Looks exactly like the browser and every object is editable" is not promised
  for arbitrary HTML. Browser layout and the PowerPoint drawing model are
  different systems.

## Decision

Build a hybrid exporter with three explicit modes:

1. `Editable PPTX`
   - Converts supported HTML/CSS into native PowerPoint objects.
   - Best for decks created or normalized in Cosmic Canvas.
   - Produces an export report with unsupported features.

2. `Exact Image PPTX`
   - Renders every slide to a full-slide image and inserts one image per slide.
   - Best for client delivery where visual fidelity matters more than editing.
   - Almost no object-level editability.

3. `Hybrid PPTX`
   - Default mode.
   - Uses editable text/shapes where confidence is high.
   - Falls back to raster slices for complex regions.
   - Produces the most useful compromise for real-world AI-generated decks.

## Candidate Libraries

### Primary writer: PptxGenJS

Use PptxGenJS for browser-side `.pptx` creation. It supports text, shapes,
images, tables, charts, SVGs, custom slide sizes, and browser downloads.

Limitations:

- Its built-in HTML-to-PPTX path is mainly table-oriented.
- Arbitrary DOM-to-PPTX must be implemented by us or delegated to another
  converter.
- Some PowerPoint features have no browser/CSS equivalent, and some CSS features
  have no PowerPoint equivalent.

### Spike candidate: dom-to-pptx

Evaluate `dom-to-pptx` in a short spike before committing to it. It claims
high-fidelity editable DOM conversion and may reduce implementation time.

Acceptance for adoption:

- Works in Vite browser build without unsafe global hacks.
- Handles our hairy fixture with no fatal errors.
- Produces editable text boxes for text, not just full-slide images.
- Gives us enough hooks to report unsupported features.
- Does not materially bloat the extension package or block VS Code webview CSP.

If it fails any of those, keep it out of the app and continue with a scoped
PptxGenJS exporter.

## Non-Goals

- Do not implement a complete browser layout engine.
- Do not promise animation export in the first version.
- Do not execute untrusted user scripts while exporting.
- Do not require a backend service.
- Do not require Microsoft PowerPoint to be installed.
- Do not modify the default clean HTML export behavior.

## Source Fixtures

The first durable fixture is:

`fixtures/pptx-export/cosmic-canvas-hairy-deck.html`

It is a long fictional presentation with:

- 14 slides.
- Multiple detected `section.slide` containers.
- CSS grid, absolute positioning, transforms, gradients, shadows, tables,
  inline SVG, metric cards, a heatmap, a timeline, a 2x2 matrix, and overlapping
  elements.
- No external network assets.

The first generated smoke artifact is:

`output/pptx/cosmic-canvas-hairy-deck-prototype.pptx`

The prototype generator is:

`scripts/generate-pptx-prototype.py`

This script is not the final app implementation. It gives us a repeatable
editable `.pptx` artifact and makes the test fixture concrete before we wire
browser export.

## Feature Architecture

### App surfaces

Add a new export menu group in `src/components/Topbar.tsx`:

- `PowerPoint: Hybrid`
- `PowerPoint: Editable`
- `PowerPoint: Exact image`

Pass handlers from `src/App.tsx`, next to the existing HTML export handlers:

- `downloadPowerPointHybrid()`
- `downloadPowerPointEditable()`
- `downloadPowerPointImage()`

The handlers must:

- Clean editor-only metadata with `cleanEditorHtml`.
- Use the currently applied/rendered iframe document as the layout source when
  possible.
- Fall back to source HTML parsing if the iframe is unavailable.
- Show export progress and final report.

### New modules

Add these modules:

- `src/pptx/exportPowerPoint.ts`
  - Orchestrates mode selection, slide extraction, asset preparation, and file
    writing.
- `src/pptx/extractSlides.ts`
  - Detects slide elements using the same deck rules as the bridge.
  - Produces stable slide ids, titles, source indexes, and DOM element handles.
- `src/pptx/measureDom.ts`
  - Reads computed style and bounding boxes from the iframe document.
  - Converts browser pixels to PowerPoint inches.
- `src/pptx/convertElement.ts`
  - Maps a measured element into a native PPTX object, a raster fallback, or a
    skipped item with a report entry.
- `src/pptx/rasterize.ts`
  - Captures element or slide images for exact-image and fallback regions.
- `src/pptx/exportReport.ts`
  - Defines warnings, fidelity scores, unsupported features, and counts.
- `src/pptx/types.ts`
  - Shared types.

### Data model

```ts
export type PptxExportMode = "hybrid" | "editable" | "image";

export type PptxSlideSource = {
  id: string;
  title: string;
  index: number;
  element: HTMLElement;
  widthPx: number;
  heightPx: number;
};

export type PptxLayerPlan =
  | { kind: "text"; elementId: string; confidence: number; reason: string }
  | { kind: "shape"; elementId: string; confidence: number; reason: string }
  | { kind: "image"; elementId: string; confidence: number; reason: string }
  | { kind: "table"; elementId: string; confidence: number; reason: string }
  | { kind: "svg"; elementId: string; confidence: number; reason: string }
  | { kind: "raster"; elementId: string; confidence: number; reason: string }
  | { kind: "skip"; elementId: string; confidence: 0; reason: string };

export type PptxExportReport = {
  mode: PptxExportMode;
  slideCount: number;
  editableObjectCount: number;
  rasterObjectCount: number;
  skippedObjectCount: number;
  warnings: Array<{
    slideIndex: number;
    elementPath: string;
    code: string;
    message: string;
  }>;
};
```

## Conversion Rules

### Slide size

- Use a 16:9 widescreen layout by default.
- If slide containers have a consistent aspect ratio, use that ratio.
- Preserve the same slide size for every slide in a single export.
- Convert coordinates with:
  - `xIn = (elementLeftPx - slideLeftPx) / slideWidthPx * pptxWidthIn`
  - `yIn = (elementTopPx - slideTopPx) / slideHeightPx * pptxHeightIn`
  - same for width and height.

### Text

Editable when:

- Element contains mostly text and inline markup.
- CSS transform is none, translate, or simple scale.
- Writing mode is horizontal.
- No unsupported clipping/masking/filter is required.

Preserve:

- Text content.
- Font family fallback.
- Font size.
- Color.
- Bold and italic.
- Text alignment.
- Line height approximation.
- Basic bullets and numbered lists.
- Hyperlinks with safe URL protocols only.

Fallback to raster when:

- Text uses complex transforms, masks, blend modes, text stroke, text shadow that
  materially affects readability, or nested layout that cannot be represented as
  a single text box.

Verifiable reward:

- A user can open the exported `.pptx`, click a headline or body paragraph, and
  edit the text without moving the whole slide image.

### Shapes

Editable when:

- Element is a rectangle, rounded rectangle, pill, circle, line, or simple card.
- Background is a solid color or simple linear gradient.
- Border radius can be approximated.
- Border can be represented as a PowerPoint line.

Fallback to raster when:

- CSS uses clip-path, complex gradient, backdrop filter, blend mode, multi-shadow
  visual effects, or pseudo-elements that materially affect the design.

Verifiable reward:

- Metric cards, matrix quadrants, timeline bars, and simple callouts can be
  recolored or moved in PowerPoint.

### Images

Editable as image objects when:

- `img`, `picture`, or CSS background image can be resolved as a data URI or
  fetched blob.
- Object-fit can be mapped to contain, cover, or crop.

Fallback:

- Rasterize the containing region if an image cannot be fetched but is visible in
  the iframe.

Verifiable reward:

- A user can replace a photo-like image in PowerPoint using native image tools.

### Tables

Editable when:

- Source is an HTML `table` with simple row/column spans.
- Cell borders and fills are simple.

Fallback:

- Rasterize complex nested tables.

Verifiable reward:

- The table on the fixture's "Export Scorecard" slide opens as an editable
  PowerPoint table.

### SVG and Charts

First version:

- Preserve SVG as image/SVG where PowerPoint accepts it.
- Keep charts generated by Cosmic Canvas as grouped editable shapes only if the
  chart has a known internal representation.

Future version:

- Map simple inline SVG bars, lines, pies, and labels to PowerPoint shapes.

Verifiable reward:

- Inline SVG charts do not disappear, and the report states whether they are
  editable or rasterized.

### Unsupported CSS

Report these with stable codes:

- `css-filter`
- `css-backdrop-filter`
- `css-blend-mode`
- `css-clip-path`
- `css-mask`
- `css-pseudo-content`
- `css-animation`
- `css-fixed-position`
- `css-unsupported-transform`
- `asset-fetch-failed`
- `font-unavailable`

Verifiable reward:

- The user never gets silent degradation for a material visual feature.

## Implementation Milestones

### P0. Keep The Current Branch Safe

Work on `gvr/pptx-export-fidelity-plan`.

Verification:

```bash
git branch --show-current
git status --short --branch
```

Reward:

- The PPTX work is isolated from the current implementation branch while keeping
  the user's in-progress modifications intact.

### P1. Fixture And Prototype Baseline

Add:

- `docs/pptx-export-fidelity-plan.md`
- `fixtures/pptx-export/cosmic-canvas-hairy-deck.html`
- `scripts/generate-pptx-prototype.py`
- `output/pptx/cosmic-canvas-hairy-deck-prototype.pptx`

Verification:

```bash
/Users/gvrubim/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/generate-pptx-prototype.py
/Users/gvrubim/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 - <<'PY'
from pptx import Presentation
prs = Presentation("output/pptx/cosmic-canvas-hairy-deck-prototype.pptx")
assert len(prs.slides) == 14
shape_count = sum(len(slide.shapes) for slide in prs.slides)
assert shape_count >= 120, shape_count
text_shapes = sum(1 for slide in prs.slides for shape in slide.shapes if getattr(shape, "has_text_frame", False))
assert text_shapes >= 70, text_shapes
print({"slides": len(prs.slides), "shapes": shape_count, "text_shapes": text_shapes})
PY
```

Visual smoke:

```bash
mkdir -p tmp/pptx/rendered
soffice -env:UserInstallation=file:///tmp/lo_profile_cosmic_pptx \
  --headless --convert-to pdf --outdir tmp/pptx/rendered \
  output/pptx/cosmic-canvas-hairy-deck-prototype.pptx
pdftoppm -png tmp/pptx/rendered/cosmic-canvas-hairy-deck-prototype.pdf tmp/pptx/rendered/page
```

Reward:

- We have a concrete, pretty, complex deck that can break weak exporters, plus a
  repeatable generated PowerPoint artifact with editable objects.

### P2. Library Spike

Evaluate PptxGenJS alone and `dom-to-pptx` on the fixture.

Tasks:

- Create temporary spike code under `tmp/pptx/spikes`.
- Export the hairy fixture with each candidate.
- Record bundle size impact.
- Record CSP issues in VS Code webview.
- Record slide count, editable text object count, raster object count, and fatal
  errors.

Verification:

```bash
npm run build
npm test
```

Plus manual artifact checks:

- Open generated PPTX in PowerPoint or LibreOffice.
- Confirm first slide renders.
- Confirm at least one title and one metric card can be edited.
- Confirm the export does not require a server.

Reward:

- A documented technical choice before committing a heavy dependency to the app.

### P3. Slide Extraction

Implement `extractSlides`.

Rules:

- Reuse the same deck selectors as the editor bridge:
  - `section.slide`
  - `[data-slide]`
  - `.reveal .slides > section`
  - `.reveal .slides > section > section`
- Deduplicate nested/overlapping matches.
- Treat reveal vertical stacks as leaf slides.
- Preserve DOM order.
- Compute title from `data-title`, `data-section`, `h1`, `h2`, `h3`, or fallback
  `Slide N`.

Tests:

- Existing sample deck yields the same count/order as the bridge.
- Hairy fixture yields exactly 14 slides.
- Reveal fixture yields leaf slides only.
- Non-deck HTML yields one page-like export candidate only when explicitly
  exporting as PPTX.

Reward:

- Export starts from the same slide model that users see in the timeline.

### P4. Measurement Pipeline

Implement browser measurement from the live iframe.

Tasks:

- Ensure export runs against clean editable DOM, not editor overlays.
- Read each slide's `getBoundingClientRect`.
- Read each exportable descendant's rect and computed styles.
- Normalize scroll offsets.
- Convert px to PowerPoint inches.
- Record z-order based on DOM order and computed `z-index`.

Tests:

- Fixed fixture with known rects maps to expected inch coordinates.
- Hidden elements are skipped.
- Elements outside slide bounds generate report warnings.
- Translated elements map to their visual rect, not source DOM location.

Reward:

- PPTX layers land where users see them in Cosmic Canvas.

### P5. Editable Text Export

Implement native text box conversion.

Support:

- `h1`-`h6`, `p`, `li`, `blockquote`, `small`, plain text card labels.
- Inline `strong`, `em`, `b`, `i`, `code`, `span`, `a`.
- Text color, font size, line height approximation, alignment, bullets.

Tests:

- Fixture title slide has editable title and subtitle.
- Inline bold/italic/link fixture preserves runs.
- Unsafe `javascript:` links are removed and reported.
- Long paragraph exports without crashing and uses fit/shrink only when needed.

Reward:

- Real people can revise text in PowerPoint instead of returning to HTML for
  every copy edit.

### P6. Editable Shape Export

Implement simple shape conversion.

Support:

- Rectangles.
- Rounded rectangles.
- Pills.
- Circles/ellipses.
- Lines.
- Solid fills.
- Simple borders.
- Simple shadows where PowerPoint supports them.

Tests:

- Hairy deck metric cards export as separate editable rounded rectangles.
- Risk heatmap cells export as separate editable rectangles.
- 2x2 matrix quadrants export as editable rectangles and labels.
- Elements with clip-path fall back to raster with `css-clip-path` warning.

Reward:

- Layout structure remains useful to designers after export.

### P7. Images, SVG, And Tables

Implement media and structured objects.

Support:

- `img` as image object.
- CSS background image where resolvable.
- Inline SVG as SVG/image.
- Simple HTML tables as editable PowerPoint tables.

Tests:

- Self-contained data URI image exports.
- Missing external image generates `asset-fetch-failed`.
- Inline SVG chart remains visible.
- Export Scorecard table is editable and has expected row/column count.

Reward:

- Presentations with dashboards and scorecards remain usable after conversion.

### P8. Raster Fallbacks

Implement fallback capture.

Approach:

- Exact-image mode captures each full slide.
- Hybrid mode captures only unsupported regions when possible.
- Editable mode skips unsupported regions by default but includes report warnings.

Important:

- Browser-native screenshot APIs are limited in a normal web app.
- Evaluate SVG `foreignObject` serialization, `html-to-image`, or a vetted
  DOM-to-image dependency.
- Ensure all assets are embedded or reported.

Tests:

- Exact-image export produces one image object per slide.
- Hybrid export preserves editable title text while rasterizing a complex masked
  illustration.
- Report counts rasterized regions.

Reward:

- Users can choose a dependable visual export even when editability is partial.

### P9. Export Report UI

Add a post-export report panel/toast.

Show:

- Export mode.
- Slide count.
- Editable object count.
- Raster object count.
- Skipped object count.
- Top warnings with clickable slide references.

Tests:

- A fixture with unsupported CSS shows warnings.
- Clean simple deck shows zero warnings.
- Warnings do not block successful download unless a fatal write error occurs.

Reward:

- Fidelity compromises are inspectable, not hidden.

### P10. App Integration

Wire the export menu and download behavior.

Tests:

- Menu only offers PowerPoint export when a deck is detected or when the user
  explicitly chooses export current page.
- Browser build downloads `.pptx`.
- VS Code extension path can trigger the same export from the webview.
- Existing HTML save/copy/download behavior remains unchanged.

Verification:

```bash
npm test
npm run build
npm run vscode:compile
```

Reward:

- The feature is reachable in both browser and VS Code extension workflows.

### P11. Fidelity Regression Harness

Add an automated visual comparison path.

Plan:

- Render the HTML fixture in a browser at 1600x900 per slide.
- Render exported PPTX to PDF with LibreOffice.
- Render PDF pages to PNG with Poppler.
- Compare images with a tolerance metric.

Suggested thresholds:

- Exact-image mode: visual diff below 2 percent per slide.
- Hybrid mode: visual diff below 8 percent per slide on supported fixture
  regions.
- Editable mode: visual diff below 15 percent for supported fixture, with
  warnings for known unsupported effects.

Tests:

- Harness fails if a slide renders blank.
- Harness fails if slide count differs.
- Harness outputs diff images under `tmp/pptx/diffs`.

Reward:

- We can detect regressions in actual rendered output instead of trusting XML.

### P12. Documentation

Update README.

Document:

- What PowerPoint export supports.
- What "Hybrid", "Editable", and "Exact image" mean.
- Why arbitrary HTML cannot be both pixel-perfect and fully editable.
- How to use the export report.
- How to run the hairy fixture.

Reward:

- User expectations match engineering reality.

## Definition Of Done

The first shippable version is done when:

- `npm test` passes.
- `npm run build` passes.
- `npm run vscode:compile` passes.
- Hairy fixture exports in all three modes.
- Exact-image mode has no blank slides.
- Hybrid mode leaves at least slide titles, metric cards, and simple tables
  editable.
- Export report lists unsupported CSS and asset failures.
- Existing HTML export output stays byte-identical for the sample document.
- README documents fidelity/editability tradeoffs.

## Manual Acceptance Script

1. Start the app.
2. Open `fixtures/pptx-export/cosmic-canvas-hairy-deck.html`.
3. Confirm the timeline detects 14 slides.
4. Export `PowerPoint: Hybrid`.
5. Open the `.pptx` in PowerPoint or LibreOffice.
6. Confirm every slide is present and nonblank.
7. Edit the title on slide 1.
8. Edit a metric card label on slide 2.
9. Move one heatmap cell on slide 9.
10. Confirm any non-editable/rasterized pieces are listed in the export report.
11. Export `PowerPoint: Exact image`.
12. Confirm visual fidelity is better than Hybrid, with reduced editability.

## Open Questions

- Should PowerPoint export be available for any HTML page, or only detected
  decks?
- Should the first release include exact-image mode only as a safety net, or ship
  all three modes together?
- Should the VS Code extension write `.pptx` through the extension host, or
  should the webview trigger a browser-style download?
- Do we accept a new runtime dependency for rasterization?
- Do we accept `dom-to-pptx` if it works but limits reporting control?
