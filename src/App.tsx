import { ChevronRight, X } from "lucide-react";
import { Suspense, lazy, type ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DECK_HINT_MESSAGE,
  hostDocumentChangeDelay,
  markBeforeUnloadDirty,
  mergeSelectionEcho,
  shouldInstallBeforeUnload,
  shouldShowDeckHint,
} from "./appPolicies";
import { createBridgeSessionToken } from "./bridgeSession";
import { CheckpointPanel } from "./components/CheckpointPanel";
import { DataPanel } from "./components/DataPanel";
import { DeckNavigator } from "./components/DeckNavigator";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { FindPanel } from "./components/FindPanel";
import { Inspector, InspectorEmpty } from "./components/Inspector";
import { OutlinePanel } from "./components/OutlinePanel";
import { ShortcutPanel } from "./components/ShortcutPanel";
import { Toolbar } from "./components/Toolbar";
import { Topbar } from "./components/Topbar";
import { ValidationPanel } from "./components/ValidationPanel";
import {
  type Checkpoint,
  createCheckpoint,
  restoreCheckpoint,
} from "./checkpoints";
import {
  DEFAULT_DATA_ROWS,
  normalizeDataRows,
  parseDataText,
  serializeDataRows,
} from "./csv";
import { type DraftRecord, draftIdFor, readDrafts, removeDraft, saveDraft } from "./drafts";
import { applySourceOperation, type AppliedSourceOperation } from "./editOperations";
import {
  DEFAULT_DECK_PREFERENCE,
  type DeckPreference,
  readDeckPreference,
  saveDeckPreference,
} from "./deckPreferences";
import {
  BRIDGE_READY_TIMEOUT_MS,
  type PreviewStatus,
  type RuntimeDiagnostics,
  appendPreviewDiagnostic,
  beginPreview,
  markPreviewReady,
  markPreviewTimedOut,
  previewStateLabel,
  withVersionMismatch,
} from "./diagnostics";
import {
  cleanEditorHtml,
  createPrintHtml,
  createSelfContainedHtml,
  normalizeHtmlInput,
  normalizeDeckHtml,
  inlineTrustedModuleEntrypoints,
  prepareEditableHtml,
  SAMPLE_HTML,
} from "./htmlDocument";
import { summarizePptxExportReport } from "./pptx/exportReport";
import type { PptxExportMode, PptxExportReport } from "./pptx/types";
import {
  type DeckSlide,
  type EditorMode,
  isBridgeMessage,
  type AuditFinding,
  type ChartType,
  type ImageFitMode,
  type InlineFormatAction,
  type LayoutAction,
  type OutlineItem,
  type SelectedElement,
  type SlideTemplateKind,
  type Viewport,
  type ZOrderAction,
} from "./protocol";
import { KEYBOARD_SHORTCUTS } from "./shortcuts";
import { checkForUpdate } from "./updateCheck";
import { applyPreviewResourceMap, buildBrowserResourceMap } from "./resourceResolver";
import { getVsCodeApi, isVsCodeHostMessage } from "./vscodeBridge";

type HistoryState = {
  stack: string[];
  index: number;
};

type SidePanel =
  | "inspect"
  | "data"
  | "audit"
  | "find"
  | "outline"
  | "checkpoints"
  | "shortcuts"
  | "diagnostics";

type HostInfo = {
  extensionVersion: string;
  vscodeVersion: string;
  fileName: string;
  uri: string;
  baseUri: string;
};

type Toast = {
  id: number;
  message: string;
};

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
const APP_VERSION = __COSMIC_CANVAS_VERSION__;
const SourcePane = lazy(() =>
  import("./components/SourcePane").then((module) => ({ default: module.SourcePane })),
);

const pptxModeLabels: Record<PptxExportMode, string> = {
  hybrid: "Hybrid",
  editable: "Editable",
  image: "Exact image",
};

const supportsFileSystemAccess =
  typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

function recordShellTiming(name: "sourceCleanup" | "hostUpdate", startedAt: number) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const host = window as Window & { __cosmicShellMetrics?: Record<string, number[]> };
  const metrics = host.__cosmicShellMetrics || (host.__cosmicShellMetrics = {});
  const values = metrics[name] || (metrics[name] = []);
  values.push(Math.max(0, performance.now() - startedAt));
  if (values.length > 200) values.shift();
}

function fileNameFromDate() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cosmic-canvas-${stamp}.html`;
}

function pptxFileNameFromDate(mode: PptxExportMode) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cosmic-canvas-${stamp}-${mode}.pptx`;
}

function normalizeEditableSource(html: string) {
  const startedAt = typeof performance === "undefined" ? 0 : performance.now();
  const normalized = normalizeHtmlInput(html);
  const clean = normalized.includes("data-wysiwyg-") ? cleanEditorHtml(normalized) : normalized;
  if (startedAt) recordShellTiming("sourceCleanup", startedAt);
  return clean;
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return window.btoa(binary);
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
  const pendingHostEditRef = useRef<{
    from: number;
    to: number;
    text: string;
    expected: string;
    key: string;
    html: string;
    reason: string;
  } | null>(null);
  const documentBaseUriRef = useRef("");
  const fileHandleRef = useRef<any>(null);
  const sourceHtmlRef = useRef(initialHtml);
  const lastScrollRef = useRef({ x: 0, y: 0 });
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const toastIdRef = useRef(0);
  const deckHintShownRef = useRef(false);
  const navigatorAutoOpenedRef = useRef(false);
  const previewRevisionRef = useRef(0);
  const sourceEditRevisionRef = useRef(0);
  const bridgeSessionRef = useRef(createBridgeSessionToken());
  const draftIdRef = useRef(draftIdFor("sample", initialHtml));
  const draftTitleRef = useRef("Sample document");
  const initialDeckPreferenceRef = useRef<DeckPreference>(
    typeof localStorage === "undefined"
      ? DEFAULT_DECK_PREFERENCE
      : readDeckPreference(localStorage, draftIdRef.current),
  );
  const deckPreferenceRef = useRef(initialDeckPreferenceRef.current);

  const [sourceHtml, setSourceHtml] = useState(initialHtml);
  const [appliedHtml, setAppliedHtml] = useState(initialHtml);
  const [frameHtml, setFrameHtml] = useState(() =>
    prepareEditableHtml(initialHtml, false, "", bridgeSessionRef.current),
  );
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [mode, setMode] = useState<EditorMode>("text");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [runTrustedScripts, setRunTrustedScripts] = useState(false);
  const [deckPreference, setDeckPreference] = useState(initialDeckPreferenceRef.current);
  const [forceTimeline, setForceTimeline] = useState(initialDeckPreferenceRef.current.mode === "force");
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(true);
  const [sourceVisible, setSourceVisible] = useState(true);
  const [sourceIncrementalEdit, setSourceIncrementalEdit] = useState<{
    revision: number;
    from: number;
    to: number;
    text: string;
  } | null>(null);
  const [deckSlides, setDeckSlides] = useState<DeckSlide[]>([]);
  const [auditFindings, setAuditFindings] = useState<AuditFinding[]>([]);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [outlineTruncated, setOutlineTruncated] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointName, setCheckpointName] = useState("");
  const [findQuery, setFindQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findCount, setFindCount] = useState(0);
  const [activeSlideId, setActiveSlideId] = useState("");
  const [sidePanel, setSidePanel] = useState<SidePanel>("inspect");
  const [dataTitle, setDataTitle] = useState("Launch metrics");
  const [dataRows, setDataRows] = useState(() => DEFAULT_DATA_ROWS.map((row) => [...row]));
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>(() => beginPreview(0, initialHtml));
  const [hostInfo, setHostInfo] = useState<HostInfo>({
    extensionVersion: "",
    vscodeVersion: "",
    fileName: "",
    uri: "",
    baseUri: "",
  });
  const [historyState, setHistoryState] = useState<HistoryState>(historyRef.current);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [draftPrompt, setDraftPrompt] = useState<DraftRecord[]>([]);
  const [pptxReport, setPptxReport] = useState<PptxExportReport | null>(null);
  const [pptxExportingMode, setPptxExportingMode] = useState<PptxExportMode | null>(null);
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
  const runtimeDiagnostics: RuntimeDiagnostics = {
    appVersion: APP_VERSION,
    hostMode: isVsCode ? "VS Code" : "Browser",
    extensionVersion: hostInfo.extensionVersion,
    vscodeVersion: hostInfo.vscodeVersion,
    browserEngine: typeof navigator === "undefined" ? "" : navigator.userAgent,
    fileName: hostInfo.fileName || draftTitleRef.current,
    uri: hostInfo.uri,
    baseUri: hostInfo.baseUri,
    trustedScripts: runTrustedScripts,
    forceTimeline,
    preview: previewStatus,
  };

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

  function flushPendingHistory() {
    if (!pendingHistoryTimer.current) return;
    window.clearTimeout(pendingHistoryTimer.current);
    pendingHistoryTimer.current = undefined;
    pushHistory(sourceHtmlRef.current);
  }

  function cancelPendingHostEdit() {
    if (pendingHostChangeTimer.current) window.clearTimeout(pendingHostChangeTimer.current);
    pendingHostChangeTimer.current = undefined;
    pendingHostEditRef.current = null;
  }

  function flushPendingHostEdit() {
    if (!vscodeApi || !pendingHostEditRef.current) return;
    const pending = pendingHostEditRef.current;
    pendingHostEditRef.current = null;
    pendingHostChangeTimer.current = undefined;
    const startedAt = performance.now();
    vscodeApi.postMessage({
      type: "documentEdit",
      from: pending.from,
      to: pending.to,
      text: pending.text,
      expected: pending.expected,
      fallbackHtml: pending.html,
      reason: pending.reason,
    });
    recordShellTiming("hostUpdate", startedAt);
  }

  function postHostSourceEdit(applied: AppliedSourceOperation, html: string, reason: string) {
    if (!vscodeApi) return;
    const edit = applied.edit;
    const pending = pendingHostEditRef.current;
    if (pending && pending.key !== edit.key) flushPendingHostEdit();
    const current = pendingHostEditRef.current;
    pendingHostEditRef.current = current
      ? { ...current, text: edit.text, html, reason }
      : { ...edit, html, reason };
    if (pendingHostChangeTimer.current) window.clearTimeout(pendingHostChangeTimer.current);
    pendingHostChangeTimer.current = window.setTimeout(flushPendingHostEdit, hostDocumentChangeDelay(reason));
  }

  function postHostDocumentChange(html: string, reason: string, immediate = false) {
    if (!vscodeApi) return;
    cancelPendingHostEdit();

    const post = () => {
      const startedAt = performance.now();
      vscodeApi.postMessage({ type: "documentChanged", html, reason });
      recordShellTiming("hostUpdate", startedAt);
    };

    if (immediate) {
      post();
    } else {
      pendingHostChangeTimer.current = window.setTimeout(post, hostDocumentChangeDelay(reason));
    }
  }

  function renderHtml(
    html: string,
    trustedScripts = runTrustedScripts,
    baseUri = documentBaseUriRef.current,
    previewHtml = html,
  ) {
    flushPendingHistory();
    flushPendingHostEdit();
    if (html.length > 1_000_000) setSourceVisible(false);
    documentBaseUriRef.current = baseUri;
    const revision = ++previewRevisionRef.current;
    setPreviewStatus(beginPreview(revision, html, baseUri));
    setDeckSlides([]);
    setAuditFindings([]);
    setActiveSlideId("");
    setPptxReport(null);
    deckHintShownRef.current = false;
    setAppliedHtml(html);
    setSourceIncrementalEdit(null);
    bridgeSessionRef.current = createBridgeSessionToken();
    setFrameHtml(prepareEditableHtml(previewHtml, trustedScripts, baseUri, bridgeSessionRef.current));
    setSelected(null);
  }

  function setDraftContext(title: string, html: string) {
    draftTitleRef.current = title || "Untitled document";
    draftIdRef.current = draftIdFor(draftTitleRef.current, html);
    const preference = readDeckPreference(localStorage, draftIdRef.current);
    deckPreferenceRef.current = preference;
    setDeckPreference(preference);
    setForceTimeline(preference.mode === "force");
  }

  function loadHtml(
    html: string,
    addToHistory = true,
    trustedScripts = runTrustedScripts,
    title?: string,
    baseUri = documentBaseUriRef.current,
    previewHtml?: string,
  ) {
    const clean = normalizeEditableSource(html);
    if (title) setDraftContext(title, clean);
    setSourceHtml(clean);
    renderHtml(clean, trustedScripts, baseUri, previewHtml || clean);
    if (addToHistory) pushHistory(clean);
  }

  function applySource() {
    const clean = normalizeEditableSource(sourceHtmlRef.current);
    loadHtml(clean);
    postHostDocumentChange(clean, "apply-source", true);
  }

  function loadHostDocument(html: string, baseUri: string, resources: Record<string, string>) {
    const clean = normalizeEditableSource(html);
    setDraftContext("VS Code document", clean);
    setSourceHtml(clean);
    renderHtml(clean, runTrustedScripts, baseUri, applyPreviewResourceMap(clean, resources));
    syncHistoryState({ stack: [clean], index: 0 });
  }

  function updateSourceHtml(nextHtml: string) {
    setSourceHtml(nextHtml);
    postHostDocumentChange(nextHtml, "source");
  }

  function postCommand(command: string, payload: Record<string, unknown> = {}) {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "wysiwyg-command", command, ...payload, sessionToken: bridgeSessionRef.current },
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

  function insertDataChart(chartType: ChartType) {
    const normalized = normalizeDataRows(dataRows);
    const columns = normalized[0].map((cell, index) => cell.trim() || `Column ${index + 1}`);
    const rows = normalized.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));
    if (!rows.length) return;
    postCommand("insert-chart", { chartType, columns, rows, title: dataTitle.trim() });
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

  function updateSelectedLayout(action: LayoutAction) {
    postCommand("layout", { action });
  }

  function updateImageFit(fit: ImageFitMode) {
    postCommand("set-image-fit", { fit });
  }

  function updateBackground(src: string) {
    postCommand("replace-background", { src });
  }

  function updateThemeFont(fontFamily: string) {
    postCommand("set-theme-font", { fontFamily });
  }

  function swapThemeColor(from: string, to: string) {
    postCommand("swap-theme-color", { from, to });
  }

  function updateSlideBackground(color: string) {
    postCommand("set-slide-background", { color });
  }

  function findInDocument() {
    postCommand("find-text", { query: findQuery });
  }

  function replaceInDocument() {
    postCommand("replace-text", { query: findQuery, replacement: replaceText });
  }

  function updateZOrder(action: ZOrderAction) {
    postCommand("z-order", { action });
  }

  function createNamedCheckpoint() {
    const next = createCheckpoint(checkpoints, sourceHtmlRef.current, checkpointName);
    setCheckpoints(next);
    setCheckpointName("");
    showToast(`Checkpoint created: ${next[0].name}`);
  }

  function restoreCheckpointById(id: string) {
    const html = restoreCheckpoint(checkpoints, id);
    if (!html) return;
    loadHtml(html);
    postHostDocumentChange(html, "checkpoint", true);
    showToast("Checkpoint restored");
  }

  function normalizeCurrentDeck() {
    const normalized = normalizeDeckHtml(sourceHtmlRef.current);
    loadHtml(normalized);
    postHostDocumentChange(normalized, "normalize", true);
    showToast("Deck normalized");
  }

  function stepHistory(offset: number) {
    flushPendingHistory();
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

  function postDeckPreference(preference: DeckPreference) {
    if (preference.mode === "selector") {
      postCommand("set-deck-selector", { selector: preference.selector });
      return;
    }
    if (preference.mode === "siblings") {
      postCommand("set-deck-from-selection", { siblingPath: preference.siblingPath });
      return;
    }
    if (preference.mode === "marked") {
      postCommand("set-deck-marked", { paths: preference.markedPaths || [] });
      return;
    }
    if (preference.mode === "force") {
      postCommand("set-force-timeline", { enabled: true });
      return;
    }
    postCommand("clear-deck-override");
  }

  function applyDeckPreference(preference: DeckPreference) {
    deckPreferenceRef.current = preference;
    setDeckPreference(preference);
    setForceTimeline(preference.mode === "force");
    try {
      saveDeckPreference(localStorage, draftIdRef.current, preference);
    } catch {
      // Storage can be disabled in hardened browser profiles; the current session still works.
    }
    postDeckPreference(preference);
  }

  function toggleForceTimeline(enabled: boolean) {
    applyDeckPreference(enabled ? { mode: "force", selector: "" } : DEFAULT_DECK_PREFERENCE);
  }

  function applyDeckSelector(selector: string) {
    const cleanSelector = selector.trim().slice(0, 500);
    if (!cleanSelector) {
      applyDeckPreference(DEFAULT_DECK_PREFERENCE);
      return;
    }
    applyDeckPreference({ mode: "selector", selector: cleanSelector });
  }

  function useSelectedSiblingsAsDeck() {
    if (!selected) {
      showToast("Select an element inside a page first.");
      return;
    }
    applyDeckPreference({ mode: "siblings", selector: "" });
  }

  function toggleSelectedDeckPage() {
    const path = selected?.sourcePath;
    if (!path?.length) {
      showToast("Select the page container you want to mark first.");
      return;
    }
    const key = path.join(".");
    const current = deckPreference.mode === "marked" ? deckPreference.markedPaths || [] : [];
    const exists = current.some((candidate) => candidate.join(".") === key);
    const markedPaths = exists
      ? current.filter((candidate) => candidate.join(".") !== key)
      : [...current, path];
    applyDeckPreference(markedPaths.length
      ? { mode: "marked", selector: "", markedPaths }
      : DEFAULT_DECK_PREFERENCE);
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
        loadHtml(await file.text(), true, runTrustedScripts, file.name, "");
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
    loadHtml(await file.text(), true, runTrustedScripts, file.name, "");
    showToast(`Opened ${file.name}`);
    event.currentTarget.value = "";
  }

  function downloadCleanHtml(clean: string, suffix = "") {
    const blob = new Blob([clean], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suffix ? fileNameFromDate().replace(/\.html$/, `-${suffix}.html`) : fileNameFromDate();
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
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

  async function copyDiagnosticsText(text: string) {
    try {
      if (vscodeApi) {
        vscodeApi.postMessage({ type: "copyText", text });
      } else {
        await navigator.clipboard.writeText(text);
        showToast("Diagnostics copied to clipboard");
      }
    } catch {
      showToast("Unable to copy diagnostics");
    }
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

  async function downloadSelfContainedHtml() {
    const result = await createSelfContainedHtml(sourceHtmlRef.current);
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "download", html: result.html });
    } else {
      downloadCleanHtml(result.html, "self-contained");
    }
    showToast(
      result.failures.length
        ? `Downloaded with ${result.failures.length} image${result.failures.length === 1 ? "" : "s"} still external`
        : "Downloaded self-contained HTML",
    );
  }

  function downloadPrintHtml() {
    const printable = createPrintHtml(sourceHtmlRef.current);
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "download", html: printable });
      return;
    }
    downloadCleanHtml(printable, "print");
    showToast("Downloaded print HTML");
  }

  function previewDocumentForExport() {
    if (sourceDirty) return null;
    try {
      return iframeRef.current?.contentDocument || null;
    } catch {
      return null;
    }
  }

  async function downloadPowerPoint(mode: PptxExportMode) {
    setPptxExportingMode(mode);
    setPptxReport(null);
    try {
      showToast(`Preparing PowerPoint ${pptxModeLabels[mode]} export...`);
      const { exportPowerPoint } = await import("./pptx/exportPowerPoint");
      const result = await exportPowerPoint({
        document: previewDocumentForExport(),
        html: sourceHtmlRef.current,
        mode,
        fileBaseName: draftTitleRef.current || pptxFileNameFromDate(mode),
      });
      if (vscodeApi) {
        vscodeApi.postMessage({
          type: "downloadBinary",
          fileName: result.fileName,
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          base64: await blobToBase64(result.blob),
        });
      } else {
        downloadBlob(result.blob, result.fileName);
      }
      setPptxReport(result.report);
      showToast(summarizePptxExportReport(result.report));
      if (result.report.warnings.length) {
        console.warn("Cosmic Canvas PPTX export warnings", result.report.warnings);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(error);
      showToast(`PowerPoint export failed: ${message}`);
    } finally {
      setPptxExportingMode(null);
    }
  }

  function restoreDraft(draft: DraftRecord) {
    setDraftContext(draft.title, draft.html);
    loadHtml(draft.html, true, runTrustedScripts, draft.title, "");
    setDraftPrompt([]);
    showToast(`Draft restored: ${draft.title}`);
  }

  function discardDraft(id?: string) {
    const targetId = id || draftPrompt[0]?.id;
    setDraftPrompt((current) => current.filter((draft) => draft.id !== targetId));
    try {
      if (targetId) removeDraft(localStorage, targetId);
    } catch {
      // Best-effort cleanup.
    }
  }

  // Keep the latest action callbacks reachable from the long-lived key handler
  // without re-binding it (and without stale-closure bugs).
  const actionsRef = useRef({ saveToFile, applySource, stepHistory, setEditorMode });
  actionsRef.current = { saveToFile, applySource, stepHistory, setEditorMode };

  useLayoutEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data?.type === "wysiwyg-probe") {
        vscodeApi?.postMessage({
          type: "bridgeStatus",
          state: "loading",
          codes: [event.source === iframeRef.current?.contentWindow ? "bridge-probe" : "bridge-probe-wrong-source"],
        });
        return;
      }
      if (event.data?.type === "wysiwyg-bridge-error") {
        if (
          event.source === iframeRef.current?.contentWindow &&
          event.data?.sessionToken === bridgeSessionRef.current
        ) {
          setPreviewStatus((current) => appendPreviewDiagnostic(current, {
            id: "bridge-runtime-error",
            code: "bridge-runtime-error",
            severity: "error",
            title: "Editing bridge crashed during startup",
            message: String(event.data.message || "Unknown bridge runtime error"),
          }));
        }
        vscodeApi?.postMessage({
          type: "bridgeStatus",
          state: "failed",
          codes: ["bridge-runtime-error", String(event.data.message || "unknown")],
        });
      }
      if (event.source !== iframeRef.current?.contentWindow) {
        if (typeof event.data?.type === "string" && event.data.type.startsWith("wysiwyg-")) {
          setPreviewStatus((current) => appendPreviewDiagnostic(current, {
            id: "bridge-source-rejected",
            code: "bridge-source-rejected",
            severity: "warning",
            title: "Bridge message rejected",
            message: "A protocol-shaped message came from outside the current preview and was ignored.",
          }));
        }
        if (event.data?.type === "wysiwyg-ready") {
          vscodeApi?.postMessage({ type: "bridgeStatus", state: "failed", codes: ["bridge-wrong-source"] });
        }
        return;
      }
      if (event.data?.sessionToken !== bridgeSessionRef.current) {
        if (typeof event.data?.type === "string" && event.data.type.startsWith("wysiwyg-")) {
          setPreviewStatus((current) => appendPreviewDiagnostic(current, {
            id: "bridge-session-rejected",
            code: "bridge-session-rejected",
            severity: "warning",
            title: "Stale preview message rejected",
            message: "A protocol-shaped message without the current preview token was ignored.",
          }));
        }
        if (event.data?.type === "wysiwyg-ready") {
          vscodeApi?.postMessage({ type: "bridgeStatus", state: "failed", codes: ["bridge-wrong-session"] });
        }
        return;
      }
      if (!isBridgeMessage(event.data)) {
        if (typeof event.data?.type === "string" && event.data.type.startsWith("wysiwyg-")) {
          setPreviewStatus((current) => appendPreviewDiagnostic(current, {
            id: "bridge-message-rejected",
            code: "bridge-message-rejected",
            severity: "warning",
            title: "Malformed bridge message rejected",
            message: `A ${String(event.data.type).slice(0, 80)} message failed payload validation and was ignored.`,
          }));
        }
        return;
      }
      const data = event.data;

      if (data.type === "wysiwyg-ready") {
        setPreviewStatus((current) =>
          withVersionMismatch(
            markPreviewReady(current, { title: data.title, bodyTextStart: data.bodyTextStart }),
            APP_VERSION,
            hostInfo.extensionVersion,
          ),
        );
        vscodeApi?.postMessage({ type: "bridgeStatus", state: "ready" });
        postCommand("set-mode", { mode });
        postDeckPreference(deckPreferenceRef.current);
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
          return mergeSelectionEcho(current, data.selected, editingInspectorText);
        });
      }

      if (data.type === "wysiwyg-deck") {
        setDeckSlides(data.slides);
        setActiveSlideId(data.activeId);
        if (data.slides.length && !navigatorAutoOpenedRef.current) {
          navigatorAutoOpenedRef.current = true;
          setNavigatorCollapsed(false);
        }
        if (shouldShowDeckHint(data.slides.length, deckHintShownRef.current)) {
          deckHintShownRef.current = true;
          showToast(DECK_HINT_MESSAGE);
        }
      }

      if (data.type === "wysiwyg-layers") {
        // Retained for backward-compatible bridges; the full outline supersedes this sibling-only view.
      }

      if (data.type === "wysiwyg-outline") {
        setOutlineItems(data.items);
        setOutlineTruncated(data.truncated);
      }

      if (data.type === "wysiwyg-audit") {
        setAuditFindings(data.findings);
      }

      if (data.type === "wysiwyg-find") {
        setFindQuery(data.query);
        setFindCount(data.count);
      }

      if (data.type === "wysiwyg-deck-preference") {
        const preference: DeckPreference = {
          mode: "siblings",
          selector: "",
          siblingPath: data.siblingPath,
        };
        deckPreferenceRef.current = preference;
        setDeckPreference(preference);
        try {
          saveDeckPreference(localStorage, draftIdRef.current, preference);
        } catch {
          // Keep the in-memory preference when storage is unavailable.
        }
      }

      if (data.type === "wysiwyg-diagnostic") {
        setPreviewStatus((current) => appendPreviewDiagnostic(current, data.diagnostic));
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
        sourceHtmlRef.current = clean;
        setSourceHtml(clean);
        setAppliedHtml(clean);
        scheduleHistory(clean);
        postHostDocumentChange(clean, data.reason, data.reason === "blur");
      }

      if (data.type === "wysiwyg-operation") {
        lastScrollRef.current = { x: data.scrollX, y: data.scrollY };
        const applied = applySourceOperation(sourceHtmlRef.current, data.operation);
        if (!applied) {
          setPreviewStatus((current) => appendPreviewDiagnostic(current, {
            id: "source-range-ambiguous",
            code: "source-range-ambiguous",
            severity: "warning",
            title: "Incremental source range was ambiguous",
            message: "Cosmic Canvas requested a clean full-document recovery for this edit.",
          }));
          postCommand("request-html");
          return;
        }
        sourceHtmlRef.current = applied.source;
        setSourceIncrementalEdit({
          revision: ++sourceEditRevisionRef.current,
          from: applied.edit.from,
          to: applied.edit.to,
          text: applied.edit.text,
        });
        setSourceHtml(applied.source);
        setAppliedHtml(applied.source);
        scheduleHistory(applied.source);
        postHostSourceEdit(applied, applied.source, data.operation.reason);
        setPreviewStatus((current) => appendPreviewDiagnostic(current, {
          id: "incremental-operation",
          code: "incremental-operation",
          severity: "info",
          title: "Incremental editing active",
          message: "Applied " + data.operation.kind + " operation without serializing the full document.",
        }));
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (pendingHistoryTimer.current) window.clearTimeout(pendingHistoryTimer.current);
    };
  }, [mode, hostInfo.extensionVersion]);

  useEffect(() => {
    void checkForUpdate(APP_VERSION, localStorage).then((version) => {
      if (version) showToast(`Cosmic Canvas ${version} is available on GitHub.`);
    });
  }, []);

  useEffect(() => {
    if (!vscodeApi) return;

    function onVsCodeMessage(event: MessageEvent) {
      if (!isVsCodeHostMessage(event.data)) return;
      const data = event.data;

      if (data.type === "cosmicCanvas.document") {
        setHostInfo({
          extensionVersion: data.extensionVersion,
          vscodeVersion: data.vscodeVersion,
          fileName: data.fileName,
          uri: data.uri,
          baseUri: data.baseUri,
        });
        loadHostDocument(data.html, data.baseUri, data.resources);
      }

      if (data.type === "cosmicCanvas.toast") {
        showToast(data.message);
      }

      if (data.type === "cosmicCanvas.hostEdit") {
        setPreviewStatus((current) => appendPreviewDiagnostic(current, data.mode === "targeted"
          ? {
              id: "host-targeted-edit",
              code: "host-targeted-edit",
              severity: "info",
              title: "VS Code range edit applied",
              message: "The host updated only the affected source range.",
            }
          : {
              id: "host-full-replace-fallback",
              code: "host-full-replace-fallback",
              severity: "warning",
              title: "VS Code used full-document fallback",
              message: "The source range changed before the edit could be applied.",
              detail: data.reason,
            }));
      }
    }

    window.addEventListener("message", onVsCodeMessage);
    vscodeApi.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", onVsCodeMessage);
      if (pendingHostChangeTimer.current) window.clearTimeout(pendingHostChangeTimer.current);
    };
  }, [vscodeApi]);

  useEffect(() => {
    if (previewStatus.state !== "loading") return;
    const revision = previewStatus.revision;
    const timer = window.setTimeout(() => {
      setPreviewStatus((current) =>
        current.revision === revision ? markPreviewTimedOut(current) : current,
      );
    }, BRIDGE_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [previewStatus.revision, previewStatus.state]);

  useEffect(() => {
    vscodeApi?.postMessage({
      type: "bridgeStatus",
      state: previewStatus.state,
      codes: previewStatus.diagnostics.map((diagnostic) => diagnostic.code),
      resourceFailures: previewStatus.diagnostics
        .filter((diagnostic) => diagnostic.code === "resource-unavailable" || diagnostic.code === "resource-blocked")
        .map((diagnostic) => diagnostic.detail || diagnostic.message),
    });
  }, [previewStatus.state, previewStatus.diagnostics, vscodeApi]);

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
        saveDraft(localStorage, {
          id: draftIdRef.current,
          title: draftTitleRef.current,
          html: sourceHtml,
          savedAt: Date.now(),
        });
      } catch {
        // Storage may be unavailable (private mode / quota); drafts are best-effort.
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [sourceHtml, initialHtml]);

  useEffect(() => {
    if (!shouldInstallBeforeUnload(isVsCode, sourceDirty)) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      return markBeforeUnloadDirty(event);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isVsCode, sourceDirty]);

  useEffect(() => {
    if (didLoadUrlRef.current) return;
    didLoadUrlRef.current = true;
    if (isVsCode) return;

    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const loadUrl = params.get("load") || hashParams.get("load");
    if (loadUrl) {
      const trusted = params.get("trusted") === "1" || hashParams.get("trusted") === "1";
      setRunTrustedScripts(trusted);
      fetch(loadUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Unable to load ${loadUrl}: ${response.status}`);
          return response.text();
        })
        .then(async (html) => {
          let baseUri = hashParams.get("resourceBase") || "";
          try {
            const parsed = new URL(baseUri || loadUrl, window.location.href);
            if (baseUri && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              baseUri = "";
            } else if (baseUri) {
              baseUri = parsed.toString();
            } else if (!baseUri && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
              baseUri = new URL(".", parsed).toString();
            }
          } catch {
            // Invalid or opaque URLs have no usable relative-resource base.
          }
          const resourceMap = baseUri ? await buildBrowserResourceMap(html, baseUri) : {};
          const mappedHtml = applyPreviewResourceMap(html, resourceMap);
          const previewHtml = trusted && baseUri
            ? await inlineTrustedModuleEntrypoints(mappedHtml, baseUri)
            : mappedHtml;
          loadHtml(html, true, trusted, loadUrl, baseUri, previewHtml);
        })
        .catch((error: unknown) => console.error(error));
      return;
    }

    try {
      setDraftPrompt(readDrafts(localStorage));
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
        version={APP_VERSION}
        fileInputRef={fileInputRef}
        onOpen={openFile}
        onOpenFile={openHtmlFile}
        onSave={saveToFile}
        saveTitle={saveTitle}
        onCopy={copyHtml}
        onDownload={downloadHtml}
        onDownloadSelfContained={() => void downloadSelfContainedHtml()}
        onDownloadPrint={downloadPrintHtml}
        onDownloadPowerPointHybrid={() => void downloadPowerPoint("hybrid")}
        onDownloadPowerPointEditable={() => void downloadPowerPoint("editable")}
        onDownloadPowerPointImage={() => void downloadPowerPoint("image")}
        onNormalize={normalizeCurrentDeck}
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
        forceTimeline={forceTimeline}
        onToggleForceTimeline={toggleForceTimeline}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => stepHistory(-1)}
        onRedo={() => stepHistory(1)}
        viewport={viewport}
        onViewport={setViewport}
      />

      {draftPrompt.length ? (
        <div className="draft-banner" role="alert">
          <span>Recent drafts</span>
          <div className="draft-list">
            {draftPrompt.slice(0, 3).map((draft) => (
              <div className="draft-item" key={draft.id}>
                <strong>{draft.title}</strong>
                <em>{draft.savedAt ? new Date(draft.savedAt).toLocaleString() : "Unknown time"}</em>
                <button className="button primary" type="button" onClick={() => restoreDraft(draft)}>
                  Restore
                </button>
                <button className="button secondary" type="button" onClick={() => discardDraft(draft.id)}>
                  Discard
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section
        className={`workspace ${sourceVisible ? "" : "source-hidden"} ${navigatorCollapsed ? "navigator-collapsed" : ""}`}
      >
        <Suspense fallback={<aside className="source-pane source-loading">Loading HTML source...</aside>}>
          <SourcePane
            value={sourceHtml}
            onChange={updateSourceHtml}
            visible={sourceVisible}
            onShow={() => setSourceVisible(true)}
            dirty={sourceDirty}
            onApply={applySource}
            selected={selected}
            incrementalEdit={sourceIncrementalEdit}
          />
        </Suspense>

        <DeckNavigator
          slides={deckSlides}
          activeSlideId={activeSlideId}
          activeSlideIndex={activeSlideIndex}
          collapsed={navigatorCollapsed}
          onCollapsed={setNavigatorCollapsed}
          onForceTimeline={() => toggleForceTimeline(true)}
          detectionMode={deckPreference.mode}
          selector={deckPreference.selector}
          canUseSelection={Boolean(selected)}
          selectedIsMarked={Boolean(selected?.sourcePath && deckPreference.markedPaths?.some(
            (path) => path.join(".") === selected.sourcePath?.join("."),
          ))}
          onApplySelector={applyDeckSelector}
          onUseSelectedSiblings={useSelectedSiblingsAsDeck}
          onToggleSelectedPage={toggleSelectedDeckPage}
          onAutomaticDetection={() => applyDeckPreference(DEFAULT_DECK_PREFERENCE)}
          onGoSlide={goToDeckSlide}
          onStep={stepDeckSlide}
          onDuplicate={duplicateCurrentSlide}
          onInsert={insertSlideAfterCurrent}
          onRename={renameDeckSlide}
          onDelete={deleteCurrentSlide}
          onMove={moveCurrentSlide}
          onTemplate={insertSlideTemplate}
        />

        <section
          aria-label="Rendered HTML"
          className="preview-pane"
          data-mode={mode}
        >
          <div className="pane-title">
            <span className="pane-title-left">
              Canvas
              <em className={`mode-badge mode-${mode}`}>{modeLabels[mode]}</em>
            </span>
            <span title={previewStatus.bodyTextStart || undefined}>
              {`${viewportLabels[viewport]} - ${previewStatus.title || previewStateLabel(previewStatus.state)}`}
            </span>
          </div>
          <div className={`preview-frame preview-frame-${viewport}`}>
            {previewStatus.state === "failed" ? (
              <div className="preview-failure" role="alert">
                <strong>Editing bridge unavailable</strong>
                <span>The page may still render, but selection and navigation are not connected.</span>
                <button onClick={() => setSidePanel("diagnostics")} type="button">
                  Open diagnostics
                </button>
              </div>
            ) : null}
            <iframe
              ref={iframeRef}
              sandbox={
                "allow-scripts allow-downloads"
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
              <button aria-pressed={sidePanel === "find"} onClick={() => setSidePanel("find")} type="button">
                Find
              </button>
              <button aria-pressed={sidePanel === "outline"} onClick={() => setSidePanel("outline")} type="button">
                Outline
              </button>
              <button
                aria-pressed={sidePanel === "checkpoints"}
                onClick={() => setSidePanel("checkpoints")}
                type="button"
              >
                Saves
              </button>
              <button
                aria-pressed={sidePanel === "shortcuts"}
                onClick={() => setSidePanel("shortcuts")}
                type="button"
              >
                Keys
              </button>
              <button
                aria-pressed={sidePanel === "diagnostics"}
                onClick={() => setSidePanel("diagnostics")}
                type="button"
              >
                Status
              </button>
            </div>
            <span>
              {sidePanel === "inspect"
                ? selected
                  ? selected.tagName
                  : "None"
                : sidePanel === "data"
                  ? `${Math.max(0, dataRows.length - 1)} rows`
                  : sidePanel === "find"
                    ? `${findCount} matches`
                    : sidePanel === "outline"
                      ? `${outlineItems.length} elements`
                      : sidePanel === "checkpoints"
                        ? `${checkpoints.length} saved`
                        : sidePanel === "shortcuts"
                          ? `${KEYBOARD_SHORTCUTS.length} shortcuts`
                          : sidePanel === "diagnostics"
                            ? previewStateLabel(previewStatus.state)
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
              onInsertChart={insertDataChart}
            />
          ) : sidePanel === "audit" ? (
            <ValidationPanel
              findings={auditFindings}
              onSelect={(elementId) => {
                setSidePanel("inspect");
                postCommand("select", { id: elementId });
              }}
            />
          ) : sidePanel === "find" ? (
            <FindPanel
              query={findQuery}
              replacement={replaceText}
              count={findCount}
              onQuery={setFindQuery}
              onReplacement={setReplaceText}
              onFind={findInDocument}
              onReplace={replaceInDocument}
            />
          ) : sidePanel === "outline" ? (
            <OutlinePanel
              items={outlineItems}
              truncated={outlineTruncated}
              onSelect={(id) => {
                setSidePanel("inspect");
                postCommand("select", { id });
              }}
              onHidden={(item, enabled) => postCommand("set-outline-hidden", { id: item.id, enabled })}
              onLocked={(item, enabled) => postCommand("set-outline-locked", { id: item.id, enabled })}
              onPickThrough={(item, enabled) => postCommand("set-picking-ignored", { id: item.id, enabled })}
              onZOrder={updateZOrder}
            />
          ) : sidePanel === "checkpoints" ? (
            <CheckpointPanel
              checkpoints={checkpoints}
              name={checkpointName}
              onName={setCheckpointName}
              onCreate={createNamedCheckpoint}
              onRestore={restoreCheckpointById}
            />
          ) : sidePanel === "shortcuts" ? (
            <ShortcutPanel />
          ) : sidePanel === "diagnostics" ? (
            <DiagnosticsPanel runtime={runtimeDiagnostics} onCopy={(text) => void copyDiagnosticsText(text)} />
          ) : selected ? (
            <Inspector
              selected={selected}
              onText={updateSelectedText}
              onStyle={updateSelectedStyle}
              onSelectParent={() => postCommand("select-parent")}
              onAddClass={(name) => postCommand("set-class", { className: name, action: "add" })}
              onRemoveClass={(name) => postCommand("set-class", { className: name, action: "remove" })}
              onReplaceImage={(src, alt) => postCommand("replace-image", { src, alt })}
              onImageFit={updateImageFit}
              onReplaceBackground={updateBackground}
              onThemeFont={updateThemeFont}
              onPaletteSwap={swapThemeColor}
              onSlideBackground={updateSlideBackground}
              onNudge={(dx, dy) => postCommand("nudge", { dx, dy })}
              onDuplicate={() => postCommand("duplicate")}
              onDelete={() => postCommand("delete")}
              onInsertElement={(kind) => postCommand("insert-element", { kind })}
              onFormatInline={formatInline}
              onLayout={updateSelectedLayout}
            />
          ) : (
            <InspectorEmpty />
          )}
        </aside>
      </section>

      {pptxExportingMode || pptxReport ? (
        <section className="pptx-report" aria-live="polite" aria-label="PowerPoint export report">
          <header>
            <div>
              <strong>PowerPoint export</strong>
              <span>
                {pptxExportingMode
                  ? `${pptxModeLabels[pptxExportingMode]} in progress`
                  : pptxReport
                    ? `${pptxModeLabels[pptxReport.mode]} complete`
                    : ""}
              </span>
            </div>
            <button aria-label="Close PowerPoint export report" onClick={() => setPptxReport(null)} type="button">
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          {pptxExportingMode ? (
            <p className="pptx-report-status">Preparing slides, assets, and PowerPoint layers.</p>
          ) : pptxReport ? (
            <>
              <div className="pptx-report-counts">
                <span>
                  <strong>{pptxReport.slideCount}</strong>
                  Slides
                </span>
                <span>
                  <strong>{pptxReport.editableObjectCount}</strong>
                  Editable
                </span>
                <span>
                  <strong>{pptxReport.rasterObjectCount}</strong>
                  Images
                </span>
                <span>
                  <strong>{pptxReport.skippedObjectCount}</strong>
                  Skipped
                </span>
              </div>
              {pptxReport.warnings.length ? (
                <div className="pptx-warning-list">
                  {pptxReport.warnings.slice(0, 7).map((warning, index) => {
                    const slide = deckSlides[warning.slideIndex];
                    return (
                      <div className="pptx-warning" key={`${warning.slideIndex}-${warning.elementPath}-${warning.code}-${index}`}>
                        <button
                          disabled={!slide}
                          onClick={() => {
                            if (slide) goToDeckSlide(slide);
                          }}
                          type="button"
                        >
                          Slide {warning.slideIndex + 1}
                        </button>
                        <code>{warning.code}</code>
                        <span>{warning.message}</span>
                      </div>
                    );
                  })}
                  {pptxReport.warnings.length > 7 ? (
                    <em>{pptxReport.warnings.length - 7} more warnings in the console.</em>
                  ) : null}
                </div>
              ) : (
                <p className="pptx-report-status">No export warnings.</p>
              )}
            </>
          ) : null}
        </section>
      ) : null}

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
