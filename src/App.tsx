import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { DataPanel } from "./components/DataPanel";
import { DeckTimeline } from "./components/DeckTimeline";
import { Inspector, InspectorEmpty } from "./components/Inspector";
import { SourcePane } from "./components/SourcePane";
import { Toolbar } from "./components/Toolbar";
import { Topbar } from "./components/Topbar";
import {
  DEFAULT_DATA_ROWS,
  normalizeDataRows,
  parseDataText,
  serializeDataRows,
} from "./csv";
import { cleanEditorHtml, normalizeHtmlInput, prepareEditableHtml, SAMPLE_HTML } from "./htmlDocument";
import {
  type DeckSlide,
  type EditorMode,
  isBridgeMessage,
  type SelectedElement,
  type Viewport,
} from "./protocol";

type HistoryState = {
  stack: string[];
  index: number;
};

type PreviewStatus = {
  state: "loading" | "ready";
  title: string;
  bodyTextStart: string;
};

type SidePanel = "inspect" | "data";

const DRAFT_KEY = "cosmic-canvas-draft";

const viewportLabels: Record<Viewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

const supportsFileSystemAccess =
  typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

function fileNameFromDate() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cosmic-canvas-${stamp}.html`;
}

export default function App() {
  const initialHtml = useMemo(() => cleanEditorHtml(SAMPLE_HTML), []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didLoadUrlRef = useRef(false);
  const historyRef = useRef<HistoryState>({ stack: [initialHtml], index: 0 });
  const pendingHistoryTimer = useRef<number>();
  const fileHandleRef = useRef<any>(null);
  const sourceHtmlRef = useRef(initialHtml);
  const lastScrollRef = useRef({ x: 0, y: 0 });
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);

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
  const [saveLabel, setSaveLabel] = useState("Save");

  sourceHtmlRef.current = sourceHtml;

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
      { type: "wysiwyg-command", command, ...payload },
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
    pendingScrollRef.current = { ...lastScrollRef.current };
    setSourceHtml(html);
    renderHtml(html);
  }

  function toggleTrustedScripts(enabled: boolean) {
    setRunTrustedScripts(enabled);
    renderHtml(sourceHtml, enabled);
  }

  async function openFile() {
    const picker = (window as any).showOpenFilePicker;
    if (picker) {
      try {
        const [handle] = await picker({
          types: [{ description: "HTML", accept: { "text/html": [".html", ".htm"] } }],
        });
        fileHandleRef.current = handle;
        const file = await handle.getFile();
        loadHtml(await file.text());
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        // Fall back to the hidden file input below.
      }
    }
    fileInputRef.current?.click();
  }

  async function openHtmlFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    fileHandleRef.current = null;
    loadHtml(await file.text());
    event.currentTarget.value = "";
  }

  function flashSave() {
    setSaveLabel("Saved");
    window.setTimeout(() => setSaveLabel("Save"), 1300);
  }

  function downloadCleanHtml(clean: string) {
    const blob = new Blob([clean], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileNameFromDate();
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveToFile() {
    const clean = cleanEditorHtml(sourceHtmlRef.current);
    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      try {
        let handle = fileHandleRef.current;
        if (!handle) {
          handle = await picker({
            suggestedName: fileNameFromDate(),
            types: [{ description: "HTML", accept: { "text/html": [".html"] } }],
          });
          fileHandleRef.current = handle;
        }
        const writable = await handle.createWritable();
        await writable.write(clean);
        await writable.close();
        flashSave();
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        console.error(error);
      }
    }
    downloadCleanHtml(clean);
    flashSave();
  }

  async function copyHtml() {
    const clean = cleanEditorHtml(sourceHtmlRef.current);
    await navigator.clipboard.writeText(clean);
    setClipboardState("Copied");
    window.setTimeout(() => setClipboardState("Copy"), 1300);
  }

  function downloadHtml() {
    downloadCleanHtml(cleanEditorHtml(sourceHtmlRef.current));
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMessage(event.data)) return;
      const data = event.data;

      if (data.type === "wysiwyg-ready") {
        setPreviewStatus({ state: "ready", title: data.title, bodyTextStart: data.bodyTextStart });
        postCommand("set-mode", { mode });
        if (pendingScrollRef.current) {
          postCommand("scroll-to", pendingScrollRef.current);
          pendingScrollRef.current = null;
        }
      }

      if (data.type === "wysiwyg-selection") {
        setSelected(data.selected);
      }

      if (data.type === "wysiwyg-deck") {
        setDeckSlides(data.slides);
        setActiveSlideId(data.activeId);
      }

      if (data.type === "wysiwyg-document-change") {
        lastScrollRef.current = { x: data.scrollX, y: data.scrollY };
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

  // Keyboard shortcuts handled at the app-shell level (focus outside the iframe).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        void saveToFile();
        return;
      }

      const target = event.target;
      const inField =
        target instanceof HTMLElement && target.closest("input, textarea, .cm-editor");
      if (inField) return;

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        stepHistory(-1);
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        stepHistory(1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Autosave a recovery draft once the document differs from the starting sample.
  useEffect(() => {
    if (sourceHtml === initialHtml) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ html: sourceHtml, savedAt: Date.now() }));
      } catch {
        // Storage may be unavailable (private mode / quota); drafts are best-effort.
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [sourceHtml, initialHtml]);

  useEffect(() => {
    if (didLoadUrlRef.current) return;
    didLoadUrlRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const loadUrl = params.get("load");
    if (loadUrl) {
      const trusted = params.get("trusted") === "1";
      setRunTrustedScripts(trusted);
      fetch(loadUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Unable to load ${loadUrl}: ${response.status}`);
          return response.text();
        })
        .then((html) => loadHtml(html, true, trusted))
        .catch((error: unknown) => console.error(error));
      return;
    }

    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { html?: string; savedAt?: number };
      if (typeof draft.html !== "string" || !draft.html.trim()) return;
      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : "your last session";
      if (window.confirm(`Restore your unsaved draft from ${when}?`)) {
        loadHtml(draft.html);
      }
    } catch {
      // Ignore malformed drafts.
    }
  }, []);

  const saveTitle = supportsFileSystemAccess
    ? "Save to file (Ctrl+S)"
    : "Download a copy (Ctrl+S)";

  return (
    <main className="app-shell">
      <Topbar
        fileInputRef={fileInputRef}
        onOpen={openFile}
        onOpenFile={openHtmlFile}
        onApplySource={() => loadHtml(sourceHtml)}
        onSave={saveToFile}
        saveLabel={saveLabel}
        saveTitle={saveTitle}
        onCopy={copyHtml}
        copyLabel={clipboardState}
        onDownload={downloadHtml}
      />

      <Toolbar
        mode={mode}
        onMode={setEditorMode}
        sourceVisible={sourceVisible}
        onToggleSource={() => setSourceVisible((current) => !current)}
        dataActive={sidePanel === "data"}
        onToggleData={() => setSidePanel((current) => (current === "data" ? "inspect" : "data"))}
        runTrustedScripts={runTrustedScripts}
        onToggleTrusted={toggleTrustedScripts}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => stepHistory(-1)}
        onRedo={() => stepHistory(1)}
        viewport={viewport}
        onViewport={setViewport}
      />

      <section className={`workspace ${sourceVisible ? "" : "source-hidden"}`}>
        <SourcePane
          value={sourceHtml}
          onChange={setSourceHtml}
          visible={sourceVisible}
          onShow={() => setSourceVisible(true)}
        />

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
            <DeckTimeline
              slides={deckSlides}
              activeSlideId={activeSlideId}
              activeSlideIndex={activeSlideIndex}
              onGoSlide={goToDeckSlide}
              onStep={stepDeckSlide}
              onDuplicate={duplicateCurrentSlide}
              onInsert={insertSlideAfterCurrent}
            />
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
            <DataPanel
              dataTitle={dataTitle}
              onTitle={setDataTitle}
              dataText={dataText}
              onDataText={(value) => setDataRows(parseDataText(value))}
              dataRows={dataRows}
              dataColumnCount={dataColumnCount}
              onUpdateCell={updateDataCell}
              onAddRow={addDataRow}
              onAddColumn={addDataColumn}
              onInsert={insertDataTable}
            />
          ) : selected ? (
            <Inspector
              selected={selected}
              onText={updateSelectedText}
              onStyle={updateSelectedStyle}
              onSelectAncestor={(id) => postCommand("select", { id })}
              onSelectParent={() => postCommand("select-parent")}
              onAddClass={(name) => postCommand("set-class", { className: name, action: "add" })}
              onRemoveClass={(name) => postCommand("set-class", { className: name, action: "remove" })}
              onReplaceImage={(src, alt) => postCommand("replace-image", { src, alt })}
              onNudge={(dx, dy) => postCommand("nudge", { dx, dy })}
              onDuplicate={() => postCommand("duplicate")}
              onDelete={() => postCommand("delete")}
            />
          ) : (
            <InspectorEmpty />
          )}
        </aside>
      </section>
    </main>
  );
}
