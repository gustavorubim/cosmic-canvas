import {
  canDirectlyEditTextElement,
  collectDeckSlides,
  deckSlideSelector,
  editableTextTarget,
  elementDescriptorText,
  inTypingContextForElement,
  classSignature,
  hasDeckContainerHint,
  hasNonSlideChromeHint,
  hasRepeatedSiblingShape,
  hasSlideItemHint,
  hasTokenMatch,
  inferStructuralDeckSlides,
  installEditorBridge,
  installKeyboardFence,
  isRevealStackElement,
  isSlidePartElement,
  structuralSlideScore,
  styleLooksPaged,
} from "./bridge/editorBridge";

const NONE = "__wysiwyg_none__";

export const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quarterly Product Review</title>
    <style>
      :root {
        color: #1f2933;
        background: #f6f7f9;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f7f9;
      }

      main {
        width: min(960px, calc(100vw - 48px));
        background: #ffffff;
        border: 1px solid #d7dde5;
        border-radius: 8px;
        box-shadow: 0 24px 70px rgba(31, 41, 51, 0.16);
        padding: 56px;
      }

      .eyebrow {
        color: #0f766e;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1 {
        max-width: 760px;
        font-size: clamp(42px, 8vw, 82px);
        line-height: 0.94;
        margin: 14px 0 18px;
      }

      .summary {
        max-width: 690px;
        color: #52606d;
        font-size: 20px;
        line-height: 1.55;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-top: 44px;
      }

      .metric {
        border: 1px solid #d7dde5;
        border-radius: 8px;
        padding: 20px;
      }

      .metric strong {
        display: block;
        color: #d97706;
        font-size: 34px;
        margin-bottom: 8px;
      }

      .metric span {
        color: #52606d;
      }

      @media (max-width: 760px) {
        main {
          width: calc(100vw - 28px);
          padding: 30px;
        }

        .metrics {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Quarterly product review</p>
      <h1>Launch readiness for the analytics workspace</h1>
      <p class="summary">
        The core reporting workflow is stable, but the onboarding path needs sharper examples and less setup friction before wider rollout.
      </p>
      <section class="metrics">
        <div class="metric">
          <strong>42%</strong>
          <span>Faster report creation in the pilot group</span>
        </div>
        <div class="metric">
          <strong>18</strong>
          <span>Teams queued for early access</span>
        </div>
        <div class="metric">
          <strong>3</strong>
          <span>Open blockers before launch approval</span>
        </div>
      </section>
    </main>
  </body>
</html>`;

const EDITOR_STYLE = `
  [data-wysiwyg-hover="true"] {
    outline: 2px dashed #0f766e !important;
    outline-offset: 3px !important;
  }

  [data-wysiwyg-selected="true"] {
    outline: 3px solid #d97706 !important;
    outline-offset: 4px !important;
  }

  [data-wysiwyg-editing="true"] {
    outline: 3px solid #0ea5e9 !important;
    outline-offset: 4px !important;
  }

  [contenteditable="true"] {
    cursor: text !important;
  }

  [data-wysiwyg-current-slide="true"] {
    box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.28) !important;
  }

  [data-cosmic-image-error="true"] {
    outline: 3px solid #cf513d !important;
    outline-offset: 3px !important;
    box-shadow: 0 0 0 6px rgba(207, 81, 61, 0.18) !important;
  }

  html[data-wysiwyg-mode="select"] body,
  html[data-wysiwyg-mode="select"] body * {
    cursor: default !important;
  }

  html[data-wysiwyg-mode="move"] body,
  html[data-wysiwyg-mode="move"] body * {
    cursor: grab !important;
  }

  .wysiwyg-chip {
    position: absolute;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px 3px 9px;
    border-radius: 7px;
    background: #1f2933;
    color: #ffffff;
    font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 6px 18px rgba(31, 41, 51, 0.35);
    cursor: default !important;
  }

  .wysiwyg-chip > span {
    margin-right: 5px;
    letter-spacing: 0;
  }

  .wysiwyg-chip button {
    width: 21px;
    height: 21px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #cbd2d9;
    font-size: 12px;
    line-height: 1;
    cursor: pointer !important;
  }

  .wysiwyg-chip button:hover {
    background: #323f4b;
    color: #ffffff;
  }

  .wysiwyg-chip button.danger:hover {
    background: #7f2a1d;
  }

  .wysiwyg-resize-handle {
    position: absolute;
    z-index: 2147483647;
    width: 15px;
    height: 15px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 2px solid #ffffff;
    border-radius: 4px;
    background: #d97706;
    box-shadow: 0 3px 10px rgba(31, 41, 51, 0.28);
    cursor: nwse-resize !important;
  }

  .wysiwyg-resize-handle::after {
    content: "";
    width: 5px;
    height: 5px;
    border-right: 1px solid rgba(255, 255, 255, 0.86);
    border-bottom: 1px solid rgba(255, 255, 255, 0.86);
  }

  .wysiwyg-snap-guide {
    position: absolute;
    z-index: 2147483646;
    pointer-events: none;
    background: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16);
  }

  .wysiwyg-snap-guide-vertical {
    width: 2px;
  }

  .wysiwyg-snap-guide-horizontal {
    height: 2px;
  }
`;

function parseDocument(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(normalizeHtmlInput(html), "text/html");
}

export function normalizeHtmlInput(html: string): string {
  const trimmed = html.trim();
  const looksComplete = /<!doctype|<html[\s>]/i.test(trimmed);
  return looksComplete
    ? trimmed
    : `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body>${trimmed}</body></html>`;
}

function ensureDocumentShape(doc: Document) {
  if (!doc.documentElement) {
    const html = doc.createElement("html");
    doc.appendChild(html);
  }
  if (!doc.head) doc.documentElement.appendChild(doc.createElement("head"));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"));
  if (!doc.querySelector("meta[charset]")) {
    const meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    doc.head.prepend(meta);
  }
  if (!doc.querySelector('meta[name="viewport"]')) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", "width=device-width, initial-scale=1");
    doc.head.append(meta);
  }
}

function makeUserScriptsInert(doc: Document) {
  doc.querySelectorAll("script").forEach((script) => {
    if (script.dataset.wysiwygEditor === "true") return;
    const originalType = script.hasAttribute("type") ? script.getAttribute("type") || "" : NONE;
    script.setAttribute("data-wysiwyg-preserved-script", "true");
    script.setAttribute("data-wysiwyg-original-type", originalType);
    script.setAttribute("type", "text/plain");
  });
}

function makeInlineHandlersInert(doc: Document) {
  doc.querySelectorAll("*").forEach((element) => {
    const handlers: Record<string, string> = {};
    Array.from(element.attributes).forEach((attribute) => {
      if (!/^on/i.test(attribute.name)) return;
      handlers[attribute.name] = attribute.value;
      element.removeAttribute(attribute.name);
    });
    if (Object.keys(handlers).length > 0) {
      element.setAttribute("data-wysiwyg-original-events", JSON.stringify(handlers));
    }
  });
}

function restoreUserScripts(doc: Document) {
  doc.querySelectorAll("script[data-wysiwyg-preserved-script]").forEach((script) => {
    const originalType = script.getAttribute("data-wysiwyg-original-type");
    script.removeAttribute("data-wysiwyg-preserved-script");
    script.removeAttribute("data-wysiwyg-original-type");
    if (!originalType || originalType === NONE) {
      script.removeAttribute("type");
    } else {
      script.setAttribute("type", originalType);
    }
  });
}

function restoreInlineHandlers(doc: Document) {
  doc.querySelectorAll("[data-wysiwyg-original-events]").forEach((element) => {
    const rawEvents = element.getAttribute("data-wysiwyg-original-events");
    element.removeAttribute("data-wysiwyg-original-events");
    if (!rawEvents) return;
    try {
      const handlers = JSON.parse(rawEvents) as Record<string, string>;
      Object.entries(handlers).forEach(([name, value]) => element.setAttribute(name, value));
    } catch {
      // Leave malformed editor metadata out of the exported document.
    }
  });
}

function removeEditorArtifacts(doc: Document) {
  doc.querySelectorAll("mark[data-wysiwyg-find]").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
  doc.querySelectorAll("[data-wysiwyg-editor='true']").forEach((element) => element.remove());
  doc.querySelectorAll("[data-wysiwyg-id]").forEach((element) => element.removeAttribute("data-wysiwyg-id"));
  doc.querySelectorAll("[data-wysiwyg-hover]").forEach((element) => element.removeAttribute("data-wysiwyg-hover"));
  doc.querySelectorAll("[data-wysiwyg-selected]").forEach((element) => element.removeAttribute("data-wysiwyg-selected"));
  doc.querySelectorAll("[data-wysiwyg-editing]").forEach((element) => element.removeAttribute("data-wysiwyg-editing"));
  doc.querySelectorAll("[data-cosmic-image-error]").forEach((element) =>
    element.removeAttribute("data-cosmic-image-error"),
  );
  doc.querySelectorAll("[data-wysiwyg-current-slide]").forEach((element) =>
    element.removeAttribute("data-wysiwyg-current-slide"),
  );
  doc.querySelectorAll("[data-wysiwyg-original-contenteditable]").forEach((element) => {
    const original = element.getAttribute("data-wysiwyg-original-contenteditable");
    if (!original || original === NONE) {
      element.removeAttribute("contenteditable");
    } else {
      element.setAttribute("contenteditable", original);
    }
    element.removeAttribute("data-wysiwyg-original-contenteditable");
  });
  doc.querySelectorAll("[data-wysiwyg-original-spellcheck]").forEach((element) => {
    const original = element.getAttribute("data-wysiwyg-original-spellcheck");
    if (!original || original === NONE) {
      element.removeAttribute("spellcheck");
    } else {
      element.setAttribute("spellcheck", original);
    }
    element.removeAttribute("data-wysiwyg-original-spellcheck");
  });
}

/**
 * Final safety net: strip any remaining editor-only `data-wysiwyg-*` attributes
 * (selection ids, drag transform bookkeeping, etc.). Runs after the dedicated
 * restore passes have already consumed the attributes they need.
 */
function sweepEditorAttributes(doc: Document) {
  doc.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.startsWith("data-wysiwyg-")) {
        element.removeAttribute(attribute.name);
      }
    });
  });
}

const RAW_TEXT_TAGS = new Set(["pre", "script", "style", "textarea"]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em",
  "i", "img", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp", "small",
  "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "button", "input",
  "label", "select", "textarea",
]);

function openTagOf(element: Element): string {
  const clone = element.cloneNode(false) as Element;
  const html = clone.outerHTML;
  const tag = element.tagName.toLowerCase();
  if (VOID_TAGS.has(tag)) return html;
  const suffix = `</${tag}>`;
  return html.endsWith(suffix) ? html.slice(0, -suffix.length) : html;
}

/**
 * Block-format an element only when it is a pure structural container (element
 * children, no significant inline text, no inline-level children). Text-bearing
 * and inline elements are emitted verbatim so whitespace-sensitive content is
 * never reflowed.
 */
function shouldBlockFormat(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (RAW_TEXT_TAGS.has(tag) || INLINE_TAGS.has(tag) || VOID_TAGS.has(tag)) return false;
  if (element.children.length === 0) return false;
  const hasSignificantText = Array.from(element.childNodes).some(
    (node) => node.nodeType === 3 && (node.textContent || "").trim() !== "",
  );
  if (hasSignificantText) return false;
  return Array.from(element.children).every(
    (child) => !INLINE_TAGS.has(child.tagName.toLowerCase()),
  );
}

function prettyElement(element: Element, depth: number, lines: string[]) {
  const pad = "  ".repeat(depth);
  const tag = element.tagName.toLowerCase();

  if (VOID_TAGS.has(tag)) {
    lines.push(pad + openTagOf(element));
    return;
  }

  if (!shouldBlockFormat(element)) {
    element.outerHTML.split("\n").forEach((line) => lines.push(pad + line));
    return;
  }

  lines.push(pad + openTagOf(element));
  element.childNodes.forEach((node) => {
    if (node.nodeType === 1) {
      prettyElement(node as Element, depth + 1, lines);
    } else if (node.nodeType === 8) {
      lines.push("  ".repeat(depth + 1) + `<!--${(node as Comment).data}-->`);
    }
  });
  lines.push(pad + `</${tag}>`);
}

function prettyPrintDocument(doc: Document): string {
  const lines: string[] = [];
  prettyElement(doc.documentElement, 0, lines);
  return `<!doctype html>\n${lines.join("\n")}\n`;
}

function editorStyleTag() {
  return `<style data-wysiwyg-editor="true">${EDITOR_STYLE}</style>`;
}

function scriptSource(fn: (...args: any[]) => unknown) {
  return fn.toString();
}

function bridgeHelperSource() {
  return [
    `const NONE = ${JSON.stringify(NONE)};`,
    inTypingContextForElement.toString(),
    canDirectlyEditTextElement.toString(),
    editableTextTarget.toString(),
    deckSlideSelectorListSource(),
    deckSlideSelector.toString(),
    isRevealStackElement.toString(),
    isSlidePartElement.toString(),
    elementDescriptorText.toString(),
    hasTokenMatch.toString(),
    hasDeckContainerHint.toString(),
    hasSlideItemHint.toString(),
    hasNonSlideChromeHint.toString(),
    styleLooksPaged.toString(),
    structuralSlideScore.toString(),
    classSignature.toString(),
    hasRepeatedSiblingShape.toString(),
    inferStructuralDeckSlides.toString(),
    collectDeckSlides.toString(),
  ].join("\n");
}

function deckSlideSelectorListSource() {
  return `function deckSlideSelectorList() { return ${JSON.stringify(deckSlideSelector().split(", "))}; }`;
}

function keyboardFenceScriptTag() {
  const source = `(() => {\n${bridgeHelperSource()}\n(${scriptSource(installKeyboardFence)})(window);\n})();`;
  return `<script data-wysiwyg-editor="true">${source}</script>`;
}

function editorScriptTag() {
  const source = `(() => {\n${bridgeHelperSource()}\n(${scriptSource(installEditorBridge)})(window);\n})();`;
  return `<script data-wysiwyg-editor="true">${source}</script>`;
}

function injectEditorBridge(html: string): string {
  let nextHtml = normalizeHtmlInput(html);
  const fence = keyboardFenceScriptTag();
  const style = editorStyleTag();
  const script = editorScriptTag();

  if (/<head(?:\s[^>]*)?>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${fence}`);
  } else if (/<html(?:\s[^>]*)?>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${fence}</head>`);
  } else {
    nextHtml = `${fence}${nextHtml}`;
  }

  if (/<\/head\s*>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<\/head\s*>/i, `${style}</head>`);
  } else {
    nextHtml = `${style}${nextHtml}`;
  }

  if (/<\/body\s*>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<\/body\s*>/i, `${script}</body>`);
  } else {
    nextHtml = `${nextHtml}${script}`;
  }

  return nextHtml;
}

export type CleanOptions = {
  /** Re-indent structural markup for readability. Off by default — it may adjust
   *  insignificant whitespace between block elements. */
  pretty?: boolean;
};

type FetchLike = (input: RequestInfo | URL) => Promise<Response>;

const PRINT_SLIDE_SELECTOR = deckSlideSelector();
const PRINT_LAST_SLIDE_SELECTOR = PRINT_SLIDE_SELECTOR.split(", ")
  .map((selector) => `${selector}:last-child`)
  .join(",\n  ");

const PRINT_EXPORT_STYLE = `
@media print {
  body {
    margin: 0;
    background: #ffffff !important;
  }

  ${PRINT_SLIDE_SELECTOR} {
    min-height: 100vh;
    page-break-after: always;
    break-after: page;
    box-shadow: none !important;
  }

  ${PRINT_LAST_SLIDE_SELECTOR} {
    page-break-after: auto;
    break-after: auto;
  }
}

@page {
  size: landscape;
  margin: 0;
}
`;

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const EMPTY_NORMALIZE_TAGS = new Set(["p", "span", "div", "li", "strong", "em", "b", "i", "u", "small", "mark"]);

function deckSlides(doc: Document) {
  return collectDeckSlides(doc);
}

function renameElement(doc: Document, element: Element, tagName: string) {
  if (element.tagName.toLowerCase() === tagName) return element;
  const next = doc.createElement(tagName);
  Array.from(element.attributes).forEach((attribute) => next.setAttribute(attribute.name, attribute.value));
  while (element.firstChild) next.append(element.firstChild);
  element.replaceWith(next);
  return next;
}

function normalizeSlideHeadings(doc: Document) {
  deckSlides(doc).forEach((slide) => {
    const headings = Array.from(slide.querySelectorAll(HEADING_SELECTOR));
    headings.forEach((heading, index) => {
      renameElement(doc, heading, index === 0 ? "h2" : "h3");
    });
  });
}

function hasRawTextAncestor(node: Node) {
  const parent = node.parentElement;
  return Boolean(parent?.closest(Array.from(RAW_TEXT_TAGS).join(",")));
}

function normalizeTextNodes(root: Element) {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, showText);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  nodes.forEach((textNode) => {
    if (hasRawTextAncestor(textNode)) return;
    const original = textNode.textContent || "";
    const trimmed = original.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      textNode.remove();
      return;
    }
    const prefix = /^\s/.test(original) && textNode.previousSibling ? " " : "";
    const suffix = /\s$/.test(original) && textNode.nextSibling ? " " : "";
    textNode.textContent = `${prefix}${trimmed}${suffix}`;
  });
}

function removeEmptyNormalizeNodes(root: Element) {
  let removed = true;
  while (removed) {
    removed = false;
    Array.from(root.querySelectorAll(Array.from(EMPTY_NORMALIZE_TAGS).join(",")))
      .reverse()
      .forEach((element) => {
        if (element.attributes.length > 0) return;
        if (element.children.length > 0) return;
        if ((element.textContent || "").trim() !== "") return;
        element.remove();
        removed = true;
      });
  }
}

export function cleanEditorHtml(html: string, options: CleanOptions = {}): string {
  const doc = parseDocument(html);
  ensureDocumentShape(doc);
  removeEditorArtifacts(doc);
  restoreUserScripts(doc);
  restoreInlineHandlers(doc);
  sweepEditorAttributes(doc);
  if (options.pretty) return prettyPrintDocument(doc);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function createSelfContainedHtml(
  html: string,
  fetcher: FetchLike = fetch,
  baseUrl = typeof window === "undefined" ? "http://localhost/" : window.location.href,
) {
  const doc = parseDocument(cleanEditorHtml(html));
  const failures: string[] = [];
  const images = Array.from(doc.querySelectorAll("img[src]"));

  for (const image of images) {
    const src = image.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) continue;
    try {
      const url = new URL(src, baseUrl).toString();
      const response = await fetcher(url);
      if (!response.ok) throw new Error(String(response.status));
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const data = arrayBufferToBase64(await response.arrayBuffer());
      image.setAttribute("src", `data:${contentType};base64,${data}`);
    } catch {
      failures.push(src);
    }
  }

  return {
    html: `<!doctype html>\n${doc.documentElement.outerHTML}`,
    failures,
  };
}

export function createPrintHtml(html: string) {
  const doc = parseDocument(cleanEditorHtml(html));
  ensureDocumentShape(doc);
  const style = doc.createElement("style");
  style.setAttribute("data-cosmic-print-export", "true");
  style.textContent = PRINT_EXPORT_STYLE;
  doc.head.append(style);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function normalizeDeckHtml(html: string) {
  const doc = parseDocument(cleanEditorHtml(html));
  ensureDocumentShape(doc);
  normalizeSlideHeadings(doc);
  normalizeTextNodes(doc.body);
  removeEmptyNormalizeNodes(doc.body);
  return prettyPrintDocument(doc);
}

export function prepareEditableHtml(html: string, runTrustedScripts = false): string {
  if (runTrustedScripts) {
    return injectEditorBridge(html);
  }

  const doc = parseDocument(html);
  ensureDocumentShape(doc);
  removeEditorArtifacts(doc);
  makeUserScriptsInert(doc);
  makeInlineHandlersInert(doc);

  const fenceScript = doc.createElement("script");
  fenceScript.dataset.wysiwygEditor = "true";
  fenceScript.textContent = `(() => {\n${bridgeHelperSource()}\n(${scriptSource(installKeyboardFence)})(window);\n})();`;
  doc.head.prepend(fenceScript);

  const style = doc.createElement("style");
  style.dataset.wysiwygEditor = "true";
  style.textContent = EDITOR_STYLE;
  doc.head.append(style);

  const script = doc.createElement("script");
  script.dataset.wysiwygEditor = "true";
  script.textContent = `(() => {\n${bridgeHelperSource()}\n(${scriptSource(installEditorBridge)})(window);\n})();`;
  doc.body.append(script);

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
