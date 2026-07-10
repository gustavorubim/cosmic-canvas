import { describe, expect, it } from "vitest";
import {
  beginPreview,
  appendPreviewDiagnostic,
  formatDiagnosticsText,
  markPreviewReady,
  markPreviewTimedOut,
  withVersionMismatch,
} from "./diagnostics";

describe("preview diagnostics", () => {
  it("starts in loading and detects document CSP", () => {
    const status = beginPreview(
      4,
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head></html>',
    );
    expect(status.state).toBe("loading");
    expect(status.revision).toBe(4);
    expect(status.diagnostics.map((entry) => entry.code)).toEqual([
      "bridge-loading",
      "document-csp-detected",
    ]);
  });

  it("moves a healthy preview to ready and a CSP preview to degraded", () => {
    const healthy = markPreviewReady(beginPreview(1, "<p>ok</p>"), {
      title: "Healthy",
      bodyTextStart: "ok",
    });
    const csp = markPreviewReady(
      beginPreview(2, '<meta http-equiv="content-security-policy" content="default-src none">'),
      { title: "CSP", bodyTextStart: "" },
    );
    expect(healthy.state).toBe("ready");
    expect(csp.state).toBe("degraded");
    expect(healthy.diagnostics.map((entry) => entry.code)).toEqual(["bridge-ready"]);
  });

  it("turns only a still-loading preview into a failed timeout", () => {
    const loading = beginPreview(1, "<p>late</p>");
    const failed = markPreviewTimedOut(loading);
    const ready = markPreviewReady(loading, { title: "Done", bodyTextStart: "late" });
    expect(failed.state).toBe("failed");
    expect(failed.diagnostics.some((entry) => entry.code === "bridge-timeout")).toBe(true);
    expect(markPreviewTimedOut(ready)).toEqual(ready);
  });

  it("surfaces host version drift and formats copyable diagnostics", () => {
    const preview = withVersionMismatch(
      markPreviewReady(beginPreview(3, "<p>x</p>"), { title: "Test", bodyTextStart: "x" }),
      "0.1.3",
      "0.1.2",
    );
    expect(preview.state).toBe("degraded");
    const text = formatDiagnosticsText({
      appVersion: "0.1.3",
      hostMode: "VS Code",
      extensionVersion: "0.1.2",
      vscodeVersion: "1.128.0",
      browserEngine: "test-agent",
      fileName: "deck.html",
      uri: "file:///deck.html",
      baseUri: "https://resource.test/",
      trustedScripts: false,
      forceTimeline: true,
      preview,
    });
    expect(text).toContain("App version: 0.1.3");
    expect(text).toContain("host-version-mismatch");
    expect(text).toContain("URI: file:///deck.html");
    expect(text).toContain("Resource base: https://resource.test/");
  });

  it("classifies relative resources with and without an accessible base", () => {
    const html = '<link href="styles.css"><img src="images/demo.png"><a href="#local">Jump</a>';
    const unresolved = beginPreview(1, html);
    const resolved = beginPreview(2, html, "https://resource.test/document/");
    expect(unresolved.diagnostics.some((entry) => entry.code === "relative-assets-unresolved")).toBe(true);
    expect(resolved.diagnostics.some((entry) => entry.code === "relative-assets-resolved")).toBe(true);
  });

  it("promotes a ready preview to degraded when a resource warning arrives", () => {
    const ready = markPreviewReady(beginPreview(1, "<p>x</p>"), { title: "x", bodyTextStart: "x" });
    const next = appendPreviewDiagnostic(ready, {
      id: "resource-demo",
      code: "resource-unavailable",
      severity: "warning",
      title: "Resource unavailable",
      message: "demo.png failed",
    });
    expect(next.state).toBe("degraded");
  });
});
