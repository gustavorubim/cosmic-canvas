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
    }
  | {
      type: "cosmicCanvas.toast";
      message: string;
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
  if (!data || typeof data !== "object") return false;
  const type = (data as { type?: unknown }).type;
  if (type === "cosmicCanvas.toast") {
    return typeof (data as { message?: unknown }).message === "string";
  }
  if (type !== "cosmicCanvas.document") return false;
  const documentMessage = data as { html?: unknown; fileName?: unknown; uri?: unknown };
  return (
    typeof documentMessage.html === "string" &&
    typeof documentMessage.fileName === "string" &&
    typeof documentMessage.uri === "string"
  );
}
