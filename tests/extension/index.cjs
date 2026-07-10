const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

async function waitFor(check, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Cosmic Canvas extension-host state");
}

async function run() {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "cosmic-canvas-extension-"));
  const htmlPath = path.join(fixtureDir, "relative-assets.html");
  const original = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Extension host original</h1><img src="image.svg" alt="fixture"><script type="module" src="module.js"></script></body></html>';
  const font = await fs.readFile(path.resolve(__dirname, "../../fixtures/compatibility/relative-assets/fixture-font.ttf"));
  await Promise.all([
    fs.writeFile(htmlPath, original),
    fs.writeFile(path.join(fixtureDir, "styles.css"), '@font-face{font-family:Fixture;src:url("fixture-font.ttf")}body{background:#eef8f6 url("background.svg");font-family:Fixture,sans-serif}'),
    fs.writeFile(path.join(fixtureDir, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="teal"/></svg>'),
    fs.writeFile(path.join(fixtureDir, "background.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="navy"/></svg>'),
    fs.writeFile(path.join(fixtureDir, "fixture-font.ttf"), font),
    fs.writeFile(path.join(fixtureDir, "module.js"), 'import { value } from "./module-helper.js"; document.body.dataset.moduleValue=value;'),
    fs.writeFile(path.join(fixtureDir, "module-helper.js"), 'export const value="loaded";'),
  ]);

  const uri = vscode.Uri.file(htmlPath);
  await vscode.commands.executeCommand("vscode.openWith", uri, "cosmicCanvas.htmlEditor");
  let pollCount = 0;
  const status = await waitFor(async () => {
    const statuses = await vscode.commands.executeCommand("cosmicCanvas.test.getStatus");
    pollCount += 1;
    if (pollCount % 20 === 0) console.log("Cosmic Canvas extension status:", JSON.stringify(statuses));
    return statuses.find((candidate) => candidate.uri === uri.toString() && candidate.webviewReady && candidate.bridgeReady);
  });
  assert.equal(status.webviewReady, true);
  assert.equal(status.bridgeReady, true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const refreshedStatuses = await vscode.commands.executeCommand("cosmicCanvas.test.getStatus");
  const refreshed = refreshedStatuses.find((candidate) => candidate.uri === uri.toString());
  assert.deepEqual(refreshed.resourceFailures, []);
  assert.ok(refreshed.localResourceCount >= 3);
  assert.equal(refreshed.localResourceMapComplete, true);

  const from = original.indexOf("Extension host original");
  const expected = "Extension host original";
  const replacement = "Extension host edited";
  const fallbackHtml = original.replace(expected, replacement);
  const mode = await vscode.commands.executeCommand("cosmicCanvas.test.applyTargetedEdit", uri.toString(), {
    type: "documentEdit",
    from,
    to: from + expected.length,
    expected,
    text: replacement,
    fallbackHtml,
    reason: "extension-smoke",
  });
  assert.equal(mode, "targeted");
  const document = await vscode.workspace.openTextDocument(uri);
  assert.match(document.getText(), /Extension host edited/);
  await document.save();
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const reopened = await vscode.workspace.openTextDocument(uri);
  assert.match(reopened.getText(), /Extension host edited/);
  assert.equal(await fs.readFile(htmlPath, "utf8"), fallbackHtml);

  await fs.rm(fixtureDir, { recursive: true, force: true });
}

module.exports = { run };
