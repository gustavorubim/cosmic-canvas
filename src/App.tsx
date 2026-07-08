import { ChevronRight } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { DataPanel } from "./components/DataPanel";
import { DeckTimeline } from "./components/DeckTimeline";
import { Inspector, InspectorEmpty } from "./components/Inspector";
import { SourcePane } from "./components/SourcePane";
import { Toolbar } from "./components/Toolbar";
import { Topbar } from "./components/Topbar";
import { ValidationPanel } from "./components/ValidationPanel";
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
  type AuditFinding,
  type InlineFormatAction,
  type SelectedElement,
  type SlideTemplateKind,
  type Viewport,
} from "./protocol";
import { getVsCodeApi, isVsCodeHostMessage } from "./vscodeBridge";

type HistoryState = {
  stack: string[];
  index: number;
};

type PreviewStatus = {
  state: "loading" | "ready";
  title: string;
  bodyTextStart: string;
};

type SidePanel = "inspect" | "data" | "audit";

type Toast = {
  id: number;
  message: string;
};

type DraftPrompt = {
  html: string;
  savedAt: number;
};

const DRAFT_KEY = "cosmic-canvas-draft";

const viewportLabels: Record<Viewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet · 820px",
  mobile: "Mobile · 390px",
};

const modeLabels: Record<EditorMode, string> = {
  text: "Text",
  select: "Select",
  move: "Move",
  preview: "Preview",
};

const modeOrder: EditorMode[] = ["text", "select", "move", "preview"];

const supportsFileSystemAccess =
  typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

function fileNameFromDate() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cosmic-canvas-${stamp}.html`;
}

function normalizeEditableSource(html: string) {
  const normalized = normalizeHtmlInput(html);
  return normalized.includes("data-wysiwyg-") ? cleanEditorHtml(normalized) : normalized;
}

export default function App() {
  const initialHtml = useMemo(() => cleanEditorHtml(SAMPLE_HTML), []);
  const vscodeApi = useMemo(() => getVsCodeApi(), []);
  const isVsCode = Boolean(vscodeApi);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didLoadUrlRef = useRef(false);
  const historyRef = useRef<HistoryState>({ stack: [initialHtml], index: 0 });
  const pendingHistoryTimer = useRef<number>();
  const pendingHostChangeTimer = useRef<number>();
  const fileHandleRef = useRef<any>(null);
  const sourceHtmlRef = useRef(initialHtml);
  const lastScrollRef = useRef({ x: 0, y: 0 });
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const toastIdRef = useRef(0);
  const deckHintShownRef = useRef(false);

  const [sourceHtml, setSourceHtml] = useState(initialHtml);
  const [appliedHtml, setAppliedHtml] = useState(initialHtml);
  const [frameHtml, setFrameHtml] = useState(() => prepareEditableHtml(initialHtml));
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [mode, setMode] = useState<EditorMode>("text");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [runTrustedScripts, setRunTrustedScripts] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(true);
  const [deckSlides, setDeckSlides] = useState<DeckSlide[]>([]);
  const [auditFindings, setAuditFindings] = useState<AuditFinding[]>([]);
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [draftPrompt, setDraftPrompt] = useState<DraftPrompt | null>(null);

  sourceHtmlRef.current = sourceHtml;

  const canUndo = historyState.index > 0;
  const canRedo = historyState.index < historyState.stack.length - 1;
  const sourceDirty = sourceHtml !== appliedHtml;
  const activeSlideIndex = Math.max(
    0,
    deckSlides.findIndex((slide) => slide.id === activeSlideId),
  );
  const dataText = useMemo(() => serializeDataRows(dataRows), [dataRows]);
  const dataColumnCount = Math.max(1, dataRows[0]?.length ?? 1);

  function showToast(message: string) {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2400);
  }

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

  function postHostDocumentChange(html: string, reason: string, immediate = false) {
    if (!vscodeApi) return;
    if (pendingHostChangeTimer.current) {
      window.clearTimeout(pendingHostChangeTimer.current);
    }

    const post = () => {
      vscodeApi.postMessage({ type: "documentChanged", html, reason });
    };

    if (immediate) {
      post();
    } else {
      const delay = reason === "input" || reason === "source" ? 1000 : 250;
      pendingHostChangeTimer.current = window.setTimeout(post, delay);
    }
  }

  function renderHtml(html: string, trustedScripts = runTrustedScripts) {
    setPreviewStatus({ state: "loading", title: "", bodyTextStart: "" });
    setDeckSlides([]);
    setAuditFindings([]);
    setActiveSlideId("");
    deckHintShownRef.current = false;
    setAppliedHtml(html);
    setFrameHtml(prepareEditableHtml(html, trustedScripts));
    setSelected(null);
  }

  function loadHtml(html: string, addToHistory = true, trustedScripts = runTrustedScripts) {
    const clean = normalizeEditableSource(html);
    setSourceHtml(clean);
    renderHtml(clean, trustedScripts);
    if (addToHistory) pushHistory(clean);
  }

  function applySource() {
    const clean = normalizeEditableSource(sourceHtmlRef.current);
    loadHtml(clean);
    postHostDocumentChange(clean, "apply-source", true);
  }

  function loadHostDocument(html: string) {
    const clean = normalizeEditableSource(html);
    setSourceHtml(clean);
    renderHtml(clean);
    syncHistoryState({ stack: [clean], index: 0 });
  }

  function updateSourceHtml(nextHtml: string) {
    setSourceHtml(nextHtml);
    postHostDocumentChange(nextHtml, "source");
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

  function insertSlideTemplate(template: SlideTemplateKind) {
    const slide = deckSlides[activeSlideIndex];
    if (!slide) return;
    postCommand("insert-slide-template", { id: slide.id, template });
  }

  function renameDeckSlide(slide: DeckSlide, title: string) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    postCommand("rename-slide", { id: slide.id, title: cleanTitle });
  }

  function deleteCurrentSlide() {
    const slide = deckSlides[activeSlideIndex];
    if (!slide) return;
    if (!window.confirm(`Delete slide "${slide.title}"?`)) return;
    postCommand("delete-slide", { id: slide.id });
  }

  function moveCurrentSlide(offset: number) {
    const slide = deckSlides[activeSlideIndex];
    if (!slide) return;
    postCommand("move-slide", { id: slide.id, offset });
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

  function formatInline(action: InlineFormatAction) {
    if (action === "create-link") {
      const href = window.prompt("Link URL", "https://");
      if (href === null) return;
      postCommand("format-inline", { action, href });
      return;
    }
    postCommand("format-inline", { action });
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
    postHostDocumentChange(html, "history", true);
  }

  function toggleTrustedScripts(enabled: boolean) {
    setRunTrustedScripts(enabled);
    renderHtml(sourceHtml, enabled);
  }

  async function openFile() {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "openFile" });
      return;
    }

    const picker = (window as any).showOpenFilePicker;
    if (picker) {
      try {
        const [handle] = await picker({
          types: [{ description: "HTML", accept: { "text/html": [".html", ".htm"] } }],
        });
        fileHandleRef.current = handle;
        const file = await handle.getFile();
        loadHtml(await file.text());
        showToast(`Opened ${file.name}`);
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
    showToast(`Opened ${file.name}`);
    event.currentTarget.value = "";
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
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "save", html: clean });
      return;
    }

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
        showToast(`Saved to ${handle.name || "file"}`);
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        console.error(error);
      }
    }
    downloadCleanHtml(clean);
    showToast("Downloaded HTML copy");
  }

  async function copyHtml() {
    const clean = cleanEditorHtml(sourceHtmlRef.current);
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "copy", html: clean });
      return;
    }

    await navigator.clipboard.writeText(clean);
    showToast("HTML copied to clipboard");
  }

  function downloadHtml() {
    const clean = cleanEditorHtml(sourceHtmlRef.current);
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "download", html: clean });
      return;
    }

    downloadCleanHtml(clean);
    showToast("Downloaded HTML copy");
  }

  function restoreDraft() {
    if (!draftPrompt) return;
    loadHtml(draftPrompt.html);
    setDraftPrompt(null);
    showToast("Draft restored");
  }

  function discardDraft() {
    setDraftPrompt(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Best-effort cleanup.
    }
  }

  // Keep the latest action callbacks reachable from the long-lived key handler
  // without re-binding it (and without stale-closure bugs).
  const actionsRef = useRef({ saveToFile, applySource, stepHistory, setEditorMode });
  actionsRef.current = { saveToFile, applySource, stepHistory, setEditorMode };

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
        const active = document.activeElement;
        const editingInspectorText =
          active instanceof HTMLElement && Boolean(active.closest(".text-control"));
        setSelected((current) => {
          if (
            editingInspectorText &&
            current &&
            data.selected &&
            current.id === data.selected.id
          ) {
            return { ...data.selected, text: current.text };
          }
          return data.selected;
        });
      }

      if (data.type === "wysiwyg-deck") {
        setDeckSlides(data.slides);
        setActiveSlideId(data.activeId);
        if (data.slides.length > 0 && !deckHintShownRef.current) {
          deckHintShownRef.current = true;
          showToast("Edit modes type text - use the timeline for slides. Preview runs deck shortcuts.");
        }
      }

      if (data.type === "wysiwyg-audit") {
        setAuditFindings(data.findings);
      }

      if (data.type === "wysiwyg-shortcut") {
        const actions = actionsRef.current;
        if (data.action === "save") void actions.saveToFile();
        if (data.action === "apply-source") actions.applySource();
        if (data.action === "undo") actions.stepHistory(-1);
        if (data.action === "redo") actions.stepHistory(1);
      }

      if (data.type === "wysiwyg-document-change") {
        lastScrollRef.current = { x: data.scrollX, y: data.scrollY };
        const clean = cleanEditorHtml(data.html);
        setSourceHtml(clean);
        setAppliedHtml(clean);
        scheduleHistory(clean);
        postHostDocumentChange(clean, data.reason, data.reason === "blur");
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (pendingHistoryTimer.current) window.clearTimeout(pendingHistoryTimer.current);
    };
  }, [mode]);

  useEffect(() => {
    if (!vscodeApi) return;

    function onVsCodeMessage(event: MessageEvent) {
      if (!isVsCodeHostMessage(event.data)) return;
      const data = event.data;

      if (data.type === "cosmicCanvas.document") {
        loadHostDocument(data.html);
      }

      if (data.type === "cosmicCanvas.toast") {
        showToast(data.message);
      }
    }

    window.addEventListener("message", onVsCodeMessage);
    vscodeApi.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", onVsCodeMessage);
      if (pendingHostChangeTimer.current) window.clearTimeout(pendingHostChangeTimer.current);
    };
  }, [vscodeApi]);

  // Keyboard shortcuts handled at the app-shell level (focus outside the iframe).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const actions = actionsRef.current;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "s") {
        event.preventDefault();
        void actions.saveToFile();
        return;
      }

      if (mod && event.key === "Enter") {
        event.preventDefault();
        actions.applySource();
        return;
      }

      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, .cm-editor, [contenteditable='true']");
      if (inField) return;

      if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        actions.stepHistory(-1);
        return;
      }
      if (mod && ((key === "z" && event.shiftKey) || key === "y")) {
        event.preventDefault();
        actions.stepHistory(1);
        return;
      }

      if (!mod && !event.altKey && /^[1-4]$/.test(event.key)) {
        actions.setEditorMode(modeOrder[Number(event.key) - 1]);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Autosave a recovery draft once the document differs from the starting sample.
  useEffect(() => {
    if (isVsCode) return;
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
    if (isVsCode || !sourceDirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isVsCode, sourceDirty]);

  useEffect(() => {
    if (didLoadUrlRef.current) return;
    didLoadUrlRef.current = true;
    if (isVsCode) return;

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
      setDraftPrompt({ html: draft.html, savedAt: draft.savedAt ?? 0 });
    } catch {
      // Ignore malformed drafts.
    }
  }, []);

  const saveTitle = isVsCode
    ? "Save the VS Code document (Ctrl+S)"
    : supportsFileSystemAccess
      ? "Save to file (Ctrl+S)"
      : "Download a copy (Ctrl+S)";

  return (
    <main className="app-shell">
      <Topbar
        fileInputRef={fileInputRef}
        onOpen={openFile}
        onOpenFile={openHtmlFile}
        onSave={saveToFile}
        saveTitle={saveTitle}
        onCopy={copyHtml}
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

      {draftPrompt ? (
        <div className="draft-banner" role="alert">
          <span>
            Unsaved draft from{" "}
            {draftPrompt.savedAt ? new Date(draftPrompt.savedAt).toLocaleString() : "your last session"}
          </span>
          <button className="button primary" type="button" onClick={restoreDraft}>
            Restore
          </button>
          <button className="button secondary" type="button" onClick={discardDraft}>
            Discard
          </button>
        </div>
      ) : null}

      <section className={`workspace ${sourceVisible ? "" : "source-hidden"}`}>
        <SourcePane
          value={sourceHtml}
          onChange={updateSourceHtml}
          visible={sourceVisible}
          onShow={() => setSourceVisible(true)}
          dirty={sourceDirty}
          onApply={applySource}
        />

        <section className={`preview-pane ${deckSlides.length ? "has-timeline" : ""}`} aria-label="Rendered HTML">
          <div className="pane-title">
            <span className="pane-title-left">
              Canvas
              <em className={`mode-badge mode-${mode}`}>{modeLabels[mode]}</em>
            </span>
            <span title={previewStatus.bodyTextStart || undefined}>
              {previewStatus.state === "ready"
                ? `${viewportLabels[viewport]} - ${previewStatus.title || "Ready"}`
                : `${viewportLabels[viewport]} - Loading`}
            </span>
          </div>
          <div className={`preview-frame preview-frame-${viewport}`}>
            <iframe
              ref={iframeRef}
              sandbox={
                isVsCode
                  ? "allow-scripts allow-downloads"
                  : runTrustedScripts
                    ? "allow-scripts allow-downloads"
                    : "allow-scripts allow-same-origin allow-downloads"
              }
              srcDoc={frameHtml}
              title="Editable HTML preview"
            />
          </div>
          {selected && mode !== "preview" ? (
            <nav className="canvas-breadcrumb" aria-label="Element path">
              {selected.ancestors.map((node, index) => (
                <span key={node.id}>
                  {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
                  <button
                    className={node.id === selected.id ? "is-current" : ""}
                    onClick={() => postCommand("select", { id: node.id })}
                    type="button"
                  >
                    {node.label}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}
          {deckSlides.length ? (
            <DeckTimeline
              slides={deckSlides}
              activeSlideId={activeSlideId}
              activeSlideIndex={activeSlideIndex}
              onGoSlide={goToDeckSlide}
              onStep={stepDeckSlide}
              onDuplicate={duplicateCurrentSlide}
              onInsert={insertSlideAfterCurrent}
              onRename={renameDeckSlide}
              onDelete={deleteCurrentSlide}
              onMove={moveCurrentSlide}
              onTemplate={insertSlideTemplate}
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
              <button aria-pressed={sidePanel === "audit"} onClick={() => setSidePanel("audit")} type="button">
                Audit
              </button>
            </div>
            <span>
              {sidePanel === "inspect"
                ? selected
                  ? selected.tagName
                  : "None"
                : sidePanel === "data"
                  ? `${Math.max(0, dataRows.length - 1)} rows`
                  : `${auditFindings.length} issues`}
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
          ) : sidePanel === "audit" ? (
            <ValidationPanel
              findings={auditFindings}
              onSelect={(elementId) => {
                setSidePanel("inspect");
                postCommand("select", { id: elementId });
              }}
            />
          ) : selected ? (
            <Inspector
              selected={selected}
              onText={updateSelectedText}
              onStyle={updateSelectedStyle}
              onSelectParent={() => postCommand("select-parent")}
              onAddClass={(name) => postCommand("set-class", { className: name, action: "add" })}
              onRemoveClass={(name) => postCommand("set-class", { className: name, action: "remove" })}
              onReplaceImage={(src, alt) => postCommand("replace-image", { src, alt })}
              onNudge={(dx, dy) => postCommand("nudge", { dx, dy })}
              onDuplicate={() => postCommand("duplicate")}
              onDelete={() => postCommand("delete")}
              onInsertElement={(kind) => postCommand("insert-element", { kind })}
              onFormatInline={formatInline}
            />
          ) : (
            <InspectorEmpty />
          )}
        </aside>
      </section>

      {toasts.length ? (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
