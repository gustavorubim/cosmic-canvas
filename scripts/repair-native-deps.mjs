import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const nativePackagesByPlatform = {
  "win32-x64": ["@rollup/rollup-win32-x64-msvc", "@esbuild/win32-x64"],
};

const key = `${process.platform}-${process.arch}`;
const packages = nativePackagesByPlatform[key];

if (!packages) {
  console.log(`No native dependency repair is configured for ${key}.`);
  process.exit(0);
}

const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const targets = packages.map((name) => {
  const entry = lockfile.packages?.[`node_modules/${name}`];
  if (!entry?.version) {
    throw new Error(`Could not find ${name} in package-lock.json.`);
  }
  return `${name}@${entry.version}`;
});

const platformArgs = process.platform === "win32" ? ["--os=win32", `--cpu=${process.arch}`] : [];
const args = ["install", "--no-save", "--include=optional", ...platformArgs, ...targets];
console.log(`Repairing native dependencies with: npm ${args.join(" ")}`);

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
const result = spawnSync(command, commandArgs, { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
