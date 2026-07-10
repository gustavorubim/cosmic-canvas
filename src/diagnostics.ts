export type PreviewLifecycleState = "loading" | "ready" | "degraded" | "failed";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "bridge-loading"
  | "bridge-ready"
  | "bridge-timeout"
  | "bridge-runtime-error"
  | "bridge-message-rejected"
  | "bridge-source-rejected"
  | "bridge-session-rejected"
  | "document-csp-detected"
  | "host-version-mismatch"
  | "deck-selector-invalid"
  | "incremental-operation"
  | "source-range-ambiguous"
  | "unsupported-edit-target"
  | "host-targeted-edit"
  | "host-full-replace-fallback"
  | "relative-assets-resolved"
  | "relative-assets-unresolved"
  | "resource-blocked"
  | "resource-offline"
  | "resource-cors-or-network"
  | "resource-unavailable";

export type DiagnosticEntry = {
  id: string;
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  detail?: string;
};

export type PreviewStatus = {
  state: PreviewLifecycleState;
  revision: number;
  title: string;
  bodyTextStart: string;
  diagnostics: DiagnosticEntry[];
};

export type RuntimeDiagnostics = {
  appVersion: string;
  hostMode: "Browser" | "VS Code";
  extensionVersion: string;
  vscodeVersion: string;
  browserEngine: string;
  fileName: string;
  uri: string;
  baseUri: string;
  trustedScripts: boolean;
  forceTimeline: boolean;
  preview: PreviewStatus;
};

export const BRIDGE_READY_TIMEOUT_MS = 2000;

function upsertDiagnostic(entries: DiagnosticEntry[], diagnostic: DiagnosticEntry) {
  return [...entries.filter((entry) => entry.code !== diagnostic.code), diagnostic];
}

function documentCspDiagnostic(html: string): DiagnosticEntry | null {
  const hasCsp = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/i.test(html);
  if (!hasCsp) return null;
  return {
    id: "document-csp-detected",
    code: "document-csp-detected",
    severity: "warning",
    title: "Document security policy detected",
    message: "The document CSP may block the temporary editor bridge or external assets in preview.",
  };
}

export function beginPreview(revision: number, html: string, baseUri = ""): PreviewStatus {
  const diagnostics: DiagnosticEntry[] = [
    {
      id: "bridge-loading",
      code: "bridge-loading",
      severity: "info",
      title: "Editor bridge loading",
      message: "Waiting for the rendered document to connect to Cosmic Canvas.",
    },
  ];
  const csp = documentCspDiagnostic(html);
  if (csp) diagnostics.push(csp);
  const resources = resolveDocumentResources(html, baseUri);
  const blockedLocal = resources.filter((resource) => /^(?:file|javascript):/i.test(resource.url));
  if (blockedLocal.length) {
    diagnostics.push({
      id: "resource-blocked",
      code: "resource-blocked",
      severity: "warning",
      title: "Unsafe resource path blocked",
      message: `${blockedLocal.length} local-file or executable resource reference${blockedLocal.length === 1 ? " is" : "s are"} not available to preview. Move assets beside the document and use relative paths.`,
    });
  }
  const relativeCount = resources.filter((resource) =>
    resource.status === "resolved-relative" || resource.status === "unresolved-relative",
  ).length;
  if (relativeCount > 0) {
    diagnostics.push(
      baseUri
        ? {
            id: "relative-assets-resolved",
            code: "relative-assets-resolved",
            severity: "info",
            title: "Relative asset base configured",
            message: `${relativeCount} relative resource reference${relativeCount === 1 ? "" : "s"} will resolve from the document directory.`,
            detail: baseUri,
          }
        : {
            id: "relative-assets-unresolved",
            code: "relative-assets-unresolved",
            severity: "warning",
            title: "Relative assets may be unavailable",
            message: `${relativeCount} relative resource reference${relativeCount === 1 ? "" : "s"} has no accessible document base.`,
          },
    );
  }
  return {
    state: "loading",
    revision,
    title: "",
    bodyTextStart: "",
    diagnostics,
  };
}

export function markPreviewReady(
  current: PreviewStatus,
  details: { title: string; bodyTextStart: string },
): PreviewStatus {
  const diagnostics = current.diagnostics.filter(
    (entry) => entry.code !== "bridge-loading" && entry.code !== "bridge-timeout",
  );
  diagnostics.push({
    id: "bridge-ready",
    code: "bridge-ready",
    severity: "info",
    title: "Editor bridge ready",
    message: "Selection, editing, and document navigation are connected.",
  });
  return {
    ...current,
    state: diagnostics.some((entry) => entry.severity === "warning") ? "degraded" : "ready",
    title: details.title,
    bodyTextStart: details.bodyTextStart,
    diagnostics,
  };
}

export function markPreviewTimedOut(current: PreviewStatus): PreviewStatus {
  if (current.state !== "loading") return current;
  return {
    ...current,
    state: "failed",
    diagnostics: upsertDiagnostic(
      current.diagnostics.filter((entry) => entry.code !== "bridge-loading"),
      {
        id: "bridge-timeout",
        code: "bridge-timeout",
        severity: "error",
        title: "Editor bridge did not start",
        message:
          "The document rendered without connecting to the editor. Check document CSP, blocked scripts, and sandbox diagnostics.",
      },
    ),
  };
}

export function appendPreviewDiagnostic(current: PreviewStatus, diagnostic: DiagnosticEntry): PreviewStatus {
  const diagnostics = upsertDiagnostic(current.diagnostics, diagnostic);
  return {
    ...current,
    state:
      diagnostic.severity === "error"
        ? "failed"
        : current.state === "ready" && diagnostic.severity === "warning"
          ? "degraded"
          : current.state,
    diagnostics,
  };
}

export function withVersionMismatch(
  status: PreviewStatus,
  appVersion: string,
  extensionVersion: string,
): PreviewStatus {
  const diagnostics = status.diagnostics.filter((entry) => entry.code !== "host-version-mismatch");
  if (!extensionVersion || extensionVersion === appVersion) return { ...status, diagnostics };
  diagnostics.push({
    id: "host-version-mismatch",
    code: "host-version-mismatch",
    severity: "warning",
    title: "Extension version mismatch",
    message: `Web app ${appVersion} is running inside extension ${extensionVersion}. Rebuild or reinstall the current VSIX.`,
  });
  return {
    ...status,
    state: status.state === "ready" ? "degraded" : status.state,
    diagnostics,
  };
}

export function previewStateLabel(state: PreviewLifecycleState) {
  if (state === "ready") return "Ready";
  if (state === "degraded") return "Ready with warnings";
  if (state === "failed") return "Failed";
  return "Loading";
}

export function formatDiagnosticsText(runtime: RuntimeDiagnostics) {
  const lines = [
    "Cosmic Canvas diagnostics",
    `App version: ${runtime.appVersion}`,
    `Host: ${runtime.hostMode}`,
    `Extension version: ${runtime.extensionVersion || "n/a"}`,
    `VS Code version: ${runtime.vscodeVersion || "n/a"}`,
    `Browser engine: ${runtime.browserEngine || "unknown"}`,
    `Document: ${runtime.fileName || "Untitled"}`,
    `URI: ${runtime.uri || "n/a"}`,
    `Resource base: ${runtime.baseUri || "n/a"}`,
    `Trusted scripts: ${runtime.trustedScripts ? "on" : "off"}`,
    `Forced page detection: ${runtime.forceTimeline ? "on" : "off"}`,
    `Preview state: ${previewStateLabel(runtime.preview.state)}`,
    `Preview revision: ${runtime.preview.revision}`,
    "Diagnostics:",
  ];
  if (!runtime.preview.diagnostics.length) {
    lines.push("- none");
  } else {
    runtime.preview.diagnostics.forEach((entry) => {
      lines.push(`- [${entry.severity}] ${entry.code}: ${entry.message}`);
    });
  }
  return lines.join("\n");
}
import { resolveDocumentResources } from "./resourceResolver";
