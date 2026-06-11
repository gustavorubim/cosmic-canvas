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

  [data-wysiwyg-current-slide="true"] {
    box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.28) !important;
  }
`;

const EDITOR_SCRIPT = String.raw`
(() => {
  const NONE = "__wysiwyg_none__";
  const SLIDE_SELECTOR = "section.slide, article.slide, section[data-title], section[data-section], [data-slide], [data-slide-id]";
  let mode = "text";
  let idCounter = 1;
  let selectedElement = null;
  let hoveredElement = null;
  let inputTimer = 0;
  let deckTimer = 0;
  let activeSlideId = "";
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

  function slideCandidates() {
    const selectors = [
      "section.slide",
      "article.slide",
      "section[data-title]",
      "section[data-section]",
      "[data-slide]",
      "[data-slide-id]"
    ];
    const seen = new Set();
    const slides = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof Element)) return;
        if (element.dataset.wysiwygEditor === "true") return;
        if (element.closest('[data-wysiwyg-editor="true"]')) return;
        if (seen.has(element)) return;
        seen.add(element);
        slides.push(element);
      });
    }
    return slides;
  }

  function textFrom(element, selector) {
    const target = element.querySelector(selector);
    return target ? (target.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function slideTitle(element, index) {
    return (
      element.getAttribute("data-title") ||
      element.getAttribute("data-section") ||
      element.getAttribute("aria-label") ||
      textFrom(element, "h1") ||
      textFrom(element, "h2") ||
      textFrom(element, "h3") ||
      "Slide " + (index + 1)
    ).slice(0, 80);
  }

  function visibleArea(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function nearestSlide(slides) {
    if (!slides.length) return null;
    const selectedSlide = selectedElement ? selectedElement.closest(SLIDE_SELECTOR) : null;
    if (selectedSlide && slides.includes(selectedSlide)) return selectedSlide;
    const activeById = activeSlideId ? document.querySelector('[data-wysiwyg-id="' + CSS.escape(activeSlideId) + '"]') : null;
    if (activeById && slides.includes(activeById)) return activeById;
    return slides
      .map((slide) => ({ slide, area: visibleArea(slide) }))
      .sort((a, b) => b.area - a.area)[0]?.slide || slides[0];
  }

  function markActiveSlide(slide) {
    document.querySelectorAll("[data-wysiwyg-current-slide]").forEach((element) => {
      element.removeAttribute("data-wysiwyg-current-slide");
    });
    if (!slide) return;
    activeSlideId = ensureId(slide);
    slide.setAttribute("data-wysiwyg-current-slide", "true");
  }

  function publishDeck() {
    const slides = slideCandidates();
    if (!slides.length) {
      post("wysiwyg-deck", { slides: [], activeId: "" });
      return;
    }
    const activeSlide = nearestSlide(slides);
    markActiveSlide(activeSlide);
    post("wysiwyg-deck", {
      activeId: activeSlide ? activeSlide.dataset.wysiwygId : "",
      slides: slides.map((slide, index) => ({
        id: ensureId(slide),
        index,
        title: slideTitle(slide, index),
        section: slide.getAttribute("data-section") || slide.getAttribute("data-title") || ""
      }))
    });
  }

  function scheduleDeckPublish() {
    window.clearTimeout(deckTimer);
    deckTimer = window.setTimeout(publishDeck, 120);
  }

  function publishChange(reason = "edit") {
    post("wysiwyg-document-change", { reason, html: serialize() });
    publishSelected();
    scheduleDeckPublish();
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
    const selectedSlide = selectedElement.closest(SLIDE_SELECTOR);
    if (selectedSlide) activeSlideId = ensureId(selectedSlide);
    if (mode === "text") makeEditable(selectedElement);
    if (mode !== "text") restoreContentEditable(selectedElement);
    publishSelected();
    scheduleDeckPublish();
  }

  function clearSelection() {
    if (!selectedElement) return;
    selectedElement.removeAttribute("data-wysiwyg-selected");
    restoreContentEditable(selectedElement);
    selectedElement = null;
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

  function goToSlide(payload) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : slides[Number(payload?.index || 0)];
    if (!slide) return;
    clearSelection();
    markActiveSlide(slide);
    slide.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishDeck();
  }

  function clearEditorState(element) {
    element.removeAttribute("data-wysiwyg-current-slide");
    element.removeAttribute("data-wysiwyg-selected");
    element.removeAttribute("data-wysiwyg-hover");
    element.removeAttribute("data-wysiwyg-id");
    element.querySelectorAll("[data-wysiwyg-id], [data-wysiwyg-selected], [data-wysiwyg-hover], [data-wysiwyg-current-slide]").forEach((child) => {
      child.removeAttribute("data-wysiwyg-current-slide");
      child.removeAttribute("data-wysiwyg-selected");
      child.removeAttribute("data-wysiwyg-hover");
      child.removeAttribute("data-wysiwyg-id");
    });
  }

  function replaceFirstText(element, selector, text) {
    const target = element.querySelector(selector);
    if (!target) return false;
    target.textContent = text;
    return true;
  }

  function prepareNewSlide(slide) {
    clearEditorState(slide);
    slide.setAttribute("data-title", "New slide");
    if (slide.classList.length === 0) slide.classList.add("slide");
    if (!replaceFirstText(slide, "h1, h2, h3", "New slide")) {
      const heading = document.createElement("h2");
      heading.textContent = "New slide";
      slide.prepend(heading);
    }
    if (!replaceFirstText(slide, "p", "Add your main point here.")) {
      const paragraph = document.createElement("p");
      paragraph.textContent = "Add your main point here.";
      slide.append(paragraph);
    }
  }

  function duplicateSlide(payload) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : nearestSlide(slides);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(true);
    clearEditorState(clone);
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("duplicate-slide");
  }

  function insertSlide(payload) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : nearestSlide(slides);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(true);
    prepareNewSlide(clone);
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-slide");
  }

  function ensureDataTableStyle() {
    if (document.getElementById("cosmic-canvas-data-style")) return;
    const style = document.createElement("style");
    style.id = "cosmic-canvas-data-style";
    style.textContent = [
      ".cosmic-data-block{width:100%;margin:24px 0;color:#1f2933;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
      ".cosmic-data-block figcaption{margin:0 0 10px;color:#0f766e;font-size:14px;font-weight:800;letter-spacing:0;}",
      ".cosmic-data-table{width:100%;border:1px solid #d7dde5;border-collapse:separate;border-spacing:0;border-radius:8px;overflow:hidden;background:#fff;font-size:14px;box-shadow:0 12px 30px rgba(31,41,51,.08);}",
      ".cosmic-data-table th,.cosmic-data-table td{padding:11px 13px;border-bottom:1px solid #e5e9ee;text-align:left;vertical-align:top;}",
      ".cosmic-data-table th{color:#26323f;background:#eef8f6;font-weight:800;}",
      ".cosmic-data-table tr:last-child td{border-bottom:0;}"
    ].join("");
    document.head.append(style);
  }

  function textValue(value) {
    return String(value ?? "").trim();
  }

  function payloadCells(values) {
    return Array.isArray(values) ? values.map((value) => textValue(value)) : [];
  }

  function appendCell(row, tagName, text) {
    const cell = document.createElement(tagName);
    cell.textContent = text;
    row.append(cell);
  }

  function dataInsertionPoint() {
    const slide = nearestSlide(slideCandidates());
    if (slide) return { element: slide, placement: "append" };
    if (selectedElement && selectedElement !== document.body && selectedElement.parentElement) {
      return { element: selectedElement, placement: "after" };
    }
    return { element: document.body, placement: "append" };
  }

  function insertDataTable(payload) {
    let columns = payloadCells(payload?.columns);
    const rows = Array.isArray(payload?.rows)
      ? payload.rows.map((row) => payloadCells(row)).filter((row) => row.some((cell) => cell !== ""))
      : [];
    if (!columns.length || !rows.length) return;
    columns = columns.map((column, index) => column || "Column " + (index + 1));

    ensureDataTableStyle();

    const figure = document.createElement("figure");
    figure.className = "cosmic-data-block";
    figure.setAttribute("data-cosmic-artifact", "data-table");

    const title = textValue(payload?.title);
    if (title) {
      const caption = document.createElement("figcaption");
      caption.textContent = title;
      figure.append(caption);
    }

    const table = document.createElement("table");
    table.className = "cosmic-data-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    columns.forEach((column) => appendCell(headerRow, "th", column));
    thead.append(headerRow);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      columns.forEach((_, index) => appendCell(tableRow, "td", row[index] || ""));
      tbody.append(tableRow);
    });

    table.append(thead, tbody);
    figure.append(table);

    const insertion = dataInsertionPoint();
    if (insertion.placement === "after") {
      insertion.element.after(figure);
    } else {
      insertion.element.append(figure);
    }

    selectElement(figure);
    figure.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-table");
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
    if (data.command === "duplicate-slide") duplicateSlide(data);
    if (data.command === "insert-slide") insertSlide(data);
    if (data.command === "insert-table") insertDataTable(data);
    if (data.command === "delete") deleteSelected();
    if (data.command === "go-slide") goToSlide(data);
    if (data.command === "nudge") nudge(Number(data.dx || 0), Number(data.dy || 0));
    if (data.command === "request-html") publishChange("request");
  });

  window.addEventListener("scroll", scheduleDeckPublish, true);
  window.addEventListener("resize", scheduleDeckPublish);

  post("wysiwyg-ready", {
    title: document.title || "",
    bodyTextStart: (document.body ? document.body.textContent || "" : "").trim().slice(0, 180)
  });
  publishDeck();
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
