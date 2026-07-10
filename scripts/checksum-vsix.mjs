import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const fileName = `cosmic-canvas-${packageJson.version}.vsix`;
const filePath = resolve(import.meta.dirname, "..", fileName);
const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
const output = `${digest}  ${fileName}\n`;
writeFileSync(`${filePath}.sha256`, output);
console.log(output.trim());
