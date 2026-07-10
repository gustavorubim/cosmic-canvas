export const UPDATE_CHECK_KEY = "cosmic-canvas-update-check";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type UpdateStorage = Pick<Storage, "getItem" | "setItem">;
type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

function versionParts(value: string) {
  return value.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0).slice(0, 3);
}

export function isNewerVersion(candidate: string, current: string) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((next[index] || 0) > (installed[index] || 0)) return true;
    if ((next[index] || 0) < (installed[index] || 0)) return false;
  }
  return false;
}

export async function checkForUpdate(
  currentVersion: string,
  storage: UpdateStorage,
  fetcher: FetchLike = fetch,
  now = Date.now(),
) {
  try {
    const cached = JSON.parse(storage.getItem(UPDATE_CHECK_KEY) || "null") as {
      checkedAt?: number;
      version?: string;
    } | null;
    if (cached?.checkedAt && now - cached.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      return cached.version && isNewerVersion(cached.version, currentVersion) ? cached.version : null;
    }
    const response = await fetcher("https://api.github.com/repos/gustavorubim/cosmic-canvas/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { tag_name?: unknown };
    const version = typeof payload.tag_name === "string" ? payload.tag_name.replace(/^v/i, "") : "";
    storage.setItem(UPDATE_CHECK_KEY, JSON.stringify({ checkedAt: now, version }));
    return version && isNewerVersion(version, currentVersion) ? version : null;
  } catch {
    return null;
  }
}
