import { describe, expect, it } from "vitest";
import {
  DECK_PREFERENCE_PREFIX,
  DEFAULT_DECK_PREFERENCE,
  readDeckPreference,
  saveDeckPreference,
} from "./deckPreferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("deck preferences", () => {
  it("keeps recovery choices isolated by document", () => {
    const storage = memoryStorage();
    saveDeckPreference(storage, "deck-a", { mode: "selector", selector: ".page" });
    saveDeckPreference(storage, "deck-b", { mode: "siblings", selector: "", siblingPath: [1, 0] });

    expect(readDeckPreference(storage, "deck-a")).toEqual({ mode: "selector", selector: ".page" });
    expect(readDeckPreference(storage, "deck-b")).toEqual({ mode: "siblings", selector: "", siblingPath: [1, 0] });
    expect(readDeckPreference(storage, "deck-c")).toEqual(DEFAULT_DECK_PREFERENCE);
  });

  it("rejects corrupt values and bounds selectors", () => {
    const storage = memoryStorage();
    storage.setItem(DECK_PREFERENCE_PREFIX + "bad", "not json");
    storage.setItem(
      DECK_PREFERENCE_PREFIX + "long",
      JSON.stringify({ mode: "selector", selector: "x".repeat(700) }),
    );

    expect(readDeckPreference(storage, "bad")).toEqual(DEFAULT_DECK_PREFERENCE);
    expect(readDeckPreference(storage, "long").selector).toHaveLength(500);
  });

  it("removes the default instead of accumulating storage entries", () => {
    const storage = memoryStorage();
    saveDeckPreference(storage, "deck", { mode: "force", selector: "" });
    saveDeckPreference(storage, "deck", DEFAULT_DECK_PREFERENCE);
    expect(storage.getItem(DECK_PREFERENCE_PREFIX + "deck")).toBeNull();
  });
});
