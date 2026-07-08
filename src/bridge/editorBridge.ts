type FenceState = {
  mode: string;
};

type EditorKeyContext = {
  typing: boolean;
};

type CosmicWindow = Window &
  typeof globalThis & {
    __cosmicFenceInstalled?: boolean;
    __cosmicFenceState?: FenceState;
    __cosmicHandleEditorKey?: (event: KeyboardEvent, context: EditorKeyContext) => boolean;
  };

const NONE = "__wysiwyg_none__";

export function inTypingContextForElement(active: Element | null): boolean {
  if (!active) return false;
  const view = active.ownerDocument?.defaultView;
  const HTMLElementCtor = view?.HTMLElement;
  const HTMLInputElementCtor = view?.HTMLInputElement;
  if (!HTMLElementCtor || !(active instanceof HTMLElementCtor)) return false;

  if (active.getAttribute("contenteditable") === "false") return false;
  if (active.isContentEditable) return true;

  const editable = active.closest("[contenteditable]");
  if (editable instanceof HTMLElementCtor) {
    if (editable === active && active.contentEditable === "false") return false;
    if (editable.contentEditable !== "false") return true;
  }

  if (active.matches("textarea, select, [role='textbox'], [role='textbox'] *")) {
    return true;
  }

  if (HTMLInputElementCtor && active instanceof HTMLInputElementCtor) {
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(active.type);
  }

  return false;
}

export function canDirectlyEditTextElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (["html", "head", "body", "script", "style", "img", "input", "select", "textarea"].includes(tag)) {
    return false;
  }

  const inlineTags = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "br",
    "cite",
    "code",
    "data",
    "dfn",
    "em",
    "i",
    "kbd",
    "mark",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr",
  ]);

  function allInline(node: Element): boolean {
    return Array.from(node.children).every((child) => {
      const childTag = child.tagName.toLowerCase();
      return inlineTags.has(childTag) && allInline(child);
    });
  }

  return allInline(element);
}

export function installKeyboardFence(win: CosmicWindow = window as CosmicWindow) {
  if (win.__cosmicFenceInstalled) return;
  win.__cosmicFenceInstalled = true;
  win.__cosmicFenceState = win.__cosmicFenceState || { mode: "text" };

  const navigationKeys = new Set([
    " ",
    "Spacebar",
    "Backspace",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ]);
  const editorKeys = new Set([
    "Escape",
    "Delete",
    "Backspace",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ]);

  function eventTargetElement(event: Event): Element | null {
    const target = event.target;
    return target instanceof win.Element ? target : null;
  }

  function shortcutAction(event: KeyboardEvent, typing: boolean) {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return "";
    const key = event.key.toLowerCase();
    if (key === "s") return "save";
    if (event.key === "Enter") return "apply-source";
    if (!typing && key === "z" && !event.shiftKey) return "undo";
    if (!typing && ((key === "z" && event.shiftKey) || key === "y")) return "redo";
    return "";
  }

  function postShortcut(action: string) {
    win.parent?.postMessage({ type: "wysiwyg-shortcut", action }, "*");
  }

  function onKey(event: KeyboardEvent) {
    const state = win.__cosmicFenceState || { mode: "text" };
    const target = eventTargetElement(event);
    const typing =
      inTypingContextForElement(win.document.activeElement) ||
      inTypingContextForElement(target);

    if (event.type === "keydown") {
      const action = shortcutAction(event, typing);
      if (action) {
        event.preventDefault();
        event.stopImmediatePropagation();
        postShortcut(action);
        return;
      }
    }

    if (state.mode === "preview") return;

    if (event.type === "keydown") {
      win.__cosmicHandleEditorKey?.(event, { typing });
    }

    if (typing) {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopImmediatePropagation();
      }
      return;
    }

    if (navigationKeys.has(event.key) || editorKeys.has(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  ["keydown", "keypress", "keyup"].forEach((type) => {
    win.addEventListener(type, onKey as EventListener, true);
  });
}

export function installEditorBridge(win: CosmicWindow = window as CosmicWindow) {
  const document = win.document;
  const SLIDE_SELECTOR =
    "section.slide, article.slide, section[data-title], section[data-section], [data-slide], [data-slide-id], .reveal .slides > section, .reveal .slides > section > section";
  let mode = "text";
  let idCounter = 1;
  let selectedElement: Element | null = null;
  let hoveredElement: Element | null = null;
  let inputTimer = 0;
  let deckTimer = 0;
  let activeSlideId = "";
  let dragState: {
    element: HTMLElement;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null = null;
  let chip: HTMLDivElement | null = null;
  let chipLabel: HTMLSpanElement | null = null;

  const fenceState = win.__cosmicFenceState || (win.__cosmicFenceState = { mode });

  function syncFenceState() {
    fenceState.mode = mode;
  }

  function nextId() {
    return "el-" + idCounter++;
  }

  function ensureId(element: Element | null) {
    if (!element || (element as HTMLElement).dataset.wysiwygEditor === "true") return "";
    const htmlElement = element as HTMLElement;
    if (!htmlElement.dataset.wysiwygId) htmlElement.dataset.wysiwygId = nextId();
    return htmlElement.dataset.wysiwygId;
  }

  function serialize() {
    return "<!doctype html>\n" + document.documentElement.outerHTML;
  }

  function post(type: string, payload: Record<string, unknown> = {}) {
    win.parent.postMessage({ type, ...payload }, "*");
  }

  function colorToHex(value: string) {
    if (!value || value === "transparent") return "";
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/i);
    if (!match) return "";
    if (match[4] !== undefined && Number(match[4]) === 0) return "";
    return "#" + [match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("");
  }

  function isRevealStack(element: Element) {
    return (
      element.matches(".reveal .slides > section") &&
      Array.from(element.children).some((child) => child.tagName.toLowerCase() === "section")
    );
  }

  function addSlide(slides: Element[], seen: Set<Element>, element: Element) {
    if ((element as HTMLElement).dataset.wysiwygEditor === "true") return;
    if (element.closest('[data-wysiwyg-editor="true"]')) return;
    if (isRevealStack(element)) return;
    if (seen.has(element)) return;
    seen.add(element);
    slides.push(element);
  }

  function slideCandidates() {
    const selectors = [
      "section.slide",
      "article.slide",
      "section[data-title]",
      "section[data-section]",
      "[data-slide]",
      "[data-slide-id]",
      ".reveal .slides > section",
      ".reveal .slides > section > section",
    ];
    const seen = new Set<Element>();
    const slides: Element[] = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        addSlide(slides, seen, element);
      });
    }
    return slides;
  }

  function textFrom(element: Element, selector: string) {
    const target = element.querySelector(selector);
    return target ? (target.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function slideTitle(element: Element, index: number) {
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

  function visibleArea(element: Element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, win.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function nearestSlide(slides: Element[]) {
    if (!slides.length) return null;
    const selectedSlide = selectedElement ? selectedElement.closest(SLIDE_SELECTOR) : null;
    if (selectedSlide && slides.includes(selectedSlide)) return selectedSlide;
    const activeById = activeSlideId
      ? document.querySelector('[data-wysiwyg-id="' + win.CSS.escape(activeSlideId) + '"]')
      : null;
    if (activeById && slides.includes(activeById)) return activeById;
    return (
      slides
        .map((slide) => ({ slide, area: visibleArea(slide) }))
        .sort((a, b) => b.area - a.area)[0]?.slide || slides[0]
    );
  }

  function markActiveSlide(slide: Element | null) {
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
      activeId: activeSlide ? (activeSlide as HTMLElement).dataset.wysiwygId : "",
      slides: slides.map((slide, index) => ({
        id: ensureId(slide),
        index,
        title: slideTitle(slide, index),
        section: slide.getAttribute("data-section") || slide.getAttribute("data-title") || "",
      })),
    });
  }

  function scheduleDeckPublish() {
    win.clearTimeout(deckTimer);
    deckTimer = win.setTimeout(publishDeck, 120);
  }

  function publishChange(reason = "edit") {
    post("wysiwyg-document-change", {
      reason,
      html: serialize(),
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    });
    publishSelected();
    scheduleDeckPublish();
  }

  function elementLabel(element: Element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) return tag + "#" + element.id;
    const firstClass = element.classList[0];
    return firstClass ? tag + "." + firstClass : tag;
  }

  function breadcrumb(element: Element) {
    const trail: Array<{ id: string; label: string }> = [];
    let node: Element | null = element;
    while (node && node !== document.documentElement) {
      if ((node as HTMLElement).dataset && (node as HTMLElement).dataset.wysiwygEditor === "true") break;
      trail.unshift({ id: ensureId(node), label: elementLabel(node) });
      node = node.parentElement;
    }
    return trail;
  }

  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement("div");
    chip.className = "wysiwyg-chip";
    chip.dataset.wysiwygEditor = "true";
    chipLabel = document.createElement("span");
    chip.append(chipLabel);
    const addButton = (text: string, title: string, onClick: () => void, danger: boolean) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.title = title;
      if (danger) button.className = "danger";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      chip?.append(button);
    };
    addButton("↖", "Select parent", selectParent, false);
    addButton("⧉", "Duplicate", duplicateSelected, false);
    addButton("✕", "Delete", deleteSelected, true);
    document.body.append(chip);
    return chip;
  }

  function updateChip() {
    if (!selectedElement || mode === "preview" || !document.body.contains(selectedElement)) {
      if (chip) chip.style.display = "none";
      return;
    }
    ensureChip();
    if (chip && !document.body.contains(chip)) document.body.append(chip);
    if (!chip || !chipLabel) return;
    chipLabel.textContent = elementLabel(selectedElement);
    chip.style.display = "flex";
    const rect = selectedElement.getBoundingClientRect();
    chip.style.top = Math.max(win.scrollY + 4, rect.top + win.scrollY - 30) + "px";
    chip.style.left = Math.max(4, rect.left + win.scrollX) + "px";
  }

  function publishSelected() {
    updateChip();
    if (!selectedElement) {
      post("wysiwyg-selection", { selected: null });
      return;
    }

    const styles = win.getComputedStyle(selectedElement);
    const rect = selectedElement.getBoundingClientRect();
    const isImage = selectedElement.tagName.toLowerCase() === "img";
    post("wysiwyg-selection", {
      selected: {
        id: ensureId(selectedElement),
        tagName: selectedElement.tagName.toLowerCase(),
        text: selectedElement.textContent || "",
        childElementCount: selectedElement.childElementCount,
        editableText: canDirectlyEditTextElement(selectedElement),
        classes: Array.from(selectedElement.classList),
        ancestors: breadcrumb(selectedElement),
        isImage,
        imageSrc: isImage ? selectedElement.getAttribute("src") || "" : "",
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
          borderRadius: styles.borderRadius,
        },
      },
    });
  }

  function restoreContentEditable(element: Element | null) {
    if (!element) return;
    const original = element.getAttribute("data-wysiwyg-original-contenteditable");
    if (original !== null) {
      if (original === NONE) {
        element.removeAttribute("contenteditable");
      } else {
        element.setAttribute("contenteditable", original);
      }
      element.removeAttribute("data-wysiwyg-original-contenteditable");
    }
    const originalSpellcheck = element.getAttribute("data-wysiwyg-original-spellcheck");
    if (originalSpellcheck !== null) {
      if (originalSpellcheck === NONE) {
        element.removeAttribute("spellcheck");
      } else {
        element.setAttribute("spellcheck", originalSpellcheck);
      }
      element.removeAttribute("data-wysiwyg-original-spellcheck");
    }
    element.removeAttribute("data-wysiwyg-editing");
  }

  function makeEditable(element: Element | null) {
    if (!element || element === document.documentElement || element === document.head) return false;
    if (!canDirectlyEditTextElement(element)) return false;
    if (!element.hasAttribute("data-wysiwyg-original-contenteditable")) {
      const original = element.hasAttribute("contenteditable")
        ? element.getAttribute("contenteditable") || ""
        : NONE;
      element.setAttribute("data-wysiwyg-original-contenteditable", original);
    }
    if (!element.hasAttribute("data-wysiwyg-original-spellcheck")) {
      const original = element.hasAttribute("spellcheck") ? element.getAttribute("spellcheck") || "" : NONE;
      element.setAttribute("data-wysiwyg-original-spellcheck", original);
    }
    element.setAttribute("contenteditable", "true");
    element.setAttribute("spellcheck", "true");
    element.setAttribute("data-wysiwyg-editing", "true");
    (element as HTMLElement).focus({ preventScroll: true });
    return true;
  }

  function caretPositionToRange(position: CaretPosition | null | undefined) {
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  function placeCaretAtPoint(x: number, y: number, within: Element) {
    const docWithCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    };
    const range =
      docWithCaret.caretRangeFromPoint?.(x, y) ??
      caretPositionToRange(docWithCaret.caretPositionFromPoint?.(x, y));
    if (!range) return;
    const container =
      range.startContainer.nodeType === win.Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    if (!container || !within.contains(container)) return;
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function pickElement(start: EventTarget | null) {
    if (!(start instanceof win.Element)) return null;
    if ((start as HTMLElement).dataset.wysiwygEditor === "true") return null;
    if (start.closest('[data-wysiwyg-editor="true"]')) return null;
    if (start === document.documentElement || start === document.head) return null;
    return start === document.body ? document.body : start;
  }

  function selectElement(element: Element | null) {
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

  function setHover(element: Element | null) {
    if (hoveredElement && hoveredElement !== selectedElement) {
      hoveredElement.removeAttribute("data-wysiwyg-hover");
    }
    hoveredElement = element;
    if (hoveredElement && hoveredElement !== selectedElement && mode !== "preview") {
      hoveredElement.setAttribute("data-wysiwyg-hover", "true");
    }
  }

  function selectedById(id: string) {
    if (!id) return selectedElement;
    return document.querySelector('[data-wysiwyg-id="' + win.CSS.escape(id) + '"]');
  }

  function applyStyles(styles: Record<string, unknown> | undefined) {
    if (!selectedElement || !styles) return;
    for (const [key, value] of Object.entries(styles)) {
      if (value === null || value === undefined) continue;
      (selectedElement as HTMLElement).style[key as any] = String(value);
    }
    publishChange("style");
  }

  function setText(text: string) {
    if (!selectedElement) return;
    selectedElement.textContent = text;
    publishChange("text");
  }

  function selectParent() {
    if (!selectedElement) return;
    const parent = selectedElement.parentElement;
    const target = pickElement(parent);
    if (!target || target === selectedElement) return;
    selectElement(target);
  }

  function setClass(name: unknown, action: unknown) {
    if (!selectedElement || !name) return;
    const className = String(name).trim();
    if (!className) return;
    if (action === "add") selectedElement.classList.add(className);
    else if (action === "remove") selectedElement.classList.remove(className);
    else selectedElement.classList.toggle(className);
    publishChange("class");
  }

  function replaceImage(src: unknown, alt: unknown) {
    if (!selectedElement || selectedElement.tagName.toLowerCase() !== "img") return;
    if (typeof src === "string" && src) selectedElement.setAttribute("src", src);
    if (typeof alt === "string") selectedElement.setAttribute("alt", alt);
    publishChange("image");
  }

  function duplicateSelected() {
    if (!selectedElement || !selectedElement.parentElement || selectedElement === document.body) return;
    const clone = selectedElement.cloneNode(true) as Element;
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

  function baseTransform(element: HTMLElement) {
    if (element.dataset.wysiwygBaseTransform === undefined) {
      element.dataset.wysiwygBaseTransform = element.style.transform || "";
    }
    return element.dataset.wysiwygBaseTransform;
  }

  function currentTranslate(element: HTMLElement) {
    return {
      dx: Number(element.dataset.wysiwygTx || 0),
      dy: Number(element.dataset.wysiwygTy || 0),
    };
  }

  function setTranslate(element: HTMLElement, dx: number, dy: number) {
    const base = baseTransform(element);
    element.dataset.wysiwygTx = String(dx);
    element.dataset.wysiwygTy = String(dy);
    const next = ("translate(" + dx + "px, " + dy + "px) " + base).trim();
    element.style.transform = next;
  }

  function nudge(dx: number, dy: number) {
    if (!selectedElement) return;
    const htmlElement = selectedElement as HTMLElement;
    const current = currentTranslate(htmlElement);
    setTranslate(htmlElement, current.dx + dx, current.dy + dy);
    publishChange("move");
  }

  function goToSlide(payload: Record<string, unknown>) {
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

  function slideFromPayload(payload: Record<string, unknown>) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : nearestSlide(slides);
    return { slides, slide };
  }

  function clearEditorState(element: Element) {
    element.removeAttribute("data-wysiwyg-current-slide");
    element.removeAttribute("data-wysiwyg-selected");
    element.removeAttribute("data-wysiwyg-hover");
    element.removeAttribute("data-wysiwyg-id");
    element
      .querySelectorAll("[data-wysiwyg-id], [data-wysiwyg-selected], [data-wysiwyg-hover], [data-wysiwyg-current-slide]")
      .forEach((child) => {
        child.removeAttribute("data-wysiwyg-current-slide");
        child.removeAttribute("data-wysiwyg-selected");
        child.removeAttribute("data-wysiwyg-hover");
        child.removeAttribute("data-wysiwyg-id");
      });
  }

  function replaceFirstText(element: Element, selector: string, text: string) {
    const target = element.querySelector(selector);
    if (!target) return false;
    target.textContent = text;
    return true;
  }

  function prepareNewSlide(slide: Element) {
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

  function duplicateSlide(payload: Record<string, unknown>) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : nearestSlide(slides);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(true) as Element;
    clearEditorState(clone);
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("duplicate-slide");
  }

  function insertSlide(payload: Record<string, unknown>) {
    const { slide } = slideFromPayload(payload);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(true) as Element;
    prepareNewSlide(clone);
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-slide");
  }

  function renameSlide(payload: Record<string, unknown>) {
    const { slide } = slideFromPayload(payload);
    const title = String(payload.title || "").trim();
    if (!slide || !title) return;
    slide.setAttribute("data-title", title);
    const heading = slide.querySelector("h1, h2, h3");
    if (heading) {
      heading.textContent = title;
    } else {
      const fallbackHeading = document.createElement("h2");
      fallbackHeading.textContent = title;
      slide.prepend(fallbackHeading);
    }
    markActiveSlide(slide);
    publishChange("rename-slide");
    publishDeck();
  }

  function deleteSlide(payload: Record<string, unknown>) {
    const { slides, slide } = slideFromPayload(payload);
    if (!slide || !slide.parentElement) return;
    const index = slides.indexOf(slide);
    const next = slides[index + 1] || slides[index - 1] || null;
    if (selectedElement && slide.contains(selectedElement)) {
      selectedElement.removeAttribute("data-wysiwyg-selected");
      restoreContentEditable(selectedElement);
      selectedElement = null;
    }
    slide.remove();
    if (next && document.body.contains(next)) {
      markActiveSlide(next);
      next.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } else {
      activeSlideId = "";
    }
    publishChange("delete-slide");
    publishDeck();
  }

  function moveSlide(payload: Record<string, unknown>) {
    const { slides, slide } = slideFromPayload(payload);
    const offset = Math.trunc(Number(payload.offset || 0));
    if (!slide || !slide.parentElement || offset === 0) return;
    const currentIndex = slides.indexOf(slide);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= slides.length) return;
    const target = slides[targetIndex];
    if (offset > 0) {
      target.after(slide);
    } else {
      target.before(slide);
    }
    markActiveSlide(slide);
    slide.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("move-slide");
    publishDeck();
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
      ".cosmic-data-table tr:last-child td{border-bottom:0;}",
    ].join("");
    document.head.append(style);
  }

  function textValue(value: unknown) {
    return String(value ?? "").trim();
  }

  function payloadCells(values: unknown) {
    return Array.isArray(values) ? values.map((value) => textValue(value)) : [];
  }

  function appendCell(row: HTMLTableRowElement, tagName: string, text: string) {
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

  function insertDataTable(payload: Record<string, unknown>) {
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

  function exitEditing() {
    if (!selectedElement) return;
    const active = document.activeElement;
    if (active instanceof win.HTMLElement) active.blur();
    restoreContentEditable(selectedElement);
    publishSelected();
  }

  function insertPlainTextAtSelection(text: string) {
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function handleEditorKey(event: KeyboardEvent, context: EditorKeyContext) {
    if (mode === "preview" || !selectedElement) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      if (context.typing) {
        exitEditing();
      } else {
        clearSelection();
      }
      return true;
    }

    if (context.typing) return false;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return true;
    }

    if (event.key.indexOf("Arrow") === 0) {
      event.preventDefault();
      if (mode !== "move" && !(mode === "select" && event.altKey)) return true;
      const step = event.shiftKey ? 1 : 8;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (dx === 0 && dy === 0) return true;
      nudge(dx, dy);
      return true;
    }

    return false;
  }

  win.__cosmicHandleEditorKey = handleEditorKey;

  document.addEventListener(
    "mouseover",
    (event) => {
      if (mode === "preview") return;
      setHover(pickElement(event.target));
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    () => {
      if (hoveredElement && hoveredElement !== selectedElement) hoveredElement.removeAttribute("data-wysiwyg-hover");
      hoveredElement = null;
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (mode !== "move") return;
      const target = pickElement(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
      const htmlTarget = target as HTMLElement;
      const origin = currentTranslate(htmlTarget);
      dragState = {
        element: htmlTarget,
        startX: event.clientX,
        startY: event.clientY,
        baseDx: origin.dx,
        baseDy: origin.dy,
      };
      htmlTarget.setPointerCapture?.(event.pointerId);
    },
    true,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (!dragState) return;
      event.preventDefault();
      const dx = Math.round(event.clientX - dragState.startX);
      const dy = Math.round(event.clientY - dragState.startY);
      setTranslate(dragState.element, dragState.baseDx + dx, dragState.baseDy + dy);
      publishSelected();
    },
    true,
  );

  document.addEventListener(
    "pointerup",
    () => {
      if (!dragState) return;
      dragState = null;
      publishChange("move");
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (mode === "preview") return;
      const target = pickElement(event.target);
      if (!target) return;
      if (mode === "text" && selectedElement === target && inTypingContextForElement(target)) {
        return;
      }
      const wasEditable = inTypingContextForElement(target);
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
      if (mode === "text" && !wasEditable && selectedElement === target && canDirectlyEditTextElement(target)) {
        placeCaretAtPoint(event.clientX, event.clientY, target);
      }
    },
    true,
  );

  document.addEventListener(
    "input",
    () => {
      win.clearTimeout(inputTimer);
      inputTimer = win.setTimeout(() => publishChange("input"), 250);
    },
    true,
  );

  document.addEventListener(
    "paste",
    (event) => {
      if (mode !== "text") return;
      if (!inTypingContextForElement(document.activeElement) && !inTypingContextForElement(pickElement(event.target))) return;
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return;
      event.preventDefault();
      if (insertPlainTextAtSelection(text)) publishChange("paste");
    },
    true,
  );

  document.addEventListener(
    "focusin",
    (event) => {
      const target = pickElement(event.target);
      if (target && target === selectedElement && target.getAttribute("contenteditable") === "true") {
        target.setAttribute("data-wysiwyg-editing", "true");
      }
    },
    true,
  );

  document.addEventListener(
    "focusout",
    (event) => {
      const target = pickElement(event.target);
      target?.removeAttribute("data-wysiwyg-editing");
    },
    true,
  );

  document.addEventListener("blur", () => publishChange("blur"), true);

  document.addEventListener(
    "keydown",
    (event) => {
      handleEditorKey(event, {
        typing: inTypingContextForElement(document.activeElement),
      });
    },
    true,
  );

  win.addEventListener("message", (event) => {
    if (event.source !== win.parent) return;
    const data = (event.data || {}) as Record<string, unknown>;
    if (data.type !== "wysiwyg-command") return;

    if (data.command === "set-mode") {
      mode = typeof data.mode === "string" ? data.mode : "text";
      syncFenceState();
      document.documentElement.setAttribute("data-wysiwyg-mode", mode);
      if (mode !== "text") restoreContentEditable(selectedElement);
      if (mode === "text" && selectedElement) makeEditable(selectedElement);
      publishSelected();
    }

    if (data.command === "select" && data.id) {
      const element = selectedById(String(data.id));
      if (element) selectElement(element);
    }

    if (data.command === "select-parent") selectParent();
    if (data.command === "apply-style") applyStyles(data.styles as Record<string, unknown> | undefined);
    if (data.command === "set-text") setText(String(data.text || ""));
    if (data.command === "set-class") setClass(data.className, data.action);
    if (data.command === "replace-image") replaceImage(data.src, data.alt);
    if (data.command === "duplicate") duplicateSelected();
    if (data.command === "duplicate-slide") duplicateSlide(data);
    if (data.command === "insert-slide") insertSlide(data);
    if (data.command === "rename-slide") renameSlide(data);
    if (data.command === "delete-slide") deleteSlide(data);
    if (data.command === "move-slide") moveSlide(data);
    if (data.command === "insert-table") insertDataTable(data);
    if (data.command === "delete") deleteSelected();
    if (data.command === "go-slide") goToSlide(data);
    if (data.command === "nudge") nudge(Number(data.dx || 0), Number(data.dy || 0));
    if (data.command === "scroll-to") win.scrollTo(Number(data.x || 0), Number(data.y || 0));
    if (data.command === "request-html") publishChange("request");
  });

  win.addEventListener(
    "scroll",
    () => {
      scheduleDeckPublish();
      updateChip();
    },
    true,
  );
  win.addEventListener("resize", () => {
    scheduleDeckPublish();
    updateChip();
  });

  syncFenceState();
  document.documentElement.setAttribute("data-wysiwyg-mode", mode);
  post("wysiwyg-ready", {
    title: document.title || "",
    bodyTextStart: (document.body ? document.body.textContent || "" : "").trim().slice(0, 180),
  });
  publishDeck();
}
