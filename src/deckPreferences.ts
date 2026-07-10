export type DeckDetectionMode = "auto" | "force" | "selector" | "siblings" | "marked";

export type DeckPreference = {
  mode: DeckDetectionMode;
  selector: string;
  siblingPath?: number[];
  markedPaths?: number[][];
};

export const DEFAULT_DECK_PREFERENCE: DeckPreference = { mode: "auto", selector: "" };
export const DECK_PREFERENCE_PREFIX = "cosmic-canvas-deck-preference:";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readDeckPreference(
  storage: PreferenceStorage,
  documentId: string,
): DeckPreference {
  if (!documentId) return DEFAULT_DECK_PREFERENCE;
  try {
    const parsed = JSON.parse(storage.getItem(DECK_PREFERENCE_PREFIX + documentId) || "null") as Partial<DeckPreference> | null;
    if (!parsed || !["auto", "force", "selector", "siblings", "marked"].includes(String(parsed.mode))) {
      return DEFAULT_DECK_PREFERENCE;
    }
    return {
      mode: parsed.mode as DeckDetectionMode,
      selector: typeof parsed.selector === "string" ? parsed.selector.slice(0, 500) : "",
      siblingPath: Array.isArray(parsed.siblingPath)
        ? parsed.siblingPath.filter((part) => Number.isInteger(part) && part >= 0).slice(0, 64)
        : undefined,
      markedPaths: Array.isArray(parsed.markedPaths)
        ? parsed.markedPaths
            .filter((path): path is number[] => Array.isArray(path))
            .map((path) => path.filter((part) => Number.isInteger(part) && part >= 0).slice(0, 64))
            .filter((path) => path.length > 0)
            .slice(0, 500)
        : undefined,
    };
  } catch {
    return DEFAULT_DECK_PREFERENCE;
  }
}

export function saveDeckPreference(
  storage: PreferenceStorage,
  documentId: string,
  preference: DeckPreference,
) {
  if (!documentId) return;
  if (preference.mode === "auto" && !preference.selector && !preference.siblingPath?.length && !preference.markedPaths?.length) {
    storage.removeItem(DECK_PREFERENCE_PREFIX + documentId);
    return;
  }
  storage.setItem(DECK_PREFERENCE_PREFIX + documentId, JSON.stringify(preference));
}
