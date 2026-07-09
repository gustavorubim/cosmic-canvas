import { describe, expect, it } from "vitest";
import { SAMPLE_HTML } from "./htmlDocument";
import { type SelectedElement } from "./protocol";
import { findOpeningTagLocation, sourceNeedleForSelected } from "./sourceSync";

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

  it("uses real DOM ids when present and falls back to the first same-tag match otherwise", () => {
    const source = '<main><section id="hero" class="slide intro"><h1>Hero</h1></section><section></section></main>';
    const location = findOpeningTagLocation(
      source,
      selected({ tagName: "section", domId: "hero", classes: ["slide", "intro"] }),
    );
    const fallback = findOpeningTagLocation(source, selected({ tagName: "section", domId: "missing" }));

    expect(source.slice(location?.from, location?.to)).toBe('<section id="hero" class="slide intro">');
    expect(source.slice(fallback?.from, fallback?.to)).toBe('<section id="hero" class="slide intro">');
  });
});
