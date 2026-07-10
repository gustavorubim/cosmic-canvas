import { describe, expect, it } from "vitest";
import { applySourceOperation, isEditOperation, type SourceLocator } from "./editOperations";

const locator: SourceLocator = { path: [1, 0, 1], tagName: "p", domId: "", classes: ["copy"] };
const source = `<!doctype html><html><head></head><body><main>
  <p class="copy">First</p>
  <p class="copy" data-owner="user">Second</p>
  <p class="copy">Third</p>
</main></body></html>`;

describe("incremental source operations", () => {
  it("updates only the structurally located repeated text node", () => {
    const result = applySourceOperation(source, {
      id: "1", reason: "text", kind: "text", locator, value: "Second & revised",
    });
    expect(result?.source).toContain('<p class="copy" data-owner="user">Second &amp; revised</p>');
    expect(result?.source).toContain('<p class="copy">First</p>');
    expect(result?.source).toContain('<p class="copy">Third</p>');
    expect(result?.edit.expected).toBe("Second");
  });

  it("updates style and class on the exact opening tag while preserving unrelated formatting", () => {
    const styled = applySourceOperation(source, {
      id: "2", reason: "style", kind: "style", locator, value: "color: red;",
    });
    const classed = applySourceOperation(styled!.source, {
      id: "3", reason: "class", kind: "class", locator, value: "copy active",
    });
    expect(classed?.source).toContain('<p class="copy active" data-owner="user" style="color: red;">Second</p>');
    expect(classed?.source.split("\n")[1]).toBe("  <p class=\"copy\">First</p>");
  });

  it("rejects malformed locators and unsupported ambiguous paths", () => {
    expect(isEditOperation({ kind: "text", id: "x", reason: "text", locator: { path: [-1] }, value: "x" })).toBe(false);
    expect(applySourceOperation(source, {
      id: "4", reason: "text", kind: "text", locator: { ...locator, path: [99] }, value: "x",
    })).toBeNull();
  });

  it("applies insert, delete, and replace-subtree operations as bounded source edits", () => {
    const inserted = applySourceOperation(source, {
      id: "5", reason: "insert", kind: "insert", locator, position: "after", html: '<p class="copy">Inserted</p>',
    });
    expect(inserted?.source).toContain('Second</p><p class="copy">Inserted</p>');

    const replaced = applySourceOperation(source, {
      id: "6", reason: "replace", kind: "replace-subtree", locator, html: '<aside id="replacement">Replacement</aside>',
    });
    expect(replaced?.source).toContain('<aside id="replacement">Replacement</aside>');
    expect(replaced?.source).not.toContain("data-owner");

    const deleted = applySourceOperation(source, { id: "7", reason: "delete", kind: "delete", locator });
    expect(deleted?.source).not.toContain("data-owner");
    expect(deleted?.source).toContain("First");
    expect(deleted?.source).toContain("Third");
  });

  it("moves and reorders repeated siblings without serializing unrelated source", () => {
    const first = { ...locator, path: [1, 0, 0] };
    const third = { ...locator, path: [1, 0, 2] };
    const moved = applySourceOperation(source, {
      id: "8", reason: "move", kind: "move", locator: first, target: third, position: "after",
    });
    expect(moved?.source.indexOf("Third")).toBeLessThan(moved?.source.indexOf("First") ?? 0);
    expect(moved?.source).toContain('data-owner="user"');

    const reordered = applySourceOperation(source, {
      id: "9",
      reason: "reorder",
      kind: "reorder",
      locator,
      orderedPaths: [[1, 0, 2], [1, 0, 0], [1, 0, 1]],
    });
    expect(reordered?.source.indexOf("Third")).toBeLessThan(reordered?.source.indexOf("First") ?? 0);
    expect(reordered?.source.indexOf("First")).toBeLessThan(reordered?.source.indexOf("Second") ?? 0);
  });

  it("strictly validates every structural operation payload", () => {
    const base = { id: "x", reason: "test", locator };
    expect(isEditOperation({ ...base, kind: "insert", position: "inside", html: "<b>x</b>" })).toBe(true);
    expect(isEditOperation({ ...base, kind: "insert", position: "sideways", html: "x" })).toBe(false);
    expect(isEditOperation({ ...base, kind: "delete" })).toBe(true);
    expect(isEditOperation({ ...base, kind: "move", target: locator, position: "before" })).toBe(true);
    expect(isEditOperation({ ...base, kind: "move", target: {}, position: "before" })).toBe(false);
    expect(isEditOperation({ ...base, kind: "reorder", orderedPaths: [[1, 0], [-1]] })).toBe(false);
    expect(isEditOperation({ ...base, kind: "replace-subtree", html: "<section></section>" })).toBe(true);
  });
});
