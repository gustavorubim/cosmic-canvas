import { describe, expect, it } from "vitest";
import { isBridgeCommand, isBridgeMessage } from "./protocol";

describe("bridge message validation", () => {
  it("accepts a well-formed session-scoped ready message", () => {
    expect(isBridgeMessage({
      type: "wysiwyg-ready",
      title: "Deck",
      bodyTextStart: "Opening",
      sessionToken: "token",
    })).toBe(true);
  });

  it("rejects known message names with malformed payloads", () => {
    expect(isBridgeMessage({ type: "wysiwyg-ready", title: 1, bodyTextStart: "x" })).toBe(false);
    expect(isBridgeMessage({ type: "wysiwyg-deck", slides: "many", activeId: "" })).toBe(false);
    expect(isBridgeMessage({ type: "wysiwyg-outline", items: [], truncated: "no" })).toBe(false);
    expect(isBridgeMessage({ type: "wysiwyg-layers", layers: [{ id: 1 }] })).toBe(false);
    expect(isBridgeMessage({ type: "wysiwyg-shortcut", action: "erase-everything" })).toBe(false);
  });

  it("bounds document-change payloads", () => {
    expect(isBridgeMessage({
      type: "wysiwyg-document-change",
      reason: "input",
      html: "x".repeat(20_000_001),
      scrollX: 0,
      scrollY: 0,
    })).toBe(false);
  });
});

describe("bridge command validation", () => {
  it("accepts valid commands across simple and structured payloads", () => {
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "set-mode", mode: "text", sessionToken: "token" })).toBe(true);
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "insert-table", columns: ["Name"], rows: [["Ada"]], title: "People" })).toBe(true);
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "request-html" })).toBe(true);
  });

  it("rejects malformed, oversized, unknown, and extra command payload fields", () => {
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "set-mode", mode: "destroy" })).toBe(false);
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "select", id: 7 })).toBe(false);
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "set-text", text: "x".repeat(2_000_001) })).toBe(false);
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "request-html", surprise: true })).toBe(false);
    expect(isBridgeCommand({ type: "wysiwyg-command", command: "erase-everything" })).toBe(false);
  });
});
