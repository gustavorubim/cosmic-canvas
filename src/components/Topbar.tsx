import { ChevronDown, Copy, Download, FileCode2, FileStack, ListRestart, Save } from "lucide-react";
import { type ChangeEvent, type RefObject, useEffect, useRef, useState } from "react";

type TopbarProps = {
  version: string;
  fileInputRef: RefObject<HTMLInputElement>;
  onOpen: () => void;
  onOpenFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  saveTitle: string;
  onCopy: () => void;
  onDownload: () => void;
  onDownloadSelfContained: () => void;
  onDownloadPrint: () => void;
  onDownloadPowerPointHybrid: () => void;
  onDownloadPowerPointEditable: () => void;
  onDownloadPowerPointImage: () => void;
  onNormalize: () => void;
};

export function Topbar({
  version,
  fileInputRef,
  onOpen,
  onOpenFile,
  onSave,
  saveTitle,
  onCopy,
  onDownload,
  onDownloadSelfContained,
  onDownloadPrint,
  onDownloadPowerPointHybrid,
  onDownloadPowerPointEditable,
  onDownloadPowerPointImage,
  onNormalize,
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <img alt="" src="app-icon-space-192.png" />
        </div>
        <div className="brand-title">
          <h1>Cosmic Canvas</h1>
          <span className="version-badge">v{version}</span>
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
        <div className="export-group" ref={menuRef}>
          <button className="button primary" type="button" onClick={onSave} title={saveTitle}>
            <Save size={17} aria-hidden="true" />
            Save
          </button>
          <button
            aria-expanded={menuOpen}
            aria-label="More export options"
            className="button primary menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="export-menu" role="menu">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCopy();
                }}
              >
                <Copy size={15} aria-hidden="true" />
                Copy HTML
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDownload();
                }}
              >
                <Download size={15} aria-hidden="true" />
                Download copy
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDownloadSelfContained();
                }}
              >
                <Download size={15} aria-hidden="true" />
                Self-contained
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDownloadPrint();
                }}
              >
                <Download size={15} aria-hidden="true" />
                Print HTML
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDownloadPowerPointHybrid();
                }}
              >
                <FileStack size={15} aria-hidden="true" />
                PowerPoint: Hybrid
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDownloadPowerPointEditable();
                }}
              >
                <FileStack size={15} aria-hidden="true" />
                PowerPoint: Editable
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDownloadPowerPointImage();
                }}
              >
                <FileStack size={15} aria-hidden="true" />
                PowerPoint: Exact image
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNormalize();
                }}
              >
                <ListRestart size={15} aria-hidden="true" />
                Normalize deck
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
