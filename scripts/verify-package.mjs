import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import yauzl from "yauzl";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const releaseWorkflow = readFileSync(resolve(root, ".github", "workflows", "release.yml"), "utf8");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(packageLock.version === packageJson.version, "package-lock top-level version differs from package.json");
check(
  packageLock.packages?.[""]?.version === packageJson.version,
  "package-lock root package version differs from package.json",
);
check(
  !/cosmic-canvas-\d+\.\d+\.\d+\.vsix/i.test(readme),
  "README contains a hardcoded versioned VSIX filename",
);
check(readme.includes("cosmic-canvas-<version>.vsix"), "README does not document the version-neutral VSIX name");
check(releaseWorkflow.includes('tags: ["v*"]'), "Release workflow is not tied to version tags");
check(releaseWorkflow.includes("npm run vsix:release"), "Release workflow does not use the reproducible VSIX/checksum command");
check(releaseWorkflow.includes("cosmic-canvas-*.vsix.sha256"), "Release workflow does not publish the checksum metadata");

const listingCommand = process.platform === "win32" ? "cmd.exe" : "npx";
const listingArgs =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npx vsce ls --no-dependencies"]
    : ["vsce", "ls", "--no-dependencies"];
const listingResult = spawnSync(listingCommand, listingArgs, {
  cwd: root,
  encoding: "utf8",
});
check(
  listingResult.status === 0,
  `vsce package listing failed: ${listingResult.error?.message || listingResult.stderr || listingResult.stdout || "unknown error"}`,
);

const packageFiles = (listingResult.stdout || "")
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/\\/g, "/"))
  .filter(Boolean);
const bannedPrefixes = ["docs/", "fixtures/", "output/", "src/", "scripts/", "tmp/"];
const bannedExact = new Set(["plan.md"]);
packageFiles.forEach((file) => {
  if (bannedExact.has(file) || bannedPrefixes.some((prefix) => file.startsWith(prefix))) {
    failures.push(`VSIX package contains non-runtime file: ${file}`);
  }
});
["README.md", "package.json", "LICENSE", "out/extension.cjs", "out/hostEdits.cjs", "out/hostMessageValidation.cjs", "resources/icon.png"].forEach((file) => {
  check(packageFiles.includes(file), `VSIX package is missing required file: ${file}`);
});

function readVsixMetadata(vsixPath) {
  return new Promise((resolveMetadata, reject) => {
    yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError || new Error("Unable to open VSIX"));
        return;
      }
      const content = new Map();
      const wanted = new Set(["extension/package.json", "extension.vsixmanifest"]);
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (!wanted.has(entry.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError || new Error("Unable to read extension/package.json"));
            return;
          }
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            content.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => {
        if ([...wanted].some((name) => !content.has(name))) {
          reject(new Error("VSIX is missing extension package or manifest metadata"));
          return;
        }
        try {
          const extensionPackage = JSON.parse(content.get("extension/package.json"));
          const manifest = content.get("extension.vsixmanifest");
          const identityTag = manifest.match(/<Identity\b[^>]*>/i)?.[0] || "";
          const identity = {
            id: identityTag.match(/\bId="([^"]+)"/i)?.[1] || "",
            version: identityTag.match(/\bVersion="([^"]+)"/i)?.[1] || "",
            publisher: identityTag.match(/\bPublisher="([^"]+)"/i)?.[1] || "",
          };
          resolveMetadata({ extensionPackage, identity });
        } catch (error) {
          reject(error);
        }
      });
      zip.on("error", reject);
    });
  });
}

if (process.argv.includes("--require-vsix")) {
  const expectedName = `cosmic-canvas-${packageJson.version}.vsix`;
  const vsixPath = resolve(root, expectedName);
  check(existsSync(vsixPath), `Expected release artifact is missing: ${expectedName}`);
  if (existsSync(vsixPath)) {
    try {
      const metadata = await readVsixMetadata(vsixPath);
      check(
        metadata.extensionPackage.version === packageJson.version,
        `${basename(vsixPath)} package version ${metadata.extensionPackage.version} differs from ${packageJson.version}`,
      );
      check(metadata.identity.version === packageJson.version, "VSIX XML manifest version differs from package.json");
      check(metadata.identity.id === packageJson.name, "VSIX XML manifest id differs from package name");
      check(metadata.identity.publisher === packageJson.publisher, "VSIX XML manifest publisher differs from package.json");
      const checksumPath = `${vsixPath}.sha256`;
      check(existsSync(checksumPath), `Expected checksum is missing: ${basename(checksumPath)}`);
      if (existsSync(checksumPath)) {
        const expectedHash = createHash("sha256").update(readFileSync(vsixPath)).digest("hex");
        const recordedHash = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
        check(recordedHash === expectedHash, `${basename(checksumPath)} does not match the VSIX bytes`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
}

if (failures.length) {
  console.error("Package verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Package verification passed for Cosmic Canvas ${packageJson.version}.`);
  console.log(`Runtime package files: ${packageFiles.length}`);
}
