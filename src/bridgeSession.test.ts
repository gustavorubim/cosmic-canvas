import { describe, expect, it } from "vitest";
import { createBridgeSessionToken } from "./bridgeSession";

describe("bridge session tokens", () => {
  it("creates opaque fixed-length tokens without collisions in a practical sample", () => {
    const tokens = Array.from({ length: 100 }, createBridgeSessionToken);
    expect(new Set(tokens)).toHaveLength(tokens.length);
    expect(tokens.every((token) => /^[a-f0-9]{32}$/.test(token))).toBe(true);
  });
});
