import { describe, expect, it } from "vitest";
import { DRAFT_INDEX_KEY, DRAFT_RECORD_PREFIX, draftIdFor, readDrafts, removeDraft, saveDraft } from "./drafts";

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

describe("draft storage", () => {
  it("keeps separate drafts for documents with different names or base hashes", () => {
    const storage = memoryStorage();
    const firstId = draftIdFor("deck.html", "<h1>One</h1>");
    const secondId = draftIdFor("notes.html", "<h1>One</h1>");

    saveDraft(storage, { id: firstId, title: "deck.html", html: "<h1>Edited deck</h1>", savedAt: 10 });
    saveDraft(storage, { id: secondId, title: "notes.html", html: "<h1>Edited notes</h1>", savedAt: 20 });

    const drafts = readDrafts(storage);
    expect(drafts.map((draft) => draft.id)).toEqual([secondId, firstId]);
    expect(drafts.find((draft) => draft.id === firstId)?.html).toContain("Edited deck");
    expect(storage.getItem(DRAFT_INDEX_KEY)).toContain(secondId);
    expect(storage.getItem(DRAFT_RECORD_PREFIX + firstId)).toContain("Edited deck");
  });

  it("removes one draft without deleting the others", () => {
    const storage = memoryStorage();
    const firstId = draftIdFor("deck.html", "a");
    const secondId = draftIdFor("deck.html", "b");
    saveDraft(storage, { id: firstId, title: "deck.html", html: "first", savedAt: 1 });
    saveDraft(storage, { id: secondId, title: "deck.html", html: "second", savedAt: 2 });

    removeDraft(storage, secondId);

    expect(readDrafts(storage).map((draft) => draft.id)).toEqual([firstId]);
    expect(storage.getItem(DRAFT_RECORD_PREFIX + secondId)).toBeNull();
  });
});
