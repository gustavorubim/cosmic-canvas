import { describe, expect, it } from "vitest";
import { isVsCodeHostMessage } from "./vscodeBridge";

describe("VS Code-to-app message validation", () => {
  it("accepts bounded document, toast, and host-edit messages", () => {
    expect(isVsCodeHostMessage({
      type: "cosmicCanvas.document",
      html: "<p>ok</p>",
      fileName: "deck.html",
      uri: "file:///deck.html",
      extensionVersion: "1.0.0",
      vscodeVersion: "1.90.0",
      baseUri: "vscode-webview://document/",
      resources: { "image.svg": "data:image/svg+xml;base64,AA==" },
    })).toBe(true);
    expect(isVsCodeHostMessage({ type: "cosmicCanvas.toast", message: "Saved" })).toBe(true);
    expect(isVsCodeHostMessage({ type: "cosmicCanvas.hostEdit", mode: "targeted" })).toBe(true);
  });

  it("rejects malformed, oversized, and extra host fields", () => {
    const valid = {
      type: "cosmicCanvas.document",
      html: "x",
      fileName: "deck.html",
      uri: "file:///deck.html",
      extensionVersion: "1",
      vscodeVersion: "1",
      baseUri: "",
      resources: {},
    };
    expect(isVsCodeHostMessage({ ...valid, html: "x".repeat(20_000_001) })).toBe(false);
    expect(isVsCodeHostMessage({ ...valid, resources: { image: 7 } })).toBe(false);
    expect(isVsCodeHostMessage({ ...valid, unexpected: true })).toBe(false);
    expect(isVsCodeHostMessage({ type: "cosmicCanvas.hostEdit", mode: "full" })).toBe(false);
  });
});
