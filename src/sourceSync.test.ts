import { describe, expect, it } from "vitest";
import { SAMPLE_HTML } from "./htmlDocument";
import { type SelectedElement } from "./protocol";
import { findOpeningTagLocation, resolveOpeningTagLocation, sourceNeedleForSelected } from "./sourceSync";

function selected(overrides: Partial<SelectedElement>): SelectedElement {
  return {
    id: "el-1",
    domId: "",
    tagName: "p",
    text: "",
    childElementCount: 0,
    editableText: true,
    classes: [],
    ancestors: [],
    isImage: false,
    imageSrc: "",
    imageAlt: "",
    imageFit: "",
    canHaveBackground: false,
    backgroundImage: "",
    styles: {
      color: "",
      backgroundColor: "",
      fontSize: "",
      fontWeight: "",
      textAlign: "",
      padding: "",
      margin: "",
      width: "",
      height: "",
      borderRadius: "",
    },
    ...overrides,
  };
}

describe("source sync", () => {
  it("finds the sample document line containing the selected element opening tag", () => {
    const location = findOpeningTagLocation(SAMPLE_HTML, selected({ tagName: "p", classes: ["summary"] }));

    expect(location).not.toBeNull();
    const line = SAMPLE_HTML.split("\n")[(location?.lineNumber ?? 1) - 1];
    expect(line).toContain('<p class="summary">');
    expect(sourceNeedleForSelected(selected({ tagName: "p", classes: ["summary"] }))).toBe("<p.summary");
  });

  it("uses real DOM ids and refuses to claim a missing id matched the first same-tag element", () => {
    const source = '<main><section id="hero" class="slide intro"><h1>Hero</h1></section><section></section></main>';
    const location = findOpeningTagLocation(
      source,
      selected({ tagName: "section", domId: "hero", classes: ["slide", "intro"] }),
    );
    const missing = resolveOpeningTagLocation(source, selected({ tagName: "section", domId: "missing" }));

    expect(source.slice(location?.from, location?.to)).toBe('<section id="hero" class="slide intro">');
    expect(missing).toEqual({ status: "not-found", location: null, candidates: 0 });
  });

  it("reports ambiguity instead of silently choosing the first repeated tag", () => {
    const source = '<main><div class="card"></div><div class="card"></div></main>';
    expect(resolveOpeningTagLocation(source, selected({ tagName: "div", classes: ["card"] }))).toEqual({
      status: "ambiguous",
      location: null,
      candidates: 2,
    });
  });

  it("uses the structural source path to distinguish repeated matching elements", () => {
    const source = `<!doctype html><html><head></head><body><main>
      <div class="card"><p>First</p></div>
      <div class="card"><p>Second</p></div>
      <div class="card"><p>Third</p></div>
    </main></body></html>`;
    const location = findOpeningTagLocation(
      source,
      selected({ tagName: "div", classes: ["card"], sourcePath: [1, 0, 1] }),
    );

    expect(location).not.toBeNull();
    expect(source.slice(location?.from, location?.to)).toBe('<div class="card">');
    expect(source.slice(0, location?.from).match(/<div class="card">/g)).toHaveLength(1);
  });
});
