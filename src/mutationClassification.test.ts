import { describe, expect, it } from "vitest";
import { classifyBridgeMutation, combineMutationImpacts } from "./bridge/editorBridge";

function mutation(overrides: Partial<MutationRecord> & Pick<MutationRecord, "type" | "target">): MutationRecord {
  return {
    addedNodes: [] as unknown as NodeList,
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    oldValue: null,
    previousSibling: null,
    removedNodes: [] as unknown as NodeList,
    ...overrides,
  } as MutationRecord;
}

describe("navigator mutation classification", () => {
  it("separates structural, thumbnail, active-only, and irrelevant changes", () => {
    document.body.innerHTML = '<main><section class="slide" data-wysiwyg-id="slide-1"><p>Text</p></section><aside></aside></main>';
    const slide = document.querySelector("section")!;
    const text = document.querySelector("p")!.firstChild!;
    const aside = document.querySelector("aside")!;

    expect(classifyBridgeMutation(mutation({ type: "attributes", target: slide, attributeName: "class" }), ".slide", "slide-1"))
      .toBe("deck-structural");
    expect(classifyBridgeMutation(mutation({ type: "characterData", target: text }), ".slide", "slide-1"))
      .toBe("thumbnail-affecting");
    expect(classifyBridgeMutation(mutation({ type: "attributes", target: slide, attributeName: "aria-current" }), ".slide", "slide-1"))
      .toBe("active-slide-only");
    expect(classifyBridgeMutation(mutation({ type: "attributes", target: aside, attributeName: "aria-label" }), ".slide", "slide-1"))
      .toBe("irrelevant");
  });

  it("uses the most consequential impact when records are coalesced", () => {
    expect(combineMutationImpacts(["irrelevant", "active-slide-only"])).toBe("active-slide-only");
    expect(combineMutationImpacts(["thumbnail-affecting", "active-slide-only"])).toBe("thumbnail-affecting");
    expect(combineMutationImpacts(["thumbnail-affecting", "deck-structural"])).toBe("deck-structural");
  });
});
