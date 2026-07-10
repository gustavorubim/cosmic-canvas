import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
copyFileSync(resolve(root, "src", "hostEdits.cjs"), resolve(root, "out", "hostEdits.cjs"));
copyFileSync(resolve(root, "src", "hostMessageValidation.cjs"), resolve(root, "out", "hostMessageValidation.cjs"));
