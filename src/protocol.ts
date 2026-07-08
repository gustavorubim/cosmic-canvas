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

/** A single hop in the selected element's ancestor breadcrumb (root → element). */
export type BreadcrumbNode = {
  id: string;
  label: string;
};

export type SelectedElement = {
  id: string;
  tagName: string;
  text: string;
  childElementCount: number;
  /** True when the element renders text directly (safe to edit via the Text field). */
  editableText: boolean;
  classes: string[];
  ancestors: BreadcrumbNode[];
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
};

export type AuditFinding = {
  id: string;
  elementId: string;
  type: "broken-image" | "missing-alt" | "overflow" | "tiny-font" | "inert-script";
  label: string;
  message: string;
};

/** Messages sent from the iframe bridge up to the app shell. */
export type BridgeMessage =
  | { type: "wysiwyg-ready"; title: string; bodyTextStart: string }
  | { type: "wysiwyg-selection"; selected: SelectedElement | null }
  | { type: "wysiwyg-deck"; slides: DeckSlide[]; activeId: string }
  | { type: "wysiwyg-audit"; findings: AuditFinding[] }
  | { type: "wysiwyg-shortcut"; action: "save" | "apply-source" | "undo" | "redo" }
  | {
      type: "wysiwyg-document-change";
      reason: string;
      html: string;
      scrollX: number;
      scrollY: number;
    };

/** Commands sent from the app shell down to the iframe bridge. */
export type BridgeCommand =
  | { command: "set-mode"; mode: EditorMode }
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
  "wysiwyg-audit",
  "wysiwyg-shortcut",
  "wysiwyg-document-change",
] as const;

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (!data || typeof data !== "object") return false;
  const type = (data as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    (BRIDGE_MESSAGE_TYPES as readonly string[]).includes(type)
  );
}
