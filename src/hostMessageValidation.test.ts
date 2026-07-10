import { describe, expect, it } from "vitest";
import { isWebviewMessage } from "./hostMessageValidation.cjs";

describe("VS Code host message validation", () => {
  it("accepts the legitimate save, range-edit, status, and binary payloads", () => {
    expect(isWebviewMessage({ type: "save", html: "<p>ok</p>" })).toBe(true);
    expect(isWebviewMessage({ type: "documentEdit", from: 0, to: 1, text: "x", expected: "y", fallbackHtml: "x", reason: "input" })).toBe(true);
    expect(isWebviewMessage({ type: "bridgeStatus", state: "ready", codes: ["bridge-ready"] })).toBe(true);
    expect(isWebviewMessage({ type: "downloadBinary", fileName: "deck.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", base64: "AA==" })).toBe(true);
  });

  it("rejects oversized, malformed, path-bearing, and extra host payloads", () => {
    expect(isWebviewMessage({ type: "save", html: "x".repeat(20_000_001) })).toBe(false);
    expect(isWebviewMessage({ type: "documentEdit", from: -1, to: 0, text: "", expected: "", fallbackHtml: "" })).toBe(false);
    expect(isWebviewMessage({ type: "downloadBinary", fileName: "../deck.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", base64: "AA==" })).toBe(false);
    expect(isWebviewMessage({ type: "ready", extra: true })).toBe(false);
    expect(isWebviewMessage({ type: "unknown" })).toBe(false);
  });
});
