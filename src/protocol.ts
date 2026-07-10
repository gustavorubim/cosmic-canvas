/**
 * Typed contract for the postMessage bridge between the React app shell and the
 * editable iframe. The bridge script in `htmlDocument.ts` is a stringified IIFE
 * and cannot import these types at runtime, but it is implemented against this
 * same shape — keep the two in sync when adding commands or message fields.
 */

export type EditorMode = "text" | "select" | "move" | "preview";
export type Viewport = "desktop" | "tablet" | "mobile";
export type InlineFormatAction = "bold" | "italic" | "create-link" | "remove-link" | "toggle-list";
export type SlideTemplateKind =
  | "title"
  | "section"
  | "quote"
  | "image-text"
  | "metrics"
  | "agenda"
  | "closing";
export type LayoutAction = "align-left" | "align-center" | "align-right" | "distribute-horizontal";
export type ImageFitMode = "fit" | "fill" | "crop";
export type ChartType = "bar" | "line" | "pie";
export type ZOrderAction = "bring-forward" | "send-backward" | "bring-to-front" | "send-to-back";

/** A single hop in the selected element's ancestor breadcrumb (root → element). */
export type BreadcrumbNode = {
  id: string;
  label: string;
};

export type SelectedElement = {
  id: string;
  domId: string;
  tagName: string;
  text: string;
  childElementCount: number;
  /** True when the element renders text directly (safe to edit via the Text field). */
  editableText: boolean;
  editing?: boolean;
  classes: string[];
  ancestors: BreadcrumbNode[];
  sourcePath?: number[];
  isImage: boolean;
  imageSrc: string;
  imageAlt: string;
  imageFit: ImageFitMode | "";
  canHaveBackground: boolean;
  backgroundImage: string;
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

export type DeckSlide = {
  id: string;
  index: number;
  title: string;
  section: string;
  thumbnailHtml: string;
};

export type LayerItem = {
  id: string;
  label: string;
  active: boolean;
  zIndex: string;
};

export type OutlineItem = {
  id: string;
  parentId: string;
  label: string;
  depth: number;
  hasChildren: boolean;
  active: boolean;
  hidden: boolean;
  locked: boolean;
  pickThrough: boolean;
};

export type AuditFinding = {
  id: string;
  elementId: string;
  type: "broken-image" | "missing-alt" | "overflow" | "tiny-font" | "inert-script";
  label: string;
  message: string;
};

/** Messages sent from the iframe bridge up to the app shell. */
import type { DiagnosticEntry } from "./diagnostics";
import { isEditOperation, type EditOperation } from "./editOperations";
import { isBridgeCommand as validateBridgeCommand } from "./bridgeCommandValidation";

export type BridgeMessage = (
  | { type: "wysiwyg-ready"; title: string; bodyTextStart: string }
  | { type: "wysiwyg-selection"; selected: SelectedElement | null }
  | { type: "wysiwyg-deck"; slides: DeckSlide[]; activeId: string }
  | { type: "wysiwyg-deck-preference"; siblingPath: number[] }
  | { type: "wysiwyg-layers"; layers: LayerItem[] }
  | { type: "wysiwyg-outline"; items: OutlineItem[]; truncated: boolean }
  | { type: "wysiwyg-operation"; operation: EditOperation; scrollX: number; scrollY: number }
  | { type: "wysiwyg-audit"; findings: AuditFinding[] }
  | { type: "wysiwyg-find"; query: string; count: number }
  | { type: "wysiwyg-diagnostic"; diagnostic: DiagnosticEntry }
  | { type: "wysiwyg-shortcut"; action: "save" | "apply-source" | "undo" | "redo" }
  | {
      type: "wysiwyg-document-change";
      reason: string;
      html: string;
      scrollX: number;
      scrollY: number;
    }
) & { sessionToken?: string };

/** Commands sent from the app shell down to the iframe bridge. */
export type BridgeCommand =
  | { command: "set-mode"; mode: EditorMode }
  | { command: "set-force-timeline"; enabled: boolean }
  | { command: "set-deck-selector"; selector: string }
  | { command: "set-deck-from-selection"; siblingPath?: number[] }
  | { command: "set-deck-marked"; paths: number[][] }
  | { command: "clear-deck-override" }
  | { command: "set-outline-hidden"; id: string; enabled: boolean }
  | { command: "set-outline-locked"; id: string; enabled: boolean }
  | { command: "set-picking-ignored"; id: string; enabled: boolean }
  | { command: "select"; id: string }
  | { command: "select-parent" }
  | { command: "apply-style"; styles: Record<string, string> }
  | { command: "set-text"; text: string }
  | { command: "set-class"; className: string; action: "add" | "remove" | "toggle" }
  | { command: "replace-image"; src: string; alt?: string }
  | { command: "set-image-fit"; fit: ImageFitMode }
  | { command: "replace-background"; src: string }
  | { command: "set-theme-font"; fontFamily: string }
  | { command: "swap-theme-color"; from: string; to: string }
  | { command: "set-slide-background"; color: string }
  | { command: "find-text"; query: string }
  | { command: "replace-text"; query: string; replacement: string }
  | { command: "z-order"; action: ZOrderAction }
  | { command: "duplicate" }
  | { command: "delete" }
  | { command: "duplicate-slide"; id: string }
  | { command: "insert-slide"; id: string }
  | { command: "insert-slide-template"; id: string; template: SlideTemplateKind }
  | { command: "rename-slide"; id: string; title: string }
  | { command: "delete-slide"; id: string }
  | { command: "move-slide"; id: string; offset: number }
  | { command: "insert-element"; kind: "heading" | "paragraph" | "image" | "button" | "box" }
  | {
      command: "format-inline";
      action: InlineFormatAction;
      href?: string;
    }
  | { command: "insert-table"; columns: string[]; rows: string[][]; title: string }
  | { command: "insert-chart"; chartType: ChartType; columns: string[]; rows: string[][]; title: string }
  | { command: "go-slide"; id: string }
  | { command: "nudge"; dx: number; dy: number }
  | { command: "layout"; action: LayoutAction }
  | { command: "scroll-to"; x: number; y: number }
  | { command: "request-audit" }
  | { command: "request-html" };

export const BRIDGE_MESSAGE_TYPES = [
  "wysiwyg-ready",
  "wysiwyg-selection",
  "wysiwyg-deck",
  "wysiwyg-deck-preference",
  "wysiwyg-layers",
  "wysiwyg-outline",
  "wysiwyg-operation",
  "wysiwyg-audit",
  "wysiwyg-find",
  "wysiwyg-diagnostic",
  "wysiwyg-shortcut",
  "wysiwyg-document-change",
] as const;

export function isBridgeCommand(data: unknown): data is BridgeCommand & { type: "wysiwyg-command"; sessionToken?: string } {
  return validateBridgeCommand(data);
}

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (!data || typeof data !== "object") return false;
  const message = data as Record<string, unknown>;
  const type = message.type;
  if (typeof type !== "string" || !(BRIDGE_MESSAGE_TYPES as readonly string[]).includes(type)) return false;
  if (message.sessionToken !== undefined && typeof message.sessionToken !== "string") return false;
  const isString = (value: unknown) => typeof value === "string";
  const isFiniteNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);

  if (type === "wysiwyg-ready") return isString(message.title) && isString(message.bodyTextStart);
  if (type === "wysiwyg-selection") {
    if (message.selected === null) return true;
    if (!message.selected || typeof message.selected !== "object") return false;
    const selected = message.selected as Record<string, unknown>;
    return isString(selected.id) && isString(selected.tagName) && Array.isArray(selected.ancestors);
  }
  if (type === "wysiwyg-deck") {
    return isString(message.activeId) && Array.isArray(message.slides) && message.slides.every((slide) => {
      if (!slide || typeof slide !== "object") return false;
      const value = slide as Record<string, unknown>;
      return isString(value.id) && isFiniteNumber(value.index) && isString(value.title) &&
        isString(value.section) && isString(value.thumbnailHtml);
    });
  }
  if (type === "wysiwyg-deck-preference") {
    return Array.isArray(message.siblingPath) && message.siblingPath.every((part) =>
      Number.isInteger(part) && Number(part) >= 0,
    );
  }
  if (type === "wysiwyg-layers") return Array.isArray(message.layers) && message.layers.every((layer) => {
    if (!layer || typeof layer !== "object") return false;
    const value = layer as Record<string, unknown>;
    return isString(value.id) && isString(value.label) && typeof value.active === "boolean" && isString(value.zIndex);
  });
  if (type === "wysiwyg-outline") {
    return typeof message.truncated === "boolean" && Array.isArray(message.items) && message.items.every((item) => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return isString(value.id) && isString(value.parentId) && isString(value.label) &&
        isFiniteNumber(value.depth) && typeof value.hasChildren === "boolean" &&
        typeof value.active === "boolean" && typeof value.hidden === "boolean" &&
        typeof value.locked === "boolean" && typeof value.pickThrough === "boolean";
    });
  }
  if (type === "wysiwyg-operation") {
    return isEditOperation(message.operation) && isFiniteNumber(message.scrollX) && isFiniteNumber(message.scrollY);
  }
  if (type === "wysiwyg-audit") return Array.isArray(message.findings) && message.findings.every((finding) => {
    if (!finding || typeof finding !== "object") return false;
    const value = finding as Record<string, unknown>;
    return isString(value.id) && isString(value.elementId) && isString(value.type) &&
      isString(value.label) && isString(value.message);
  });
  if (type === "wysiwyg-find") return isString(message.query) && isFiniteNumber(message.count);
  if (type === "wysiwyg-diagnostic") {
    if (!message.diagnostic || typeof message.diagnostic !== "object") return false;
    const diagnostic = message.diagnostic as Record<string, unknown>;
    return isString(diagnostic.id) && isString(diagnostic.code) &&
      ["info", "warning", "error"].includes(String(diagnostic.severity)) &&
      isString(diagnostic.title) && isString(diagnostic.message);
  }
  if (type === "wysiwyg-shortcut") {
    return ["save", "apply-source", "undo", "redo"].includes(String(message.action));
  }
  if (type === "wysiwyg-document-change") {
    return isString(message.reason) && isString(message.html) && message.html.length <= 20_000_000 &&
      isFiniteNumber(message.scrollX) && isFiniteNumber(message.scrollY);
  }
  return false;
}
