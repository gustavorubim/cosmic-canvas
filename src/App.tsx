import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FileCode2,
  Film,
  Layers3,
  Monitor,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  RefreshCcw,
  Smartphone,
  Tablet,
  Table2,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { cleanEditorHtml, normalizeHtmlInput, prepareEditableHtml, SAMPLE_HTML } from "./htmlDocument";

type EditorMode = "text" | "select" | "move" | "preview";
type Viewport = "desktop" | "tablet" | "mobile";

type SelectedElement = {
  id: string;
  tagName: string;
  text: string;
  childElementCount: number;
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    textAlign: string;
    padding: string;
    margin: string;
    width: string;
    height: string;
    borderRadius: string;
  };
};

type HistoryState = {
  stack: string[];
  index: number;
};

type PreviewStatus = {
  state: "loading" | "ready";
  title: string;
  bodyTextStart: string;
};

type DeckSlide = {
  id: string;
  index: number;
  title: string;
  section: string;
};

type SidePanel = "inspect" | "data";

const DEFAULT_DATA_ROWS = [
  ["Metric", "Value", "Change"],
  ["Revenue", "$4.2M", "+18%"],
  ["Retention", "91%", "+6 pts"],
  ["Pipeline", "$12.4M", "+22%"],
];

const viewportLabels: Record<Viewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

const modeButtons: Array<{ mode: EditorMode; label: string; icon: typeof Type }> = [
  { mode: "text", label: "Text", icon: Type },
  { mode: "select", label: "Select", icon: MousePointer2 },
  { mode: "move", label: "Move", icon: Move },
  { mode: "preview", label: "Preview", icon: Eye },
];

const viewportButtons: Array<{ viewport: Viewport; icon: typeof Monitor }> = [
  { viewport: "desktop", icon: Monitor },
  { viewport: "tablet", icon: Tablet },
  { viewport: "mobile", icon: Smartphone },
];

const alignButtons = [
  { label: "Left", value: "left", icon: AlignLeft },
  { label: "Center", value: "center", icon: AlignCenter },
  { label: "Right", value: "right", icon: AlignRight },
];

function fileNameFromDate() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cosmic-canvas-${stamp}.html`;
}

function numberFromCss(value: string, fallback = "") {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? match[0] : fallback;
}

function fallbackColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeDataRows(rows: string[][]) {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  const sourceRows = nonEmptyRows.length ? nonEmptyRows : DEFAULT_DATA_ROWS;
  const width = Math.max(2, ...sourceRows.map((row) => row.length));
  return sourceRows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ""),
  );
}

function parseDataText(text: string) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && next === "\n") index += 1;
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  rows.push(row);
  return normalizeDataRows(rows);
}

function serializeDataRows(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (!/[",\n\r]/.test(cell)) return cell;
          return `"${cell.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
}

export default function App() {
  const initialHtml = useMemo(() => cleanEditorHtml(SAMPLE_HTML), []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didLoadUrlRef = useRef(false);
  const historyRef = useRef<HistoryState>({ stack: [initialHtml], index: 0 });
  const pendingHistoryTimer = useRef<number>();
  const [sourceHtml, setSourceHtml] = useState(initialHtml);
  const [frameHtml, setFrameHtml] = useState(() => prepareEditableHtml(initialHtml));
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [mode, setMode] = useState<EditorMode>("text");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [runTrustedScripts, setRunTrustedScripts] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(true);
  const [deckSlides, setDeckSlides] = useState<DeckSlide[]>([]);
  const [activeSlideId, setActiveSlideId] = useState("");
  const [sidePanel, setSidePanel] = useState<SidePanel>("inspect");
  const [dataTitle, setDataTitle] = useState("Launch metrics");
  const [dataRows, setDataRows] = useState(() => DEFAULT_DATA_ROWS.map((row) => [...row]));
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>({
    state: "loading",
    title: "",
    bodyTextStart: "",
  });
  const [historyState, setHistoryState] = useState<HistoryState>(historyRef.current);
  const [clipboardState, setClipboardState] = useState("Copy");

  const canUndo = historyState.index > 0;
  const canRedo = historyState.index < historyState.stack.length - 1;
  const activeSlideIndex = Math.max(
    0,
    deckSlides.findIndex((slide) => slide.id === activeSlideId),
  );
  const dataText = useMemo(() => serializeDataRows(dataRows), [dataRows]);
  const dataColumnCount = Math.max(1, dataRows[0]?.length ?? 1);

  function syncHistoryState(next: HistoryState) {
    historyRef.current = next;
    setHistoryState(next);
  }

  function pushHistory(html: string) {
    const current = historyRef.current;
    if (current.stack[current.index] === html) return;
    const nextStack = current.stack.slice(0, current.index + 1).concat(html).slice(-80);
    const next: HistoryState = {
      stack: nextStack,
      index: nextStack.length - 1,
    };
    syncHistoryState(next);
  }

  function scheduleHistory(html: string) {
    if (pendingHistoryTimer.current) window.clearTimeout(pendingHistoryTimer.current);
    pendingHistoryTimer.current = window.setTimeout(() => pushHistory(html), 450);
  }

  function renderHtml(html: string, trustedScripts = runTrustedScripts) {
    setPreviewStatus({ state: "loading", title: "", bodyTextStart: "" });
    setDeckSlides([]);
    setActiveSlideId("");
    setFrameHtml(prepareEditableHtml(html, trustedScripts));
    setSelected(null);
  }

  function loadHtml(html: string, addToHistory = true, trustedScripts = runTrustedScripts) {
    const normalized = normalizeHtmlInput(html);
    const clean = normalized.includes("data-wysiwyg-") ? cleanEditorHtml(normalized) : normalized;
    setSourceHtml(clean);
    renderHtml(clean, trustedScripts);
    if (addToHistory) pushHistory(clean);
  }

  function postCommand(command: string, payload: Record<string, unknown> = {}) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "wysiwyg-command",
        command,
        ...payload,
      },
      "*",
    );
  }

  function setEditorMode(nextMode: EditorMode) {
    setMode(nextMode);
    postCommand("set-mode", { mode: nextMode });
  }

  function goToDeckSlide(slide: DeckSlide) {
    setActiveSlideId(slide.id);
    postCommand("go-slide", { id: slide.id });
  }

  function stepDeckSlide(offset: number) {
    if (!deckSlides.length) return;
    const nextIndex = Math.min(deckSlides.length - 1, Math.max(0, activeSlideIndex + offset));
    goToDeckSlide(deckSlides[nextIndex]);
  }

  function duplicateCurrentSlide() {
    const slide = deckSlides[activeSlideIndex];
    if (!slide) return;
    postCommand("duplicate-slide", { id: slide.id });
  }

  function insertSlideAfterCurrent() {
    const slide = deckSlides[activeSlideIndex];
    if (!slide) return;
    postCommand("insert-slide", { id: slide.id });
  }

  function updateDataCell(rowIndex: number, cellIndex: number, value: string) {
    setDataRows((current) => {
      const next = normalizeDataRows(current).map((row) => [...row]);
      next[rowIndex][cellIndex] = value;
      return next;
    });
  }

  function addDataRow() {
    setDataRows((current) => {
      const normalized = normalizeDataRows(current);
      const width = normalized[0]?.length ?? 2;
      return normalized.concat([Array.from({ length: width }, () => "")]);
    });
  }

  function addDataColumn() {
    setDataRows((current) =>
      normalizeDataRows(current).map((row, rowIndex) => [
        ...row,
        rowIndex === 0 ? `Column ${row.length + 1}` : "",
      ]),
    );
  }

  function insertDataTable() {
    const normalized = normalizeDataRows(dataRows);
    const columns = normalized[0].map((cell, index) => cell.trim() || `Column ${index + 1}`);
    const rows = normalized.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));
    if (!rows.length) return;
    postCommand("insert-table", { columns, rows, title: dataTitle.trim() });
  }

  function updateSelectedStyle(styles: Record<string, string>) {
    postCommand("apply-style", { styles });
  }

  function updateSelectedText(text: string) {
    setSelected((current) => (current ? { ...current, text } : current));
    postCommand("set-text", { text });
  }

  function stepHistory(offset: number) {
    const current = historyRef.current;
    const nextIndex = current.index + offset;
    if (nextIndex < 0 || nextIndex >= current.stack.length) return;
    const html = current.stack[nextIndex];
    syncHistoryState({ stack: current.stack, index: nextIndex });
    setSourceHtml(html);
    renderHtml(html);
  }

  function toggleTrustedScripts(enabled: boolean) {
    setRunTrustedScripts(enabled);
    renderHtml(sourceHtml, enabled);
  }

  async function openHtmlFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const text = await file.text();
    loadHtml(text);
    event.currentTarget.value = "";
  }

  async function copyHtml() {
    const clean = cleanEditorHtml(sourceHtml);
    await navigator.clipboard.writeText(clean);
    setClipboardState("Copied");
    window.setTimeout(() => setClipboardState("Copy"), 1300);
  }

  function downloadHtml() {
    const clean = cleanEditorHtml(sourceHtml);
    const blob = new Blob([clean], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileNameFromDate();
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data || {};
      if (data.type === "wysiwyg-ready") {
        setPreviewStatus({
          state: "ready",
          title: typeof data.title === "string" ? data.title : "",
          bodyTextStart: typeof data.bodyTextStart === "string" ? data.bodyTextStart : "",
        });
        postCommand("set-mode", { mode });
      }

      if (data.type === "wysiwyg-selection") {
        setSelected(data.selected);
      }

      if (data.type === "wysiwyg-deck") {
        setDeckSlides(Array.isArray(data.slides) ? data.slides : []);
        setActiveSlideId(typeof data.activeId === "string" ? data.activeId : "");
      }

      if (data.type === "wysiwyg-document-change" && typeof data.html === "string") {
        const clean = cleanEditorHtml(data.html);
        setSourceHtml(clean);
        scheduleHistory(clean);
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (pendingHistoryTimer.current) window.clearTimeout(pendingHistoryTimer.current);
    };
  }, [mode]);

  useEffect(() => {
    if (didLoadUrlRef.current) return;
    didLoadUrlRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const loadUrl = params.get("load");
    if (!loadUrl) return;

    const trusted = params.get("trusted") === "1";
    setRunTrustedScripts(trusted);

    fetch(loadUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${loadUrl}: ${response.status}`);
        return response.text();
      })
      .then((html) => loadHtml(html, true, trusted))
      .catch((error: unknown) => {
        console.error(error);
      });
  }, []);

  return (
    <main className="app-shell">
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
            onChange={openHtmlFile}
            type="file"
          />
          <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
            <FileCode2 size={17} aria-hidden="true" />
            Open file
          </button>
          <button className="button secondary" type="button" onClick={() => loadHtml(sourceHtml)}>
            <RefreshCcw size={17} aria-hidden="true" />
            Apply source
          </button>
          <button className="button" type="button" onClick={copyHtml}>
            <Copy size={17} aria-hidden="true" />
            {clipboardState}
          </button>
          <button className="button primary" type="button" onClick={downloadHtml}>
            <Download size={17} aria-hidden="true" />
            Download
          </button>
        </div>
      </header>

      <section className="toolbar" aria-label="Editor toolbar">
        <div className="segmented" aria-label="Edit mode">
          {modeButtons.map(({ mode: buttonMode, label, icon: Icon }) => (
            <button
              aria-pressed={mode === buttonMode}
              className={mode === buttonMode ? "is-active" : ""}
              key={buttonMode}
              onClick={() => setEditorMode(buttonMode)}
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
          onClick={() => setSourceVisible((current) => !current)}
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
          aria-pressed={sidePanel === "data"}
          className="toolbar-button"
          onClick={() => setSidePanel((current) => (current === "data" ? "inspect" : "data"))}
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
            onChange={(event) => toggleTrustedScripts(event.target.checked)}
            type="checkbox"
          />
          <Film size={16} aria-hidden="true" />
          Trusted scripts
        </label>

        <div className="icon-group" aria-label="History">
          <button disabled={!canUndo} onClick={() => stepHistory(-1)} title="Undo" type="button">
            <Undo2 size={17} aria-hidden="true" />
          </button>
          <button disabled={!canRedo} onClick={() => stepHistory(1)} title="Redo" type="button">
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
              onClick={() => setViewport(buttonViewport)}
              title={viewportLabels[buttonViewport]}
              type="button"
            >
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className={`workspace ${sourceVisible ? "" : "source-hidden"}`}>
        {sourceVisible ? (
          <aside className="source-pane" aria-label="HTML source">
            <div className="pane-title">
              <span>HTML source</span>
              <span>{sourceHtml.length.toLocaleString()} chars</span>
            </div>
            <textarea
              aria-label="HTML source editor"
              spellCheck={false}
              value={sourceHtml}
              onChange={(event) => setSourceHtml(event.target.value)}
            />
          </aside>
        ) : (
          <aside className="source-rail" aria-label="Collapsed HTML source">
            <button
              aria-label="Show HTML source"
              onClick={() => setSourceVisible(true)}
              title="Show HTML source"
              type="button"
            >
              <PanelLeftOpen size={18} aria-hidden="true" />
              <span>HTML</span>
            </button>
            <span>{sourceHtml.length.toLocaleString()}</span>
          </aside>
        )}

        <section className={`preview-pane ${deckSlides.length ? "has-timeline" : ""}`} aria-label="Rendered HTML">
          <div className="pane-title">
            <span>Canvas</span>
            <span title={previewStatus.bodyTextStart || undefined}>
              {previewStatus.state === "ready"
                ? `${viewportLabels[viewport]} - ${previewStatus.title || "Ready"}`
                : `${viewportLabels[viewport]} - Loading`}
            </span>
          </div>
          <div className={`preview-frame preview-frame-${viewport}`}>
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts allow-same-origin allow-downloads"
              srcDoc={frameHtml}
              title="Editable HTML preview"
            />
          </div>
          {deckSlides.length ? (
            <div className="deck-timeline" aria-label="Slide timeline">
              <div className="timeline-header">
                <div>
                  <span>Timeline</span>
                  <strong>
                    {activeSlideIndex + 1} / {deckSlides.length}
                  </strong>
                </div>
                <div className="timeline-actions">
                  <button
                    disabled={activeSlideIndex <= 0}
                    onClick={() => stepDeckSlide(-1)}
                    title="Previous slide"
                    type="button"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    disabled={activeSlideIndex >= deckSlides.length - 1}
                    onClick={() => stepDeckSlide(1)}
                    title="Next slide"
                    type="button"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <button onClick={duplicateCurrentSlide} title="Duplicate current slide" type="button">
                    <CopyPlus size={16} aria-hidden="true" />
                  </button>
                  <button onClick={insertSlideAfterCurrent} title="Insert slide after current" type="button">
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="slide-strip">
                {deckSlides.map((slide) => (
                  <button
                    className={slide.id === activeSlideId ? "is-active" : ""}
                    key={slide.id}
                    onClick={() => goToDeckSlide(slide)}
                    title={slide.title}
                    type="button"
                  >
                    <span>{slide.index + 1}</span>
                    <strong>{slide.title}</strong>
                    {slide.section ? <em>{slide.section}</em> : null}
                  </button>
                ))}
                <button className="slide-add" onClick={insertSlideAfterCurrent} title="Insert slide after current" type="button">
                  <Layers3 size={18} aria-hidden="true" />
                  <strong>New slide</strong>
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="inspector" aria-label="Inspector and data editor">
          <div className="pane-title panel-title">
            <div className="panel-tabs" aria-label="Side panel">
              <button
                aria-pressed={sidePanel === "inspect"}
                onClick={() => setSidePanel("inspect")}
                type="button"
              >
                Inspector
              </button>
              <button aria-pressed={sidePanel === "data"} onClick={() => setSidePanel("data")} type="button">
                Data
              </button>
            </div>
            <span>
              {sidePanel === "inspect"
                ? selected
                  ? selected.tagName
                  : "None"
                : `${Math.max(0, dataRows.length - 1)} rows`}
            </span>
          </div>

          {sidePanel === "data" ? (
            <div className="data-panel">
              <label>
                Title
                <input value={dataTitle} onChange={(event) => setDataTitle(event.target.value)} />
              </label>

              <label>
                CSV
                <textarea
                  className="data-textarea"
                  spellCheck={false}
                  value={dataText}
                  onChange={(event) => setDataRows(parseDataText(event.target.value))}
                />
              </label>

              <div className="data-actions">
                <button type="button" onClick={addDataRow} title="Add row">
                  <Plus size={16} aria-hidden="true" />
                  Row
                </button>
                <button type="button" onClick={addDataColumn} title="Add column">
                  <Plus size={16} aria-hidden="true" />
                  Column
                </button>
                <button className="primary" type="button" onClick={insertDataTable} title="Insert data table">
                  <Table2 size={16} aria-hidden="true" />
                  Insert
                </button>
              </div>

              <div className="data-grid" aria-label="Data table editor">
                {dataRows.map((row, rowIndex) => (
                  <div
                    className={`data-grid-row ${rowIndex === 0 ? "is-header" : ""}`}
                    key={`row-${rowIndex}`}
                    style={{ gridTemplateColumns: `repeat(${dataColumnCount}, minmax(88px, 1fr))` }}
                  >
                    {row.map((cell, cellIndex) => (
                      <input
                        aria-label={`Row ${rowIndex + 1} column ${cellIndex + 1}`}
                        key={`cell-${rowIndex}-${cellIndex}`}
                        onChange={(event) => updateDataCell(rowIndex, cellIndex, event.target.value)}
                        value={cell}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : selected ? (
            <div className="inspector-body">
              <label>
                Text
                <textarea
                  className="text-control"
                  value={selected.text}
                  onChange={(event) => updateSelectedText(event.target.value)}
                />
              </label>

              <div className="field-grid">
                <label>
                  Text color
                  <input
                    type="color"
                    value={fallbackColor(selected.styles.color, "#1f2933")}
                    onChange={(event) => updateSelectedStyle({ color: event.target.value })}
                  />
                </label>
                <label>
                  Fill
                  <input
                    type="color"
                    value={fallbackColor(selected.styles.backgroundColor, "#ffffff")}
                    onChange={(event) => updateSelectedStyle({ backgroundColor: event.target.value })}
                  />
                </label>
                <label>
                  Font size
                  <input
                    min="8"
                    max="180"
                    type="number"
                    value={numberFromCss(selected.styles.fontSize, "16")}
                    onChange={(event) => updateSelectedStyle({ fontSize: `${event.target.value}px` })}
                  />
                </label>
                <label>
                  Radius
                  <input
                    min="0"
                    max="80"
                    type="number"
                    value={numberFromCss(selected.styles.borderRadius, "0")}
                    onChange={(event) => updateSelectedStyle({ borderRadius: `${event.target.value}px` })}
                  />
                </label>
              </div>

              <div className="align-row" aria-label="Text alignment">
                {alignButtons.map(({ label, value, icon: Icon }) => (
                  <button
                    aria-label={label}
                    aria-pressed={selected.styles.textAlign === value}
                    className={selected.styles.textAlign === value ? "is-active" : ""}
                    key={value}
                    onClick={() => updateSelectedStyle({ textAlign: value })}
                    title={label}
                    type="button"
                  >
                    <Icon size={17} aria-hidden="true" />
                  </button>
                ))}
              </div>

              <div className="field-stack">
                <label>
                  Padding
                  <input
                    value={selected.styles.padding}
                    onChange={(event) => updateSelectedStyle({ padding: event.target.value })}
                  />
                </label>
                <label>
                  Margin
                  <input
                    value={selected.styles.margin}
                    onChange={(event) => updateSelectedStyle({ margin: event.target.value })}
                  />
                </label>
                <label>
                  Width
                  <input
                    value={selected.styles.width}
                    onChange={(event) => updateSelectedStyle({ width: event.target.value })}
                  />
                </label>
                <label>
                  Height
                  <input
                    value={selected.styles.height}
                    onChange={(event) => updateSelectedStyle({ height: event.target.value })}
                  />
                </label>
              </div>

              <div className="nudge-grid" aria-label="Move controls">
                <button type="button" onClick={() => postCommand("nudge", { dx: 0, dy: -8 })}>
                  Up
                </button>
                <button type="button" onClick={() => postCommand("nudge", { dx: -8, dy: 0 })}>
                  Left
                </button>
                <button type="button" onClick={() => postCommand("nudge", { dx: 8, dy: 0 })}>
                  Right
                </button>
                <button type="button" onClick={() => postCommand("nudge", { dx: 0, dy: 8 })}>
                  Down
                </button>
              </div>

              <div className="inspector-actions">
                <button type="button" onClick={() => postCommand("duplicate")}>
                  <CopyPlus size={16} aria-hidden="true" />
                  Duplicate
                </button>
                <button className="danger" type="button" onClick={() => postCommand("delete")}>
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <MousePointer2 size={28} aria-hidden="true" />
              <span>No element selected</span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
