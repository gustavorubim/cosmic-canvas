import * as fs from "node:fs";
import * as path from "node:path";
import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import * as vscode from "vscode";
import { planHostEdit } from "./hostEdits.cjs";
import { isWebviewMessage } from "./hostMessageValidation.cjs";

const VIEW_TYPE = "cosmicCanvas.htmlEditor";
const testStatuses = new Map<string, {
  uri: string;
  webviewReady: boolean;
  bridgeReady: boolean;
  bridgeState: "loading" | "ready" | "degraded" | "failed";
  diagnosticCodes: string[];
  resourceFailures: string[];
  localResourceCount: number;
  localResourceMapComplete: boolean;
  lastEditMode: "targeted" | "fallback" | "none";
}>();

function localResourceMapComplete(resources: Record<string, string>) {
  return Object.values(resources).every((dataUrl) => {
    if (!dataUrl.startsWith("data:")) return false;
    const headerEnd = dataUrl.indexOf(",");
    if (headerEnd < 0 || !/^(?:data:text\/css|data:text\/javascript)/i.test(dataUrl)) return true;
    const source = Buffer.from(dataUrl.slice(headerEnd + 1), "base64").toString("utf8");
    const unresolvedCss = /url\(\s*["']?(?!data:|https?:|#|\/)[^)"']+/i.test(source);
    const unresolvedModule = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](?!data:|https?:|\/)[^"']+["']|import\(\s*["'](?!data:|https?:|\/)/i.test(source);
    return !unresolvedCss && !unresolvedModule;
  });
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

const LOCAL_RESOURCE_MIME: Record<string, string> = {
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
) {
  const matches = Array.from(input.matchAll(pattern));
  if (!matches.length) return input;
  const replacements = await Promise.all(matches.map(replacer));
  let output = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    const offset = match.index || 0;
    output += input.slice(cursor, offset) + replacements[index];
    cursor = offset + match[0].length;
  });
  return output + input.slice(cursor);
}

async function buildLocalResourceMap(html: string, directory: vscode.Uri) {
  const resources: Record<string, string> = {};
  let totalBytes = 0;
  const root = path.resolve(directory.fsPath);
  const cache = new Map<string, string>();
  const isLocalReference = (reference: string) => Boolean(reference) &&
    !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(reference);
  const safeTarget = (reference: string, containingDirectory: string) => {
    if (!isLocalReference(reference)) return "";
    const targetPath = path.resolve(containingDirectory, reference.split(/[?#]/)[0]);
    const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
    return targetPath === root || targetPath.toLowerCase().startsWith(rootPrefix.toLowerCase()) ? targetPath : "";
  };

  const bundleFile = async (targetPath: string, stack: Set<string>): Promise<string> => {
    if (cache.has(targetPath)) return cache.get(targetPath)!;
    if (stack.has(targetPath)) throw new Error("Circular local resource dependency");
    const mime = LOCAL_RESOURCE_MIME[path.extname(targetPath).toLowerCase()];
    if (!mime) throw new Error("Unsupported local resource type");
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(targetPath));
    if (content.byteLength > 5_000_000 || totalBytes + content.byteLength > 12_000_000) {
      throw new Error("Local resource exceeds preview size limit");
    }
    totalBytes += content.byteLength;
    const nextStack = new Set(stack).add(targetPath);
    let bundled = Buffer.from(content);

    if (mime === "text/css") {
      const directoryName = path.dirname(targetPath);
      let css = bundled.toString("utf8");
      css = await replaceAsync(css, /url\(\s*(["']?)(.*?)\1\s*\)/gi, async (match) => {
        const dependency = safeTarget(match[2], directoryName);
        if (!dependency) return match[0];
        try {
          return `url("${await bundleFile(dependency, nextStack)}")`;
        } catch {
          return match[0];
        }
      });
      css = await replaceAsync(css, /@import\s+(["'])(.*?)\1/gi, async (match) => {
        const dependency = safeTarget(match[2], directoryName);
        if (!dependency) return match[0];
        try {
          return `@import url("${await bundleFile(dependency, nextStack)}")`;
        } catch {
          return match[0];
        }
      });
      bundled = Buffer.from(css, "utf8");
    } else if (mime === "text/javascript") {
      const directoryName = path.dirname(targetPath);
      let source = bundled.toString("utf8");
      source = await replaceAsync(
        source,
        /((?:import|export)\s+(?:[^"']*?\s+from\s+)?|import\(\s*)(["'])([^"']+)\2/g,
        async (match) => {
          const dependency = safeTarget(match[3], directoryName);
          if (!dependency) return match[0];
          try {
            const dataUrl = await bundleFile(dependency, nextStack);
            return `${match[1]}${match[2]}${dataUrl}${match[2]}`;
          } catch {
            return match[0];
          }
        },
      );
      bundled = Buffer.from(source, "utf8");
    }

    const dataUrl = `data:${mime};base64,${bundled.toString("base64")}`;
    cache.set(targetPath, dataUrl);
    return dataUrl;
  };

  const references = new Set<string>();
  const attributePattern = /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(html))) references.add(match[1]);
  const cssPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  while ((match = cssPattern.exec(html))) references.add(match[2]);

  for (const reference of references) {
    const targetPath = safeTarget(reference, root);
    if (!targetPath) continue;
    try {
      resources[reference] = await bundleFile(targetPath, new Set());
    } catch {
      // The iframe resource diagnostic reports missing references individually.
    }
  }
  return resources;
}

type WebviewMessage =
  | { type: "ready" }
  | { type: "documentChanged"; html: string; reason?: string }
  | { type: "documentEdit"; from: number; to: number; text: string; expected: string; fallbackHtml: string; reason?: string }
  | { type: "bridgeStatus"; state: "loading" | "ready" | "degraded" | "failed"; codes?: string[]; resourceFailures?: string[] }
  | { type: "save"; html: string }
  | { type: "copy"; html: string }
  | { type: "copyText"; text: string }
  | { type: "download"; html: string }
  | { type: "downloadBinary"; fileName: string; contentType: string; base64: string }
  | { type: "openFile" };

export function activate(context: vscode.ExtensionContext) {
  const provider = new CosmicCanvasEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cosmicCanvas.test.getStatus", () => Array.from(testStatuses.values())),
    vscode.commands.registerCommand("cosmicCanvas.test.applyTargetedEdit", async (
      uriValue: string,
      edit: Extract<WebviewMessage, { type: "documentEdit" }>,
    ) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriValue));
      const mode = await applyPlannedDocumentEdit(document, edit);
      const status = testStatuses.get(uriValue);
      if (status) status.lastEditMode = mode;
      return mode;
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cosmicCanvas.openAsEditor", async (uri?: vscode.Uri) => {
      let target = uri;
      if (!target) {
        target = vscode.window.activeTextEditor?.document.uri;
      }
      if (!target) {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { HTML: ["html", "htm"] },
        });
        target = picked?.[0];
      }
      if (target) {
        await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
      }
    }),
  );
}

export function deactivate() {
  // Nothing to dispose; subscriptions are owned by VS Code.
}

class CosmicCanvasEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const documentDirectory = vscode.Uri.joinPath(document.uri, "..");
    const status: {
      uri: string;
      webviewReady: boolean;
      bridgeReady: boolean;
      bridgeState: "loading" | "ready" | "degraded" | "failed";
      diagnosticCodes: string[];
      resourceFailures: string[];
      localResourceCount: number;
      localResourceMapComplete: boolean;
      lastEditMode: "targeted" | "fallback" | "none";
    } = {
      uri: document.uri.toString(),
      webviewReady: false,
      bridgeReady: false,
      bridgeState: "loading",
      diagnosticCodes: [],
      resourceFailures: [],
      localResourceCount: 0,
      localResourceMapComplete: true,
      lastEditMode: "none",
    };
    testStatuses.set(status.uri, status);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        documentDirectory,
      ],
    };
    webview.html = this.webviewHtml(webview);

    let applyingFromWebview = false;

    const postDocument = async () => {
      const resources = await buildLocalResourceMap(document.getText(), documentDirectory);
      status.localResourceCount = Object.keys(resources).length;
      status.localResourceMapComplete = localResourceMapComplete(resources);
      await webview.postMessage({
        type: "cosmicCanvas.document",
        html: document.getText(),
        fileName: path.basename(document.fileName),
          uri: document.uri.toString(),
          extensionVersion: String(this.context.extension.packageJSON.version || "unknown"),
          vscodeVersion: vscode.version,
          baseUri: ensureTrailingSlash(webview.asWebviewUri(documentDirectory).toString()),
          resources,
      });
    };

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (applyingFromWebview) return;
      void postDocument();
    });

    webviewPanel.onDidDispose(() => documentChangeSubscription.dispose());

    webview.onDidReceiveMessage(async (candidate: unknown) => {
      if (!isWebviewMessage(candidate)) {
        if (!status.diagnosticCodes.includes("host-message-rejected")) status.diagnosticCodes.push("host-message-rejected");
        return;
      }
      const message = candidate as WebviewMessage;
      try {
        switch (message.type) {
          case "ready":
            status.webviewReady = true;
            void postDocument();
            break;
          case "bridgeStatus":
            status.bridgeReady = status.bridgeReady || message.state === "ready" ||
              (message.state === "degraded" && message.codes?.includes("bridge-ready") === true);
            status.bridgeState = message.state;
            status.diagnosticCodes = Array.isArray(message.codes) ? message.codes.filter((code) => typeof code === "string") : [];
            status.resourceFailures = Array.isArray(message.resourceFailures)
              ? message.resourceFailures.filter((failure) => typeof failure === "string")
              : [];
            break;
          case "documentChanged":
            applyingFromWebview = true;
            await replaceDocumentText(document, message.html);
            applyingFromWebview = false;
            break;
          case "documentEdit": {
            applyingFromWebview = true;
            const mode = await applyPlannedDocumentEdit(document, message);
            status.lastEditMode = mode;
            const plan = planHostEdit(document.getText(), message);
            await webview.postMessage({
              type: "cosmicCanvas.hostEdit",
              mode,
              reason: mode === "fallback" && plan.mode === "fallback" ? plan.reason : undefined,
            });
            applyingFromWebview = false;
            break;
          }
          case "save":
            applyingFromWebview = true;
            await replaceDocumentText(document, message.html);
            applyingFromWebview = false;
            await document.save();
            await toast(webview, `Saved ${path.basename(document.fileName)}`);
            break;
          case "copy":
            await vscode.env.clipboard.writeText(message.html);
            await toast(webview, "HTML copied to clipboard");
            break;
          case "copyText":
            await vscode.env.clipboard.writeText(message.text);
            await toast(webview, "Diagnostics copied to clipboard");
            break;
          case "download":
            await downloadCopy(message.html, document);
            await toast(webview, "HTML copy saved");
            break;
          case "downloadBinary":
            await downloadBinaryCopy(message, document);
            await toast(webview, `${message.fileName} saved`);
            break;
          case "openFile":
            await openHtmlFile();
            break;
        }
      } catch (error) {
        applyingFromWebview = false;
        const messageText = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Cosmic Canvas: ${messageText}`);
        await toast(webview, messageText);
      }
    });
  }

  private webviewHtml(webview: vscode.Webview): string {
    const assetsPath = path.join(this.context.extensionPath, "dist", "assets");
    const assets = fs.readdirSync(assetsPath);
    const scriptFile = assets.find((file) => /^index-.*\.js$/.test(file));
    const styleFile = assets.find((file) => /^index-.*\.css$/.test(file));

    if (!scriptFile || !styleFile) {
      throw new Error("Run npm run build before opening Cosmic Canvas in VS Code.");
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets", scriptFile),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets", styleFile),
    );
    // Load the hashed Vite assets explicitly. The build can emit small helper
    // chunks before the main bundle, so never pick an arbitrary first .js file.
    const trustedAssetSources = [
      "https://cdn.jsdelivr.net",
      "https://unpkg.com",
      "https://cdnjs.cloudflare.com",
    ].join(" ");
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob: https:`,
      `font-src ${webview.cspSource} data: ${trustedAssetSources} https://fonts.gstatic.com`,
      `style-src ${webview.cspSource} 'unsafe-inline' data: ${trustedAssetSources} https://fonts.googleapis.com`,
      `script-src ${webview.cspSource} 'unsafe-inline' ${trustedAssetSources}`,
      `connect-src ${webview.cspSource} data: blob: https:`,
      "media-src data: blob: https:",
      "frame-src data: https:",
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Cosmic Canvas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

async function replaceDocumentText(document: vscode.TextDocument, nextText: string): Promise<boolean> {
  if (document.getText() === nextText) return true;

  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, fullRange, nextText);
  return vscode.workspace.applyEdit(edit);
}

async function applyPlannedDocumentEdit(
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "documentEdit" }>,
): Promise<"targeted" | "fallback"> {
  const plan = planHostEdit(document.getText(), message);
  if (plan.mode === "fallback") {
    await replaceDocumentText(document, plan.html);
    return "fallback";
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(plan.from), document.positionAt(plan.to)),
    plan.text,
  );
  await vscode.workspace.applyEdit(edit);
  return "targeted";
}

async function toast(webview: vscode.Webview, message: string) {
  await webview.postMessage({ type: "cosmicCanvas.toast", message });
}

async function downloadCopy(html: string, document: vscode.TextDocument) {
  const defaultName = `${path.basename(document.fileName, path.extname(document.fileName))}-copy.html`;
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(path.dirname(document.fileName)), defaultName),
    filters: { HTML: ["html", "htm"] },
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(html));
}

async function downloadBinaryCopy(
  message: Extract<WebviewMessage, { type: "downloadBinary" }>,
  document: vscode.TextDocument,
) {
  const safeName = path.basename(message.fileName || `${path.basename(document.fileName, path.extname(document.fileName))}.pptx`);
  const extension = path.extname(safeName).replace(".", "").toLowerCase();
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(path.dirname(document.fileName)), safeName),
    filters: extension === "pptx" ? { PowerPoint: ["pptx"] } : undefined,
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(message.base64, "base64"));
}

async function openHtmlFile() {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { HTML: ["html", "htm"] },
  });
  const target = picked?.[0];
  if (target) {
    await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
  }
}
