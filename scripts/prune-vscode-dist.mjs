import { rmSync } from "node:fs";

rmSync(new URL("../dist/stress-fixtures", import.meta.url), {
  recursive: true,
  force: true,
});
