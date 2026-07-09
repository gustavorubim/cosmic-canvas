export type Checkpoint = {
  id: string;
  name: string;
  html: string;
  createdAt: number;
};

function fallbackName(index: number) {
  return `Checkpoint ${index + 1}`;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

export function createCheckpoint(
  checkpoints: Checkpoint[],
  html: string,
  name: string,
  now = Date.now(),
): Checkpoint[] {
  const cleanName = name.trim() || fallbackName(checkpoints.length);
  const checkpoint: Checkpoint = {
    id: `checkpoint-${now}-${slug(cleanName) || checkpoints.length + 1}`,
    name: cleanName,
    html,
    createdAt: now,
  };
  return [checkpoint, ...checkpoints].slice(0, 24);
}

export function restoreCheckpoint(checkpoints: Checkpoint[], id: string) {
  return checkpoints.find((checkpoint) => checkpoint.id === id)?.html ?? null;
}
