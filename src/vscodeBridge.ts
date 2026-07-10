type VsCodeApi = {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export type VsCodeHostMessage =
  | {
      type: "cosmicCanvas.document";
      html: string;
      fileName: string;
      uri: string;
      extensionVersion: string;
      vscodeVersion: string;
      baseUri: string;
      resources: Record<string, string>;
    }
  | {
      type: "cosmicCanvas.toast";
      message: string;
    }
  | {
      type: "cosmicCanvas.hostEdit";
      mode: "targeted" | "fallback";
      reason?: string;
    };

let api: VsCodeApi | null | undefined;

export function getVsCodeApi(): VsCodeApi | null {
  if (api !== undefined) return api;
  if (typeof window === "undefined" || typeof window.acquireVsCodeApi !== "function") {
    api = null;
    return api;
  }
  api = window.acquireVsCodeApi();
  return api;
}

export function isVsCodeHostMessage(data: unknown): data is VsCodeHostMessage {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const messageData = data as Record<string, unknown>;
  const type = messageData.type;
  const text = (input: unknown, limit: number) => typeof input === "string" && input.length <= limit;
  const exact = (...keys: string[]) => Object.keys(messageData).every((key) => ["type", ...keys].includes(key));
  if (type === "cosmicCanvas.toast") {
    return exact("message") && text(messageData.message, 20_000);
  }
  if (type === "cosmicCanvas.hostEdit") {
    const message = data as { mode?: unknown; reason?: unknown };
    return exact("mode", "reason") && (message.mode === "targeted" || message.mode === "fallback") &&
      (message.reason === undefined || text(message.reason, 500));
  }
  if (type !== "cosmicCanvas.document") return false;
  const documentMessage = data as {
    html?: unknown;
    fileName?: unknown;
    uri?: unknown;
    extensionVersion?: unknown;
    vscodeVersion?: unknown;
    baseUri?: unknown;
    resources?: unknown;
  };
  return (
    exact("html", "fileName", "uri", "extensionVersion", "vscodeVersion", "baseUri", "resources") &&
    text(documentMessage.html, 20_000_000) &&
    text(documentMessage.fileName, 500) &&
    text(documentMessage.uri, 20_000) &&
    text(documentMessage.extensionVersion, 200) &&
    text(documentMessage.vscodeVersion, 200) &&
    text(documentMessage.baseUri, 20_000) &&
    Boolean(documentMessage.resources) &&
    typeof documentMessage.resources === "object" &&
    !Array.isArray(documentMessage.resources) &&
    Object.keys(documentMessage.resources as Record<string, unknown>).length <= 500 &&
    Object.entries(documentMessage.resources as Record<string, unknown>).every(([key, value]) =>
      key.length <= 20_000 && text(value, 7_000_000),
    ) &&
    Object.values(documentMessage.resources as Record<string, string>).reduce((total, value) => total + value.length, 0) <= 16_000_000
  );
}
