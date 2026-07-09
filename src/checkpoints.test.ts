import { describe, expect, it } from "vitest";
import { type Checkpoint, createCheckpoint, restoreCheckpoint } from "./checkpoints";

describe("checkpoints", () => {
  it("creates a named checkpoint and restores exact HTML", () => {
    const html = "<!doctype html><html><body><p>Before cleanup</p></body></html>";
    const checkpoints = createCheckpoint([], html, "Before cleanup", 1234);

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      id: "checkpoint-1234-before-cleanup",
      name: "Before cleanup",
      html,
      createdAt: 1234,
    });
    expect(restoreCheckpoint(checkpoints, checkpoints[0].id)).toBe(html);
  });

  it("keeps the jump list bounded with newest checkpoints first", () => {
    let checkpoints: Checkpoint[] = [];
    for (let index = 0; index < 30; index += 1) {
      checkpoints = createCheckpoint(checkpoints, `<p>${index}</p>`, `Save ${index}`, index);
    }

    expect(checkpoints).toHaveLength(24);
    expect(checkpoints[0].name).toBe("Save 29");
    expect(checkpoints.at(-1)?.name).toBe("Save 6");
  });
});
