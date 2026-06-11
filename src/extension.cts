import * as fs from "node:fs";
import * as path from "node:path";
import { TextEncoder } from "node:util";
import * as vscode from "vscode";

const VIEW_TYPE = "cosmicCanvas.htmlEditor";

type WebviewMessage =
  | { type: "ready" }
  | { type: "documentChanged"; html: string; reason?: string }
  | { type: "save"; html: string }
  | { type: "copy"; html: string }
  | { type: "download"; html: string }
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
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "public"),
      ],
    };
    webview.html = this.webviewHtml(webview);

    let applyingFromWebview = false;

    const postDocument = () => {
      void webview.postMessage({
        type: "cosmicCanvas.document",
        html: document.getText(),
        fileName: path.basename(document.fileName),
        uri: document.uri.toString(),
      });
    };

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (applyingFromWebview) return;
      postDocument();
    });

    webviewPanel.onDidDispose(() => documentChangeSubscription.dispose());

    webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        switch (message.type) {
          case "ready":
            postDocument();
            break;
          case "documentChanged":
            applyingFromWebview = true;
            await replaceDocumentText(document, message.html);
            applyingFromWebview = false;
            break;
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
          case "download":
            await downloadCopy(message.html, document);
            await toast(webview, "HTML copy saved");
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
    const scriptFile = assets.find((file) => file.endsWith(".js"));
    const styleFile = assets.find((file) => file.endsWith(".css"));

    if (!scriptFile || !styleFile) {
      throw new Error("Run npm run build before opening Cosmic Canvas in VS Code.");
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets", scriptFile),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets", styleFile),
    );
    const baseUri = `${webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist"))}/`;
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
      "frame-src data: blob:",
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="${baseUri}" />
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
