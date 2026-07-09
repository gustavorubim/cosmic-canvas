import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cssColorToHex } from "./convertElement";
import { exportPowerPoint } from "./exportPowerPoint";
import { extractPptxSlides } from "./extractSlides";

function parse(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("extractPptxSlides", () => {
  it("extracts the hairy fixture deck as fourteen slides", () => {
    const html = readFileSync(resolve("fixtures/pptx-export/cosmic-canvas-hairy-deck.html"), "utf8");
    const slides = extractPptxSlides(parse(html));

    expect(slides).toHaveLength(14);
    expect(slides[0].title).toBe("HelioGrid Resilience Review");
    expect(slides[13].title).toBe("Decision");
  });

  it("uses reveal.js leaf sections without duplicating vertical stacks", () => {
    const doc = parse(`<!doctype html><html><body>
      <div class="reveal"><div class="slides">
        <section><h2>Horizontal</h2></section>
        <section>
          <section><h2>Vertical A</h2></section>
          <section><h2>Vertical B</h2></section>
        </section>
      </div></div>
    </body></html>`);

    expect(extractPptxSlides(doc).map((slide) => slide.title)).toEqual([
      "Horizontal",
      "Vertical A",
      "Vertical B",
    ]);
  });

  it("detects common generated deck wrappers beyond section.slide", () => {
    const doc = parse(`<!doctype html><html><body>
      <main class="slides">
        <div class="slide"><h1>Div class slide</h1></div>
        <article class="deck-slide" data-title="Deck article"><h2>Deck article</h2></article>
        <section aria-roledescription="slide" aria-label="Aria slide"><h2>Ignored heading</h2></section>
        <div class="slide-body"><h2>Not a slide part</h2></div>
      </main>
    </body></html>`);

    expect(extractPptxSlides(doc).map((slide) => slide.title)).toEqual([
      "Div class slide",
      "Deck article",
      "Aria slide",
    ]);
  });

  it("infers generated full-frame slide siblings with no explicit markers", () => {
    const doc = parse(`<!doctype html><html><body>
      <main id="pipeline">
        <div class="workspace">
          <div class="screen-frame" style="width: 1366px; height: 768px;">
            <h1>Automated Daily Liquidity Analysis</h1>
            <p>Page 1 of 3 with regulatory lineage, control metrics, and sponsor information.</p>
          </div>
          <div class="screen-frame" style="width: 1366px; height: 768px;">
            <h1>High-Velocity Regulatory Lineage</h1>
            <p>Page 2 of 3 with operational dependencies, review windows, and exception status.</p>
          </div>
          <div class="screen-frame" style="width: 1366px; height: 768px;">
            <h1>NSFR Analytics Summary</h1>
            <p>Page 3 of 3 with analyst sign-off, evidence links, and daily closeout actions.</p>
          </div>
        </div>
      </main>
    </body></html>`);

    expect(extractPptxSlides(doc).map((slide) => slide.title)).toEqual([
      "Automated Daily Liquidity Analysis",
      "High-Velocity Regulatory Lineage",
      "NSFR Analytics Summary",
    ]);
  });

  it("falls back to a page export candidate when no deck is detected", () => {
    const slides = extractPptxSlides(parse("<main><h1>One page</h1><p>Export me</p></main>"));

    expect(slides).toHaveLength(1);
    expect(slides[0].element.tagName).toBe("BODY");
  });
});

describe("PPTX conversion helpers", () => {
  it("normalizes CSS colors into PowerPoint hex colors", () => {
    expect(cssColorToHex("#abc")).toEqual({ color: "AABBCC", transparency: 0 });
    expect(cssColorToHex("rgb(47, 111, 237)")).toEqual({ color: "2F6FED", transparency: 0 });
    expect(cssColorToHex("rgba(47, 111, 237, 0.5)")).toEqual({ color: "2F6FED", transparency: 50 });
    expect(cssColorToHex("transparent")).toBeNull();
  });

  it("generates a PPTX blob and report for editable export", async () => {
    const html = `<!doctype html><html><head><title>Demo</title></head><body>
      <section class="slide" data-title="One">
        <h1 style="color:#172033">Readable title</h1>
        <p style="color:rgb(101, 112, 134)">Editable paragraph</p>
        <table><tr><th>Object</th><th>Status</th></tr><tr><td>Text</td><td>Editable</td></tr></table>
      </section>
    </body></html>`;

    const result = await exportPowerPoint({ html, mode: "editable", fileBaseName: "demo" });

    expect(result.fileName).toBe("demo-editable.pptx");
    expect(result.blob.size).toBeGreaterThan(1000);
    expect(result.report.slideCount).toBe(1);
    expect(result.report.editableObjectCount).toBeGreaterThanOrEqual(3);
  });

  it("reports unsupported CSS and produces image fallback exports", async () => {
    const html = `<!doctype html><html><body>
      <section class="slide" data-title="Stress">
        <div style="clip-path:polygon(0 0, 100% 10%, 90% 100%, 0 80%); filter:blur(1px)">
          <h1>Visual trap</h1>
        </div>
      </section>
    </body></html>`;

    const editable = await exportPowerPoint({ html, mode: "editable", fileBaseName: "stress" });
    expect(editable.report.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["css-clip-path", "css-filter"]),
    );

    const image = await exportPowerPoint({ html, mode: "image", fileBaseName: "stress" });
    expect(image.fileName).toBe("stress-image.pptx");
    expect(image.report.rasterObjectCount).toBe(1);
    expect(image.report.warnings.map((warning) => warning.code)).toContain("image-mode-foreignobject");
  });

  it("uses raster fallback for hybrid-only complex regions", async () => {
    const html = `<!doctype html><html><body>
      <section class="slide" data-title="Hybrid">
        <h1>Editable heading</h1>
        <div style="clip-path:circle(45%); backdrop-filter:blur(8px)"><p>Masked region</p></div>
      </section>
    </body></html>`;

    const hybrid = await exportPowerPoint({ html, mode: "hybrid", fileBaseName: "hybrid" });
    expect(hybrid.report.editableObjectCount).toBeGreaterThanOrEqual(1);
    expect(hybrid.report.rasterObjectCount).toBeGreaterThanOrEqual(1);
    expect(hybrid.report.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["css-clip-path", "css-backdrop-filter", "raster-fallback"]),
    );

    const editable = await exportPowerPoint({ html, mode: "editable", fileBaseName: "editable" });
    expect(editable.report.skippedObjectCount).toBeGreaterThanOrEqual(1);
    expect(editable.report.warnings.map((warning) => warning.code)).toContain("unsupported-element");
  });

  it("keeps inline SVG visible as a rasterized image object", async () => {
    const html = `<!doctype html><html><body>
      <section class="slide" data-title="Svg">
        <svg width="320" height="180" viewBox="0 0 320 180" role="img">
          <rect x="20" y="40" width="70" height="110" fill="#2f6fed" />
          <rect x="120" y="70" width="70" height="80" fill="#0e9f93" />
          <rect x="220" y="20" width="70" height="130" fill="#f06b58" />
        </svg>
      </section>
    </body></html>`;

    const result = await exportPowerPoint({ html, mode: "hybrid", fileBaseName: "svg" });

    expect(result.report.rasterObjectCount).toBeGreaterThanOrEqual(1);
    expect(result.report.warnings.map((warning) => warning.code)).toContain("svg-rasterized");
  });
});
