import { describe, expect, it } from "vitest";
import { duplicateShortcutBindings, KEYBOARD_SHORTCUTS, shortcutMapRows } from "./shortcuts";

describe("shortcut map", () => {
  it("renders every registered shortcut in the map", () => {
    const rows = shortcutMapRows();

    expect(rows.map((row) => row.id).sort()).toEqual(KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.id).sort());
    expect(rows.every((row) => row.label && row.binding && row.scope && row.when)).toBe(true);
  });

  it("does not register duplicate bindings in the same scope", () => {
    expect(duplicateShortcutBindings()).toEqual([]);
  });
});
