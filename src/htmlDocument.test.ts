import { describe, it, expect } from "vitest";
import {
  SAMPLE_HTML,
  normalizeHtmlInput,
  cleanEditorHtml,
  createPrintHtml,
  createSelfContainedHtml,
  normalizeDeckHtml,
  inlineTrustedModuleEntrypoints,
  prepareEditableHtml,
} from "./htmlDocument";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("normalizeHtmlInput", () => {
  it("wraps a bare fragment into a full document", () => {
    const result = normalizeHtmlInput("<p>hi</p>");
    expect(result.toLowerCase()).toContain("<!doctype html>");
    expect(result.toLowerCase()).toContain("<html");
    expect(result.toLowerCase()).toContain("<body>");
    expect(result).toContain("<p>hi</p>");
  });

  it("leaves an already-complete doctype document essentially unchanged", () => {
    const result = normalizeHtmlInput(SAMPLE_HTML);
    expect(result).toBe(SAMPLE_HTML.trim());
  });

  it("leaves a document starting with <html unchanged", () => {
    const input = "<html><body><p>hello</p></body></html>";
    expect(normalizeHtmlInput(input)).toBe(input);
  });
});

describe("prepareEditableHtml (untrusted)", () => {
  it("injects the editor bridge", () => {
    const result = prepareEditableHtml(SAMPLE_HTML);
    expect(result).toContain('data-wysiwyg-editor="true"');
    expect(result).toContain("<script");
  });

  it("turns user scripts inert", () => {
    const result = prepareEditableHtml("<p>x</p><script>alert(1)</script>");
    const doc = parse(result);
    const userScript = doc.querySelector(
      "script[data-wysiwyg-preserved-script]",
    );
    expect(userScript).not.toBeNull();
    expect(userScript?.getAttribute("type")).toBe("text/plain");
    // The original script body must not execute and is preserved as text.
    expect(userScript?.textContent).toContain("alert(1)");
  });

  it("removes inline event handlers and stores them", () => {
    const result = prepareEditableHtml('<button onclick="x()">Go</button>');
    const doc = parse(result);
    const button = doc.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("onclick")).toBe(false);
    const stored = button?.getAttribute("data-wysiwyg-original-events");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({ onclick: "x()" });
  });
});

describe("cleanEditorHtml", () => {
  it("inlines trusted module entrypoints for opaque preview origins and restores src on cleanup", async () => {
    const hydrated = await inlineTrustedModuleEntrypoints(
      '<script type="module" src="modules/app.js"></script>',
      "https://host.test/docs/",
      async () => new Response('document.body.dataset.loaded = "true";'),
    );
    expect(hydrated).toContain('data-wysiwyg-original-module-src="modules/app.js"');
    expect(hydrated).toContain("dataset.loaded");
    const cleaned = cleanEditorHtml(hydrated);
    expect(cleaned).toContain('src="modules/app.js"');
    expect(cleaned).not.toContain("dataset.loaded");
    expect(cleaned).not.toContain("data-wysiwyg-original-module-src");
  });

  it("injects a preview session token into both bridges and strips it on export", () => {
    const prepared = prepareEditableHtml("<p>Session</p>", false, "", "session-secret");
    expect(prepared.match(/session-secret/g)?.length).toBeGreaterThanOrEqual(2);
    expect(cleanEditorHtml(prepared)).not.toContain("session-secret");
  });

  it("removes all editor artifacts and the bridge", () => {
    const prepared = prepareEditableHtml(SAMPLE_HTML);
    const cleaned = cleanEditorHtml(prepared);
    expect(cleaned).not.toContain("data-wysiwyg-");
    expect(cleaned).not.toContain('wysiwyg-editor="true"');
    // The injected editor script/style carries the bridge marker; ensure gone.
    expect(cleaned).not.toContain("__wysiwyg_none__");
  });

  it("restores a preserved user script", () => {
    const prepared = prepareEditableHtml("<p>x</p><script>alert(1)</script>");
    const cleaned = cleanEditorHtml(prepared);
    expect(cleaned).not.toContain("data-wysiwyg-");
    expect(cleaned).not.toContain('type="text/plain"');
    const doc = parse(cleaned);
    const script = doc.querySelector("script");
    expect(script).not.toBeNull();
    expect(script?.hasAttribute("type")).toBe(false);
    expect(script?.hasAttribute("data-wysiwyg-preserved-script")).toBe(false);
    expect(script?.textContent).toContain("alert(1)");
  });

  it("temporarily disables document CSP for editing and restores it on clean export", () => {
    const input = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><p>Safe</p>';
    const prepared = prepareEditableHtml(input);
    const preview = new DOMParser().parseFromString(prepared, "text/html");
    const previewMeta = preview.querySelector("meta[data-wysiwyg-original-http-equiv]");
    expect(previewMeta?.hasAttribute("http-equiv")).toBe(false);
    expect(previewMeta?.getAttribute("data-wysiwyg-original-http-equiv")).toBe("Content-Security-Policy");
    const cleaned = cleanEditorHtml(prepared);
    const exported = new DOMParser().parseFromString(cleaned, "text/html");
    expect(exported.querySelector("meta[http-equiv]")?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(cleaned).not.toContain("data-wysiwyg-original-http-equiv");
  });

  it("injects an editor-only resource base and removes it from clean export", () => {
    const prepared = prepareEditableHtml('<img src="images/demo.png">', false, "https://resource.test/folder");
    const preview = new DOMParser().parseFromString(prepared, "text/html");
    expect(preview.querySelector("base")?.href).toBe("https://resource.test/folder/");
    expect(cleanEditorHtml(prepared)).not.toContain("https://resource.test/folder/");
  });
});

describe("round-trip idempotency", () => {
  it("preserves user content through prepare + clean", () => {
    const cleaned = cleanEditorHtml(prepareEditableHtml(SAMPLE_HTML));
    expect(cleaned).toContain("Quarterly Product Review");
    expect(cleaned).toContain("42%");
  });

  it("restores an inline handler through prepare + clean", () => {
    const input = "<button onclick=\"doThing()\">Go</button>";
    const cleaned = cleanEditorHtml(prepareEditableHtml(input));
    expect(cleaned).not.toContain("data-wysiwyg-");
    const doc = parse(cleaned);
    const button = doc.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("onclick")).toBe("doThing()");
  });
});

describe("cleanEditorHtml pretty", () => {
  it("produces an indented document while preserving content", () => {
    const prepared = prepareEditableHtml(SAMPLE_HTML);
    const plain = cleanEditorHtml(prepared);
    const pretty = cleanEditorHtml(prepared, { pretty: true });

    expect(pretty.startsWith("<!doctype html>")).toBe(true);
    expect(pretty).toContain("\n");
    expect(pretty).toMatch(/\n\s+</);
    expect(pretty.split("\n").length).toBeGreaterThan(plain.split("\n").length);
    expect(pretty).toContain("42%");
    expect(pretty).not.toContain("data-wysiwyg-");
  });
});

describe("export variants", () => {
  it("inlines fetchable image URLs as data URIs", async () => {
    const input = '<main><img src="https://example.com/image.png" alt="demo" /></main>';
    const result = await createSelfContainedHtml(input, async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    expect(result.failures).toEqual([]);
    expect(result.html).toContain('src="data:image/png;base64,AQID"');
  });

  it("reports image URLs that cannot be inlined", async () => {
    const result = await createSelfContainedHtml('<img src="https://example.com/missing.png" />', async () =>
      new Response("", { status: 404 }),
    );

    expect(result.failures).toEqual(["https://example.com/missing.png"]);
    expect(result.html).toContain('src="https://example.com/missing.png"');
  });

  it("adds print page-break rules without changing default clean export", () => {
    const baseline = cleanEditorHtml(SAMPLE_HTML);
    const printable = createPrintHtml('<section class="slide"><h1>One</h1></section>');

    expect(cleanEditorHtml(SAMPLE_HTML)).toBe(baseline);
    expect(printable).toContain("data-cosmic-print-export");
    expect(printable).toContain("page-break-after: always");
    expect(printable).toContain("break-after: page");
  });
});

describe("normalizeDeckHtml", () => {
  it("normalizes deck heading levels, spacing, and empty nodes idempotently", () => {
    const messy = `<!doctype html>
<html><head><title>Messy</title></head><body>
<section class="slide">
  <h1> Welcome   home </h1>
  <p> A   short
       line. </p>
  <p> </p>
  <div></div>
  <h2> Details </h2>
</section>
<section data-slide>
  <h3> Second    slide </h3>
  <span></span>
</section>
</body></html>`;
    const normalized = normalizeDeckHtml(messy);

    expect(normalized).toBe(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Messy</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body>
    <section class="slide">
      <h2>Welcome home</h2>
      <p>A short line.</p>
      <h3>Details</h3>
    </section>
    <section data-slide="">
      <h2>Second slide</h2>
    </section>
  </body>
</html>
`);
    expect(normalizeDeckHtml(normalized)).toBe(normalized);
  });
});
