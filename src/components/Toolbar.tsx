import {
  Eye,
  Film,
  Monitor,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  Smartphone,
  Tablet,
  Table2,
  Type,
  Undo2,
} from "lucide-react";
import { type EditorMode, type Viewport } from "../protocol";

const modeButtons: Array<{ mode: EditorMode; label: string; icon: typeof Type }> = [
  { mode: "text", label: "Text", icon: Type },
  { mode: "select", label: "Select", icon: MousePointer2 },
  { mode: "move", label: "Move", icon: Move },
  { mode: "preview", label: "Preview", icon: Eye },
];

const viewportLabels: Record<Viewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

const viewportButtons: Array<{ viewport: Viewport; icon: typeof Monitor }> = [
  { viewport: "desktop", icon: Monitor },
  { viewport: "tablet", icon: Tablet },
  { viewport: "mobile", icon: Smartphone },
];

type ToolbarProps = {
  mode: EditorMode;
  onMode: (mode: EditorMode) => void;
  sourceVisible: boolean;
  onToggleSource: () => void;
  dataActive: boolean;
  onToggleData: () => void;
  runTrustedScripts: boolean;
  onToggleTrusted: (enabled: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
};

export function Toolbar({
  mode,
  onMode,
  sourceVisible,
  onToggleSource,
  dataActive,
  onToggleData,
  runTrustedScripts,
  onToggleTrusted,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  viewport,
  onViewport,
}: ToolbarProps) {
  return (
    <section className="toolbar" aria-label="Editor toolbar">
      <div className="segmented" aria-label="Edit mode">
        {modeButtons.map(({ mode: buttonMode, label, icon: Icon }) => (
          <button
            aria-pressed={mode === buttonMode}
            className={mode === buttonMode ? "is-active" : ""}
            key={buttonMode}
            onClick={() => onMode(buttonMode)}
            title={`${label} mode`}
            type="button"
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar-spacer" />

      <button
        aria-pressed={sourceVisible}
        className="toolbar-button"
        onClick={onToggleSource}
        title={sourceVisible ? "Hide HTML source" : "Show HTML source"}
        type="button"
      >
        {sourceVisible ? (
          <PanelLeftClose size={16} aria-hidden="true" />
        ) : (
          <PanelLeftOpen size={16} aria-hidden="true" />
        )}
        Source
      </button>

      <button
        aria-pressed={dataActive}
        className="toolbar-button"
        onClick={onToggleData}
        title="Open data editor"
        type="button"
      >
        <Table2 size={16} aria-hidden="true" />
        Data
      </button>

      <label
        className="script-toggle"
        title="Run pasted scripts and inline handlers in the preview. Use only for HTML you trust."
      >
        <input
          checked={runTrustedScripts}
          onChange={(event) => onToggleTrusted(event.target.checked)}
          type="checkbox"
        />
        <Film size={16} aria-hidden="true" />
        Trusted scripts
      </label>

      <div className="icon-group" aria-label="History">
        <button disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)" type="button">
          <Undo2 size={17} aria-hidden="true" />
        </button>
        <button disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Y)" type="button">
          <Redo2 size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="icon-group" aria-label="Viewport">
        {viewportButtons.map(({ viewport: buttonViewport, icon: Icon }) => (
          <button
            aria-label={viewportLabels[buttonViewport]}
            aria-pressed={viewport === buttonViewport}
            className={viewport === buttonViewport ? "is-active" : ""}
            key={buttonViewport}
            onClick={() => onViewport(buttonViewport)}
            title={viewportLabels[buttonViewport]}
            type="button"
          >
            <Icon size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
