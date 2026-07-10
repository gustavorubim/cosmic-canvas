import { describe, expect, it } from "vitest";
import { planHostEdit } from "./hostEdits.cjs";

describe("targeted VS Code edit planning", () => {
  it("uses the precise range when the expected source still matches", () => {
    expect(planHostEdit("before OLD after", {
      from: 7, to: 10, expected: "OLD", text: "new", fallbackHtml: "fallback",
    })).toEqual({ mode: "targeted", from: 7, to: 10, text: "new" });
  });

  it("falls back visibly when another edit invalidated the range", () => {
    expect(planHostEdit("before changed after", {
      from: 7, to: 10, expected: "OLD", text: "new", fallbackHtml: "canonical",
    })).toEqual({ mode: "fallback", html: "canonical", reason: "source-mismatch" });
  });
});
