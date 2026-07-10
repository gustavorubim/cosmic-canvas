import { describe, expect, it } from "vitest";
import { cleanEditorHtml } from "./htmlDocument";
import { applyPreviewResourceMap, buildBrowserResourceMap, resolveDocumentResources } from "./resourceResolver";

describe("document resource resolution", () => {
  const html = `<link rel="stylesheet" href="styles/site.css"><style>@font-face{src:url(fonts/app.woff2)} .hero{background:url(images/bg.svg)}</style>
    <img src="images/photo.png"><video poster="media/poster.png"><source src="media/demo.mp4"></video>
    <script type="module">import helper from "./modules/helper.js";</script><script src="https://cdn.example/app.js"></script>`;

  it("classifies and resolves all supported dependency types", () => {
    const resources = resolveDocumentResources(html, "https://host.test/docs/");
    expect(resources.map((resource) => resource.kind)).toEqual([
      "image", "stylesheet", "script", "source", "media", "font", "font", "module",
    ]);
    expect(resources.find((resource) => resource.kind === "image")?.resolvedUrl).toBe("https://host.test/docs/images/photo.png");
    expect(resources.find((resource) => resource.kind === "module")?.status).toBe("resolved-relative");
    expect(resources.find((resource) => resource.kind === "script")?.status).toBe("external");
  });

  it("reports relative resources as unresolved when no safe base is available", () => {
    const resources = resolveDocumentResources(html);
    expect(resources.filter((resource) => resource.status === "unresolved-relative")).toHaveLength(7);
  });

  it("uses host-provided data resources only in preview and restores original references on cleanup", () => {
    const preview = applyPreviewResourceMap('<style>.hero{background:url("image.svg")}</style><div style="background:url(image.svg)"></div><img src="image.svg" srcset="image.svg 1x">', {
      "image.svg": "data:image/svg+xml;base64,PHN2Zy8+",
    });
    expect(preview).toContain("data:image/svg+xml");
    const cleaned = cleanEditorHtml(preview);
    expect(cleaned).toContain('src="image.svg"');
    expect(cleaned).toContain('srcset="image.svg 1x"');
    expect(cleaned).toContain('background:url("image.svg")');
    expect(cleaned).toContain('background:url(image.svg)');
    expect(cleaned).not.toContain("data:image/svg+xml");
  });

  it("recursively bundles CSS URLs and module imports for an opaque browser iframe", async () => {
    const responses = new Map([
      ["https://host.test/docs/styles.css", new Response('.hero{background:url("image.svg")}@font-face{src:url(font.ttf)}', { headers: { "content-type": "text/css" } })],
      ["https://host.test/docs/image.svg", new Response("<svg></svg>", { headers: { "content-type": "image/svg+xml" } })],
      ["https://host.test/docs/font.ttf", new Response(new Uint8Array([0, 1, 2]), { headers: { "content-type": "font/ttf" } })],
      ["https://host.test/docs/main.js", new Response('import { value } from "./helper.js"; document.body.dataset.value=value;', { headers: { "content-type": "text/javascript" } })],
      ["https://host.test/docs/helper.js", new Response('export const value="ok";', { headers: { "content-type": "text/javascript" } })],
    ]);
    const map = await buildBrowserResourceMap(
      '<link rel="stylesheet" href="styles.css"><script type="module" src="main.js"></script>',
      "https://host.test/docs/",
      async (input) => responses.get(String(input)) || new Response("", { status: 404 }),
    );
    const decode = (url: string) => atob(url.split(",", 2)[1]);
    expect(map["styles.css"]).toMatch(/^data:text\/css;base64,/);
    expect(decode(map["styles.css"])).toContain("data:image/svg+xml;base64,");
    expect(decode(map["styles.css"])).toContain("data:font/ttf;base64,");
    expect(decode(map["main.js"])).toContain("data:text/javascript;base64,");
    expect(decode(map["main.js"])).not.toContain("./helper.js");
  });
});
