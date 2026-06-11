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

  [contenteditable="true"] {
    cursor: text !important;
  }
`;

const EDITOR_SCRIPT = String.raw`
(() => {
  const NONE = "__wysiwyg_none__";
  let mode = "text";
  let idCounter = 1;
  let selectedElement = null;
  let hoveredElement = null;
  let inputTimer = 0;
  let dragState = null;

  function nextId() {
    return "el-" + idCounter++;
  }

  function ensureId(element) {
    if (!element || element.dataset.wysiwygEditor === "true") return "";
    if (!element.dataset.wysiwygId) element.dataset.wysiwygId = nextId();
    return element.dataset.wysiwygId;
  }

  function serialize() {
    return "<!doctype html>\n" + document.documentElement.outerHTML;
  }

  function post(type, payload = {}) {
    window.parent.postMessage({ type, ...payload }, "*");
  }

  function colorToHex(value) {
    if (!value || value === "transparent") return "";
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/i);
    if (!match) return "";
    if (match[4] !== undefined && Number(match[4]) === 0) return "";
    return "#" + [match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("");
  }

  function publishChange(reason = "edit") {
    post("wysiwyg-document-change", { reason, html: serialize() });
    publishSelected();
  }

  function publishSelected() {
    if (!selectedElement) {
      post("wysiwyg-selection", { selected: null });
      return;
    }

    const styles = getComputedStyle(selectedElement);
    const rect = selectedElement.getBoundingClientRect();
    post("wysiwyg-selection", {
      selected: {
        id: ensureId(selectedElement),
        tagName: selectedElement.tagName.toLowerCase(),
        text: selectedElement.textContent || "",
        childElementCount: selectedElement.childElementCount,
        styles: {
          color: colorToHex(styles.color),
          backgroundColor: colorToHex(styles.backgroundColor),
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          textAlign: styles.textAlign,
          padding: styles.padding,
          margin: styles.margin,
          width: Math.round(rect.width) + "px",
          height: Math.round(rect.height) + "px",
          borderRadius: styles.borderRadius
        }
      }
    });
  }

  function restoreContentEditable(element) {
    if (!element) return;
    const original = element.getAttribute("data-wysiwyg-original-contenteditable");
    if (original === null) return;
    if (original === NONE) {
      element.removeAttribute("contenteditable");
    } else {
      element.setAttribute("contenteditable", original);
    }
    element.removeAttribute("data-wysiwyg-original-contenteditable");
  }

  function makeEditable(element) {
    if (!element || element === document.documentElement || element === document.head) return;
    if (!element.hasAttribute("data-wysiwyg-original-contenteditable")) {
      const original = element.hasAttribute("contenteditable")
        ? element.getAttribute("contenteditable") || ""
        : NONE;
      element.setAttribute("data-wysiwyg-original-contenteditable", original);
    }
    element.setAttribute("contenteditable", "true");
    element.focus({ preventScroll: true });
  }

  function pickElement(start) {
    if (!(start instanceof Element)) return null;
    if (start.dataset.wysiwygEditor === "true") return null;
    if (start.closest('[data-wysiwyg-editor="true"]')) return null;
    if (start === document.documentElement || start === document.head) return null;
    return start === document.body ? document.body : start;
  }

  function selectElement(element) {
    if (!element) return;
    ensureId(element);
    if (selectedElement && selectedElement !== element) {
      selectedElement.removeAttribute("data-wysiwyg-selected");
      restoreContentEditable(selectedElement);
    }
    selectedElement = element;
    selectedElement.setAttribute("data-wysiwyg-selected", "true");
    if (mode === "text") makeEditable(selectedElement);
    if (mode !== "text") restoreContentEditable(selectedElement);
    publishSelected();
  }

  function setHover(element) {
    if (hoveredElement && hoveredElement !== selectedElement) {
      hoveredElement.removeAttribute("data-wysiwyg-hover");
    }
    hoveredElement = element;
    if (hoveredElement && hoveredElement !== selectedElement && mode !== "preview") {
      hoveredElement.setAttribute("data-wysiwyg-hover", "true");
    }
  }

  function selectedById(id) {
    if (!id) return selectedElement;
    return document.querySelector('[data-wysiwyg-id="' + CSS.escape(id) + '"]');
  }

  function applyStyles(styles) {
    if (!selectedElement || !styles) return;
    for (const [key, value] of Object.entries(styles)) {
      if (value === null || value === undefined) continue;
      selectedElement.style[key] = String(value);
    }
    publishChange("style");
  }

  function setText(text) {
    if (!selectedElement) return;
    selectedElement.textContent = text;
    publishChange("text");
  }

  function duplicateSelected() {
    if (!selectedElement || !selectedElement.parentElement || selectedElement === document.body) return;
    const clone = selectedElement.cloneNode(true);
    clone.removeAttribute("data-wysiwyg-selected");
    clone.querySelectorAll("[data-wysiwyg-id]").forEach((element) => element.removeAttribute("data-wysiwyg-id"));
    selectedElement.after(clone);
    selectElement(clone);
    publishChange("duplicate");
  }

  function deleteSelected() {
    if (!selectedElement || selectedElement === document.body) return;
    const next = selectedElement.parentElement || document.body;
    selectedElement.remove();
    selectedElement = null;
    selectElement(next);
    publishChange("delete");
  }

  function nudge(dx, dy) {
    if (!selectedElement) return;
    const existing = selectedElement.style.transform || "";
    selectedElement.style.transform = ("translate(" + dx + "px, " + dy + "px) " + existing).trim();
    publishChange("move");
  }

  document.addEventListener("mouseover", (event) => {
    if (mode === "preview") return;
    setHover(pickElement(event.target));
  }, true);

  document.addEventListener("mouseout", () => {
    if (hoveredElement && hoveredElement !== selectedElement) hoveredElement.removeAttribute("data-wysiwyg-hover");
    hoveredElement = null;
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (mode !== "move") return;
    const target = pickElement(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    selectElement(target);
    dragState = {
      element: target,
      startX: event.clientX,
      startY: event.clientY,
      transform: target.style.transform || ""
    };
    target.setPointerCapture?.(event.pointerId);
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!dragState) return;
    event.preventDefault();
    const dx = Math.round(event.clientX - dragState.startX);
    const dy = Math.round(event.clientY - dragState.startY);
    dragState.element.style.transform = ("translate(" + dx + "px, " + dy + "px) " + dragState.transform).trim();
    publishSelected();
  }, true);

  document.addEventListener("pointerup", () => {
    if (!dragState) return;
    dragState = null;
    publishChange("move");
  }, true);

  document.addEventListener("click", (event) => {
    if (mode === "preview") return;
    const target = pickElement(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    selectElement(target);
  }, true);

  document.addEventListener("input", () => {
    window.clearTimeout(inputTimer);
    inputTimer = window.setTimeout(() => publishChange("input"), 250);
  }, true);

  document.addEventListener("blur", () => publishChange("blur"), true);

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type !== "wysiwyg-command") return;

    if (data.command === "set-mode") {
      mode = data.mode || "text";
      if (mode !== "text") restoreContentEditable(selectedElement);
      if (mode === "text" && selectedElement) makeEditable(selectedElement);
      publishSelected();
    }

    if (data.command === "select" && data.id) {
      const element = selectedById(data.id);
      if (element) selectElement(element);
    }

    if (data.command === "apply-style") applyStyles(data.styles);
    if (data.command === "set-text") setText(data.text || "");
    if (data.command === "duplicate") duplicateSelected();
    if (data.command === "delete") deleteSelected();
    if (data.command === "nudge") nudge(Number(data.dx || 0), Number(data.dy || 0));
    if (data.command === "request-html") publishChange("request");
  });

  post("wysiwyg-ready", {
    title: document.title || "",
    bodyTextStart: (document.body ? document.body.textContent || "" : "").trim().slice(0, 180)
  });
})();
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
  doc.querySelectorAll("[data-wysiwyg-editor='true']").forEach((element) => element.remove());
  doc.querySelectorAll("[data-wysiwyg-id]").forEach((element) => element.removeAttribute("data-wysiwyg-id"));
  doc.querySelectorAll("[data-wysiwyg-hover]").forEach((element) => element.removeAttribute("data-wysiwyg-hover"));
  doc.querySelectorAll("[data-wysiwyg-selected]").forEach((element) => element.removeAttribute("data-wysiwyg-selected"));
  doc.querySelectorAll("[data-wysiwyg-original-contenteditable]").forEach((element) => {
    const original = element.getAttribute("data-wysiwyg-original-contenteditable");
    if (!original || original === NONE) {
      element.removeAttribute("contenteditable");
    } else {
      element.setAttribute("contenteditable", original);
    }
    element.removeAttribute("data-wysiwyg-original-contenteditable");
  });
}

function editorStyleTag() {
  return `<style data-wysiwyg-editor="true">${EDITOR_STYLE}</style>`;
}

function editorScriptTag() {
  return `<script data-wysiwyg-editor="true">${EDITOR_SCRIPT}</script>`;
}

function injectEditorBridge(html: string): string {
  let nextHtml = normalizeHtmlInput(html);
  const style = editorStyleTag();
  const script = editorScriptTag();

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

export function cleanEditorHtml(html: string): string {
  const doc = parseDocument(html);
  ensureDocumentShape(doc);
  removeEditorArtifacts(doc);
  restoreUserScripts(doc);
  restoreInlineHandlers(doc);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
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

  const style = doc.createElement("style");
  style.dataset.wysiwygEditor = "true";
  style.textContent = EDITOR_STYLE;
  doc.head.append(style);

  const script = doc.createElement("script");
  script.dataset.wysiwygEditor = "true";
  script.textContent = EDITOR_SCRIPT;
  doc.body.append(script);

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
