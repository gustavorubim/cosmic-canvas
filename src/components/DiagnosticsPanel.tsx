import { AlertTriangle, CheckCircle2, Clipboard, LoaderCircle, XCircle } from "lucide-react";
import {
  type RuntimeDiagnostics,
  formatDiagnosticsText,
  previewStateLabel,
} from "../diagnostics";

type DiagnosticsPanelProps = {
  runtime: RuntimeDiagnostics;
  onCopy: (text: string) => void;
};

const stateIcons = {
  loading: LoaderCircle,
  ready: CheckCircle2,
  degraded: AlertTriangle,
  failed: XCircle,
};

export function DiagnosticsPanel({ runtime, onCopy }: DiagnosticsPanelProps) {
  const StateIcon = stateIcons[runtime.preview.state];
  const rows = [
    ["App", runtime.appVersion],
    ["Host", runtime.hostMode],
    ["Extension", runtime.extensionVersion || "n/a"],
    ["VS Code", runtime.vscodeVersion || "n/a"],
    ["Document", runtime.fileName || "Untitled"],
    ["Resource base", runtime.baseUri || "n/a"],
    ["Trusted scripts", runtime.trustedScripts ? "On" : "Off"],
    ["Forced page detection", runtime.forceTimeline ? "On" : "Off"],
  ];

  return (
    <div className="diagnostics-panel">
      <div className={`diagnostic-state is-${runtime.preview.state}`}>
        <StateIcon size={20} aria-hidden="true" />
        <div>
          <strong>{previewStateLabel(runtime.preview.state)}</strong>
          <span>Preview revision {runtime.preview.revision}</span>
        </div>
      </div>

      <dl className="diagnostic-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      {runtime.uri ? (
        <div className="diagnostic-uri">
          <strong>URI</strong>
          <code>{runtime.uri}</code>
        </div>
      ) : null}

      <div className="diagnostic-list" aria-label="Preview diagnostics">
        {runtime.preview.diagnostics.map((entry) => (
          <article className={`diagnostic-entry is-${entry.severity}`} key={entry.id}>
            <strong>{entry.title}</strong>
            <span>{entry.message}</span>
            <code>{entry.code}</code>
          </article>
        ))}
      </div>

      <button
        className="button secondary diagnostic-copy"
        onClick={() => onCopy(formatDiagnosticsText(runtime))}
        type="button"
      >
        <Clipboard size={16} aria-hidden="true" />
        Copy diagnostics
      </button>
    </div>
  );
}
