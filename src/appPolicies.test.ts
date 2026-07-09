import { describe, expect, it, vi } from "vitest";
import {
  hostDocumentChangeDelay,
  markBeforeUnloadDirty,
  mergeSelectionEcho,
  shouldInstallBeforeUnload,
  shouldShowDeckHint,
} from "./appPolicies";
import { type SelectedElement } from "./protocol";

function selected(id: string, text: string): SelectedElement {
  return {
    id,
    domId: "",
    tagName: "p",
    text,
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
  };
}

describe("app policies", () => {
  it("coalesces host document changes for input/source and sends other edits quickly", () => {
    expect(hostDocumentChangeDelay("input")).toBe(1000);
    expect(hostDocumentChangeDelay("source")).toBe(1000);
    expect(hostDocumentChangeDelay("style")).toBe(250);
    expect(hostDocumentChangeDelay("blur")).toBe(250);
  });

  it("preserves an inspector text draft across stale selection echoes", () => {
    const current = selected("el-1", "newer draft");
    const echo = selected("el-1", "older iframe echo");

    expect(mergeSelectionEcho(current, echo, true)?.text).toBe("newer draft");
    expect(mergeSelectionEcho(current, echo, false)?.text).toBe("older iframe echo");
    expect(mergeSelectionEcho(current, selected("el-2", "other element"), true)?.text).toBe("other element");
  });

  it("installs the browser beforeunload guard only for dirty browser documents", () => {
    expect(shouldInstallBeforeUnload(false, true)).toBe(true);
    expect(shouldInstallBeforeUnload(false, false)).toBe(false);
    expect(shouldInstallBeforeUnload(true, true)).toBe(false);

    const event = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    expect(markBeforeUnloadDirty(event)).toBe("");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });

  it("shows the deck hint only once per loaded document", () => {
    expect(shouldShowDeckHint(0, false)).toBe(false);
    expect(shouldShowDeckHint(3, false)).toBe(true);
    expect(shouldShowDeckHint(3, true)).toBe(false);
  });
});
