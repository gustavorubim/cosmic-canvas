import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { type AuditFinding } from "../protocol";

type ValidationPanelProps = {
  findings: AuditFinding[];
  onSelect: (elementId: string) => void;
};

export function ValidationPanel({ findings, onSelect }: ValidationPanelProps) {
  if (findings.length === 0) {
    return (
      <div className="empty-state">
        <CheckCircle2 size={28} aria-hidden="true" />
        <span>No issues found</span>
        <small>The current document passed the available visual and export checks.</small>
      </div>
    );
  }

  return (
    <div className="validation-panel">
      {findings.map((finding) => (
        <button
          className="validation-finding"
          key={finding.id}
          onClick={() => onSelect(finding.elementId)}
          title="Select element"
          type="button"
        >
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <strong>{finding.message}</strong>
            <em>{finding.label}</em>
          </span>
        </button>
      ))}
    </div>
  );
}
