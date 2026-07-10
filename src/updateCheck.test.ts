import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, isNewerVersion, UPDATE_CHECK_KEY } from "./updateCheck";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("GitHub release update check", () => {
  it("compares semantic version components without lexical mistakes", () => {
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.1.3", "0.1.3")).toBe(false);
    expect(isNewerVersion("0.1.2", "0.1.3")).toBe(false);
  });

  it("caches the latest release and avoids repeated daily requests", async () => {
    const local = storage();
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: "v0.2.0" }) }));
    expect(await checkForUpdate("0.1.3", local, fetcher, 100_000_000)).toBe("0.2.0");
    expect(await checkForUpdate("0.1.3", local, fetcher, 100_000_001)).toBe("0.2.0");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(local.getItem(UPDATE_CHECK_KEY)).toContain("0.2.0");
  });
});
