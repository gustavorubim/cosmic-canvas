export type DraftRecord = {
  id: string;
  title: string;
  html: string;
  savedAt: number;
};

export const DRAFT_INDEX_KEY = "cosmic-canvas-drafts";
export const DRAFT_RECORD_PREFIX = "cosmic-canvas-draft:";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function draftIdFor(title: string, baseHtml: string) {
  const normalizedTitle = (title || "untitled").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${normalizedTitle || "untitled"}-${hashString(baseHtml)}`;
}

function readIndex(storage: DraftStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_INDEX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: DraftStorage, ids: string[]) {
  storage.setItem(DRAFT_INDEX_KEY, JSON.stringify(ids.slice(0, 8)));
}

export function readDrafts(storage: DraftStorage = localStorage): DraftRecord[] {
  return readIndex(storage)
    .map((id) => {
      try {
        const parsed = JSON.parse(storage.getItem(DRAFT_RECORD_PREFIX + id) || "null") as DraftRecord | null;
        return parsed && parsed.id === id && typeof parsed.html === "string" ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((draft): draft is DraftRecord => Boolean(draft))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveDraft(storage: DraftStorage, draft: DraftRecord) {
  storage.setItem(DRAFT_RECORD_PREFIX + draft.id, JSON.stringify(draft));
  const ids = [draft.id, ...readIndex(storage).filter((id) => id !== draft.id)];
  writeIndex(storage, ids);
}

export function removeDraft(storage: DraftStorage, id: string) {
  storage.removeItem(DRAFT_RECORD_PREFIX + id);
  writeIndex(
    storage,
    readIndex(storage).filter((existing) => existing !== id),
  );
}
