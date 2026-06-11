import { Copy, Download, FileCode2, RefreshCcw, Save } from "lucide-react";
import { type ChangeEvent, type RefObject } from "react";

type TopbarProps = {
  fileInputRef: RefObject<HTMLInputElement>;
  onOpen: () => void;
  onOpenFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onApplySource: () => void;
  onSave: () => void;
  saveLabel: string;
  saveTitle: string;
  onCopy: () => void;
  copyLabel: string;
  onDownload: () => void;
};

export function Topbar({
  fileInputRef,
  onOpen,
  onOpenFile,
  onApplySource,
  onSave,
  saveLabel,
  saveTitle,
  onCopy,
  copyLabel,
  onDownload,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <img alt="" src="/app-icon-space-192.png" />
        </div>
        <div>
          <h1>Cosmic Canvas</h1>
          <p>Launch HTML from rough draft to polished page.</p>
        </div>
      </div>
      <div className="topbar-actions">
        <input
          ref={fileInputRef}
          accept=".html,.htm,text/html"
          className="file-input"
          onChange={onOpenFile}
          type="file"
        />
        <button className="button secondary" type="button" onClick={onOpen}>
          <FileCode2 size={17} aria-hidden="true" />
          Open file
        </button>
        <button className="button secondary" type="button" onClick={onApplySource}>
          <RefreshCcw size={17} aria-hidden="true" />
          Apply source
        </button>
        <button className="button secondary" type="button" onClick={onSave} title={saveTitle}>
          <Save size={17} aria-hidden="true" />
          {saveLabel}
        </button>
        <button className="button" type="button" onClick={onCopy}>
          <Copy size={17} aria-hidden="true" />
          {copyLabel}
        </button>
        <button className="button primary" type="button" onClick={onDownload}>
          <Download size={17} aria-hidden="true" />
          Download
        </button>
      </div>
    </header>
  );
}
