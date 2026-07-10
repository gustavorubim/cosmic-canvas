import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from "@vscode/test-electron";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yauzl from "yauzl";

const root = resolve(import.meta.dirname, "..");
const extensionTestsPath = resolve(root, "tests", "extension", "index.cjs");
const requestedVersion = process.argv.find((argument) => argument.startsWith("--version="))?.slice("--version=".length);
const requestedVsix = process.argv.find((argument) => argument.startsWith("--vsix="))?.slice("--vsix=".length);
const offline = process.argv.includes("--offline");
const installExactVsix = process.argv.includes("--install");
const version = requestedVersion || process.env.VSCODE_TEST_VERSION || "stable";

function extractPackagedExtension(vsixPath, outputPath) {
  return new Promise((resolveExtraction, reject) => {
    yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError || new Error("Unable to open temporary VSIX"));
      zip.readEntry();
      zip.on("entry", async (entry) => {
        try {
          if (!entry.fileName.startsWith("extension/") || entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          const relative = entry.fileName.slice("extension/".length);
          const target = resolve(outputPath, relative);
          const rootPrefix = `${resolve(outputPath)}${process.platform === "win32" ? "\\" : "/"}`;
          if (!target.startsWith(rootPrefix)) throw new Error(`Unsafe VSIX entry: ${entry.fileName}`);
          await mkdir(dirname(target), { recursive: true });
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return reject(streamError || new Error(`Unable to read ${entry.fileName}`));
            const output = createWriteStream(target);
            stream.pipe(output);
            output.on("finish", () => zip.readEntry());
            output.on("error", reject);
          });
        } catch (error) {
          reject(error);
        }
      });
      zip.on("end", resolveExtraction);
      zip.on("error", reject);
    });
  });
}

const temporary = await mkdtemp(join(tmpdir(), "cosmic-canvas-packaged-test-"));
try {
  if (requestedVsix && (!/^cosmic-canvas-\d+\.\d+\.\d+\.vsix$/.test(requestedVsix) || resolve(root, requestedVsix) !== join(root, requestedVsix))) {
    throw new Error("--vsix must name a versioned Cosmic Canvas candidate in the repository root");
  }
  const vsixPath = requestedVsix ? resolve(root, requestedVsix) : join(temporary, "candidate.vsix");
  if (!requestedVsix) {
    const vsceCli = resolve(root, "node_modules", "@vscode", "vsce", "vsce");
    const packaged = spawnSync(process.execPath, [vsceCli, "package", "--no-dependencies", "--out", vsixPath], {
      cwd: root,
      stdio: "inherit",
    });
    if (packaged.status !== 0) {
      throw new Error(`Unable to build temporary packaged-extension test candidate (${packaged.error?.message || packaged.status})`);
    }
  }
  const extensionDevelopmentPath = join(temporary, "extension");
  const userDataDir = join(temporary, "user-data");
  const extensionsDir = join(temporary, "extensions");
  if (installExactVsix) {
    if (!requestedVsix) throw new Error("--install requires --vsix=<candidate.vsix>");
    await Promise.all([mkdir(userDataDir, { recursive: true }), mkdir(extensionsDir, { recursive: true }), mkdir(extensionDevelopmentPath, { recursive: true })]);
    await writeFile(join(extensionDevelopmentPath, "package.json"), JSON.stringify({
      name: "cosmic-canvas-test-driver",
      displayName: "Cosmic Canvas test driver",
      publisher: "local",
      version: "0.0.0",
      engines: { vscode: "^1.90.0" },
      main: "./extension.cjs",
      activationEvents: ["*"],
    }));
    await writeFile(join(extensionDevelopmentPath, "extension.cjs"), "exports.activate = function activate() {};\n");
    const executable = await downloadAndUnzipVSCode(version);
    const [cli, ...cliPrefix] = resolveCliArgsFromVSCodeExecutablePath(executable);
    const cleanCliPrefix = cliPrefix.filter((argument) =>
      !argument.startsWith("--user-data-dir=") && !argument.startsWith("--extensions-dir="),
    );
    const installed = spawnSync(cli, [
      ...cleanCliPrefix,
      "--user-data-dir", userDataDir,
      "--extensions-dir", extensionsDir,
      "--install-extension", vsixPath,
      "--force",
    ], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    if (installed.status !== 0) throw new Error(`Unable to install exact VSIX (${installed.error?.message || installed.status})`);
  } else {
    await mkdir(extensionDevelopmentPath, { recursive: true });
    await extractPackagedExtension(vsixPath, extensionDevelopmentPath);
  }
  console.log(`Testing ${installExactVsix ? "installed exact VSIX" : requestedVsix ? "exact release-candidate" : "packaged extension"} against VS Code ${version}${offline ? " with network blocked" : ""}.`);
  await runTests({
    version,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      ...(!installExactVsix ? ["--disable-extensions"] : ["--user-data-dir", userDataDir, "--extensions-dir", extensionsDir]),
      "--skip-welcome",
      "--skip-release-notes",
      ...(offline ? ["--proxy-server=127.0.0.1:9"] : []),
    ],
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
