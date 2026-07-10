import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { HOSTILE_DECK_HTML, installHostileDeckNavigation, REVEAL_DECK_HTML } from "../fixtures/hostileDeck";
import { cleanEditorHtml, prepareEditableHtml, SAMPLE_HTML } from "../htmlDocument";
import {
  canDirectlyEditTextElement,
  collectDeckSlides,
  editableTextTarget,
  inTypingContextForElement,
  installEditorBridge,
  installKeyboardFence,
} from "./editorBridge";

type TestWindow = Window &
  typeof globalThis & {
    __deckKeysSeen?: string[];
    __deckSlideIndex?: number;
    __cosmicFenceInstalled?: boolean;
    __cosmicFenceState?: { mode: string };
    __cosmicHandleEditorKey?: (event: KeyboardEvent, context: { typing: boolean }) => boolean;
  };

function createWindow(html = HOSTILE_DECK_HTML) {
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const win = dom.window as TestWindow;
  const messages: any[] = [];
  Object.defineProperty(win, "parent", {
    configurable: true,
    value: {
      postMessage(message: unknown) {
        messages.push(message);
      },
    },
  });
  if (!win.CSS) {
    (win as any).CSS = { escape: (value: string) => value.replace(/"/g, '\\"') };
  } else if (!win.CSS.escape) {
    win.CSS.escape = (value: string) => value.replace(/"/g, '\\"');
  }
  win.Element.prototype.scrollIntoView = function scrollIntoView() {};
  return { dom, win, messages };
}

function installBridgeWithHostileDeck(html = HOSTILE_DECK_HTML) {
  const setup = createWindow(html);
  installKeyboardFence(setup.win);
  installHostileDeckNavigation(setup.win);
  installEditorBridge(setup.win);
  return setup;
}

function postCommand(win: TestWindow, command: Record<string, unknown>, sessionToken?: string) {
  win.dispatchEvent(
    new win.MessageEvent("message", {
      data: {
        type: "wysiwyg-command",
        ...command,
        ...(sessionToken === undefined ? {} : { sessionToken }),
      },
      source: win.parent,
    }),
  );
}

function keydown(win: TestWindow, target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new win.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function pointer(win: TestWindow, target: EventTarget, type: string, x: number, y: number) {
  const event = new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }) as MouseEvent & { pointerId?: number };
  Object.defineProperty(event, "pointerId", { configurable: true, value: 1 });
  target.dispatchEvent(event);
  return event;
}

function latestDeckMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-deck").at(-1);
}

function latestAuditMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-audit").at(-1);
}

function latestFindMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-find").at(-1);
}

function latestLayersMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-layers").at(-1);
}

function latestOutlineMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-outline").at(-1);
}

function latestSelectionMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-selection").at(-1);
}

function stubRect(element: Element, rect: Partial<DOMRect>) {
  const full = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    toJSON: () => ({}),
  };
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => full });
}

function click(win: TestWindow, target: Element, init: MouseEventInit = {}) {
  target.dispatchEvent(
    new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 1,
      clientY: 1,
      ...init,
    }),
  );
}

function doubleClick(win: TestWindow, target: Element, init: MouseEventInit = {}) {
  target.dispatchEvent(
    new win.MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: 1,
      clientY: 1,
      ...init,
    }),
  );
}

function selectSubstring(win: TestWindow, root: Element, text: string) {
  const walker = win.document.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.textContent || "";
    const index = value.indexOf(text);
    if (index >= 0) {
      const range = win.document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const selection = win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return range;
    }
    node = walker.nextNode();
  }
  throw new Error(`Unable to select substring: ${text}`);
}

describe("bridge helpers", () => {
  it("detects typing contexts across contenteditable and form controls", () => {
    const { win } = createWindow(`
      <div id="host" contenteditable="true"><span id="nested">Text</span><span id="off" contenteditable="false">Off</span></div>
      <div id="plain"></div>
      <p id="plain-text-only" contenteditable="plaintext-only">Plain</p>
      <input id="text-input" type="text" />
      <input id="checkbox" type="checkbox" />
      <div id="textbox" role="textbox"></div>
    `);

    expect(inTypingContextForElement(win.document.getElementById("host"))).toBe(true);
    expect(inTypingContextForElement(win.document.getElementById("nested"))).toBe(true);
    expect(inTypingContextForElement(win.document.getElementById("off"))).toBe(false);
    expect(inTypingContextForElement(win.document.getElementById("plain"))).toBe(false);
    expect(inTypingContextForElement(win.document.getElementById("plain-text-only"))).toBe(true);
    expect(inTypingContextForElement(win.document.getElementById("text-input"))).toBe(true);
    expect(inTypingContextForElement(win.document.getElementById("checkbox"))).toBe(false);
    expect(inTypingContextForElement(win.document.getElementById("textbox"))).toBe(true);
    expect(inTypingContextForElement(null)).toBe(false);
  });

  it("allows direct content editing only for simple text elements", () => {
    const { win } = createWindow(`
      <p id="plain">Plain text</p>
      <p id="inline">Plain <strong>strong</strong> text</p>
      <section id="slide" class="slide"><h2>Title</h2><p>Body</p></section>
      <div id="blocks"><p>Nested block</p></div>
    `);

    expect(canDirectlyEditTextElement(win.document.getElementById("plain"))).toBe(true);
    expect(canDirectlyEditTextElement(win.document.getElementById("inline"))).toBe(true);
    expect(canDirectlyEditTextElement(win.document.getElementById("slide"))).toBe(false);
    expect(canDirectlyEditTextElement(win.document.getElementById("blocks"))).toBe(false);
  });

  it("finds a safe text child for compact wrapper selections", () => {
    const { win } = createWindow(`
      <div id="wrapper" class="slide-body">
        <h1 id="headline">Executive title</h1>
        <p>Supporting line</p>
      </div>
      <section id="complex"><h2>One</h2><p>Two</p><p>Three</p><p>Four</p></section>
    `);

    expect(editableTextTarget(win.document.getElementById("wrapper"))?.id).toBe("headline");
    expect(editableTextTarget(win.document.getElementById("complex"))).toBeNull();
  });

  it("collects slides from common generated HTML layouts", () => {
    const { win } = createWindow(`
      <main class="slides">
        <div id="div-slide" class="slide"><h1>Div slide</h1></div>
        <article id="deck-slide" class="deck-slide"><h2>Deck slide</h2></article>
        <section id="aria-slide" aria-roledescription="slide"><h2>Aria slide</h2></section>
        <div id="body" class="slide-body"><h2>Inner wrapper</h2></div>
      </main>
    `);

    expect(collectDeckSlides(win.document).map((slide) => slide.id)).toEqual([
      "div-slide",
      "deck-slide",
      "aria-slide",
    ]);
  });

  it("infers repeated page-like siblings when explicit slide markers are absent", () => {
    const { win } = createWindow(`
      <main id="generated-report">
        <nav>Global controls</nav>
        <div id="stage">
          <div id="screen-1" class="screen-frame" style="width: 1280px; height: 720px;">
            <header>Executive presentment</header>
            <h1>Liquidity Control Tower</h1>
            <p>Slide 1 of 3. Daily liquidity analysis with regulatory thresholds, funding velocity, and control exceptions.</p>
          </div>
          <div id="screen-2" class="screen-frame" style="width: 1280px; height: 720px;">
            <header>High velocity flows</header>
            <h1>Intraday Watchlist</h1>
            <p>Slide 2 of 3. Settlement windows, balances, and exception queues are grouped for operating review.</p>
          </div>
          <div id="screen-3" class="screen-frame" style="width: 1280px; height: 720px;">
            <header>Closeout</header>
            <h1>Escalation Paths</h1>
            <p>Slide 3 of 3. Decision owners and timing are listed for follow-up during the next review cycle.</p>
          </div>
          <aside class="speaker-notes">Internal notes should not become a slide.</aside>
        </div>
      </main>
    `);

    expect(collectDeckSlides(win.document).map((slide) => slide.id)).toEqual([
      "screen-1",
      "screen-2",
      "screen-3",
    ]);
  });

  it("does not infer ordinary repeated article content as a deck", () => {
    const { win } = createWindow(`
      <main>
        <article><h2>First update</h2><p>This is a normal article card with enough text to be meaningful but no page-like sizing or naming.</p></article>
        <article><h2>Second update</h2><p>This is another normal article card with enough text to be meaningful but no page-like sizing or naming.</p></article>
        <article><h2>Third update</h2><p>This is a third normal article card with enough text to be meaningful but no page-like sizing or naming.</p></article>
      </main>
    `);

    expect(collectDeckSlides(win.document)).toEqual([]);
  });

  it("force mode infers ambiguous repeated content panels", () => {
    const { win } = createWindow(`
      <main>
        <div class="report-block"><h1>Opening Position</h1><p>Liquidity controls and beginning balances for the operating review.</p></div>
        <div class="report-block"><h1>Regulatory Lineage</h1><p>Rule mapping, data freshness, and exception history for the daily packet.</p></div>
        <div class="report-block"><h1>Closeout Actions</h1><p>Owners, checkpoints, and next-cycle evidence requirements for the team.</p></div>
      </main>
    `);

    expect(collectDeckSlides(win.document)).toEqual([]);
    expect(collectDeckSlides(win.document, { force: true }).map((slide) => slide.querySelector("h1")?.textContent)).toEqual([
      "Opening Position",
      "Regulatory Lineage",
      "Closeout Actions",
    ]);
  });

  it("force mode infers visual page siblings with little or no text", () => {
    const { win } = createWindow(`
      <main id="deck-canvas">
        <div id="visual-a" aria-label="Opening visual" class="plate-a" style="width: 1280px; height: 720px; background-image: url(opening.png);"></div>
        <div id="visual-b" aria-label="Risk visual" class="plate-b" style="width: 1280px; height: 720px; background: linear-gradient(#123, #456);"></div>
        <div id="visual-c" aria-label="Closeout visual" class="plate-c" style="width: 1280px; height: 720px; background-color: #f8fafc; border: 1px solid #94a3b8;"></div>
      </main>
    `);

    expect(collectDeckSlides(win.document)).toEqual([]);
    expect(collectDeckSlides(win.document, { force: true }).map((slide) => slide.id)).toEqual([
      "visual-a",
      "visual-b",
      "visual-c",
    ]);
  });

  it("force mode accepts two strong visual pages with different shapes", () => {
    const { win } = createWindow(`
      <main>
        <div id="cover-visual" aria-label="Cover" class="cover-art" style="width: 1280px; height: 720px; background-image: url(cover.png);"></div>
        <figure id="summary-visual" aria-label="Summary" class="summary-artboard" style="width: 1280px; height: 720px; border: 1px solid #94a3b8;"></figure>
      </main>
    `);

    expect(collectDeckSlides(win.document)).toEqual([]);
    expect(collectDeckSlides(win.document, { force: true }).map((slide) => slide.id)).toEqual([
      "cover-visual",
      "summary-visual",
    ]);
  });

  it("force mode finds slide pages nested under separate wrappers", () => {
    const { win } = createWindow(`
      <main>
        <section class="export-page-wrapper">
          <div id="nested-page-a" aria-label="Nested opening" class="page-surface-a" style="width: 1280px; height: 720px; background: #f8fafc;"></div>
        </section>
        <section class="export-page-wrapper">
          <div id="nested-page-b" aria-label="Nested risk" class="page-surface-b" style="width: 1280px; height: 720px; background: #e0f2fe;"></div>
        </section>
        <section class="export-page-wrapper">
          <div id="nested-page-c" aria-label="Nested close" class="page-surface-c" style="width: 1280px; height: 720px; background: #fef3c7;"></div>
        </section>
      </main>
    `);

    expect(collectDeckSlides(win.document)).toEqual([]);
    expect(collectDeckSlides(win.document, { force: true }).map((slide) => slide.id)).toEqual([
      "nested-page-a",
      "nested-page-b",
      "nested-page-c",
    ]);
  });

  it("force mode replaces same-count wrapper slides with nested page surfaces", () => {
    const { win } = createWindow(`
      <div class="slides">
        <section class="export-page-wrapper" data-page="1">
          <div id="nested-slide-a" aria-label="Wrapped opening" class="page-surface-a" style="width: 1280px; height: 720px; background: #f8fafc;"></div>
        </section>
        <section class="export-page-wrapper" data-page="2">
          <div id="nested-slide-b" aria-label="Wrapped risk" class="page-surface-b" style="width: 1280px; height: 720px; background: #e0f2fe;"></div>
        </section>
        <section class="export-page-wrapper" data-page="3">
          <div id="nested-slide-c" aria-label="Wrapped close" class="page-surface-c" style="width: 1280px; height: 720px; background: #fef3c7;"></div>
        </section>
      </div>
    `);

    expect(collectDeckSlides(win.document).map((slide) => slide.className)).toEqual([
      "export-page-wrapper",
      "export-page-wrapper",
      "export-page-wrapper",
    ]);
    expect(collectDeckSlides(win.document, { force: true }).map((slide) => slide.id)).toEqual([
      "nested-slide-a",
      "nested-slide-b",
      "nested-slide-c",
    ]);
  });

  it("force mode infers page-like frames with styled title spans", () => {
    const { win } = createWindow(`
      <section class="storyboard">
        <div id="frame-a" class="frame-01" style="aspect-ratio: 16 / 9; border: 1px solid #111;">
          <span class="headline-text">Opening</span>
          <span class="metric-value">42%</span>
        </div>
        <div id="frame-b" class="frame-02" style="aspect-ratio: 16 / 9; border: 1px solid #111;">
          <span class="headline-text">Control</span>
          <span class="metric-value">17</span>
        </div>
        <div id="frame-c" class="frame-03" style="aspect-ratio: 16 / 9; border: 1px solid #111;">
          <span class="headline-text">Closeout</span>
          <span class="metric-value">5</span>
        </div>
      </section>
    `);

    expect(collectDeckSlides(win.document)).toEqual([]);
    expect(collectDeckSlides(win.document, { force: true }).map((slide) => slide.id)).toEqual([
      "frame-a",
      "frame-b",
      "frame-c",
    ]);
  });
});

describe("editor bridge extraction", () => {
  it("installs into jsdom and posts ready/deck messages", () => {
    const { win, messages } = createWindow(SAMPLE_HTML);
    installKeyboardFence(win);
    installEditorBridge(win);

    expect(messages.some((message) => message.type === "wysiwyg-ready")).toBe(true);
    expect(messages.some((message) => message.type === "wysiwyg-deck")).toBe(true);
  });

  it("injects executable JavaScript and places the fence before author head scripts", () => {
    const html = prepareEditableHtml(HOSTILE_DECK_HTML, true);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const headScripts = Array.from(doc.head.querySelectorAll("script"));

    expect(headScripts[0]?.getAttribute("data-wysiwyg-editor")).toBe("true");
    expect(headScripts[1]?.textContent).toContain("__authorHeadScriptRan");
    expect(html).toContain("function canDirectlyEditTextElement");
    expect(html).toContain('const NONE = "__wysiwyg_none__"');
    expect(html).not.toMatch(/\binterface\b|:\s*(Element|Window|KeyboardEvent|number|string|unknown)\b/);
  });
});

describe("keyboard fence", () => {
  it("keeps deck scripts from seeing text-editing navigation keys", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable");
    expect(paragraph).not.toBeNull();

    doubleClick(win, paragraph as Element);
    expect(paragraph?.getAttribute("contenteditable")).toBe("true");

    for (const key of [" ", "Backspace", "ArrowLeft", "PageDown"]) {
      const event = keydown(win, paragraph as Element, key);
      expect(win.__deckKeysSeen).toEqual([]);
      if (key === " " || key === "Backspace") {
        expect(event.defaultPrevented).toBe(false);
      }
    }
  });

  it("blocks deck navigation and browser defaults outside typing contexts", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    doubleClick(win, paragraph);
    postCommand(win, { command: "set-mode", mode: "select" });

    const space = keydown(win, win.document.body, " ");
    const pageDown = keydown(win, win.document.body, "PageDown");

    expect(win.__deckKeysSeen).toEqual([]);
    expect(space.defaultPrevented).toBe(true);
    expect(pageDown.defaultPrevented).toBe(true);
  });

  it("lets deck shortcuts work again in preview mode", () => {
    const { win } = installBridgeWithHostileDeck();
    postCommand(win, { command: "set-mode", mode: "preview" });

    keydown(win, win.document.body, " ");

    expect(win.__deckKeysSeen).toContain(" ");
    expect(win.__deckSlideIndex).toBeGreaterThan(0);
  });

  it("forwards editor-owned iframe shortcuts without stealing native text undo", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;

    keydown(win, win.document.body, "s", { ctrlKey: true });
    expect(messages).toContainEqual({ type: "wysiwyg-shortcut", action: "save" });

    doubleClick(win, paragraph);
    const undo = keydown(win, paragraph, "z", { ctrlKey: true });
    expect(undo.defaultPrevented).toBe(false);
    expect(messages).not.toContainEqual({ type: "wysiwyg-shortcut", action: "undo" });

    postCommand(win, { command: "set-mode", mode: "select" });
    keydown(win, win.document.body, "z", { ctrlKey: true });
    expect(messages).toContainEqual({ type: "wysiwyg-shortcut", action: "undo" });
  });

  it.each(
    (["text", "select", "move", "preview"] as const).flatMap((mode) =>
      [true, false].flatMap((typing) =>
        [
          { label: "Space", key: " ", nav: true },
          { label: "Backspace", key: "Backspace", nav: true },
          { label: "ArrowRight", key: "ArrowRight", nav: true },
          { label: "PageDown", key: "PageDown", nav: true },
          { label: "Escape", key: "Escape", nav: false },
          { label: "Delete", key: "Delete", nav: false },
          { label: "Ctrl+S", key: "s", nav: false, init: { ctrlKey: true }, shortcut: "save" },
        ].map((key) => ({ mode, typing, ...key })),
      ),
    ),
  )("guards $label in $mode mode with typing=$typing", ({ mode, typing, key, nav, init, shortcut }) => {
    const { win, messages } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    const input = win.document.getElementById("deck-input") as HTMLInputElement;
    click(win, paragraph);
    postCommand(win, { command: "set-mode", mode });

    let target: EventTarget = win.document.body;
    if (typing) {
      if (mode === "text") {
        doubleClick(win, paragraph);
        target = paragraph;
      } else {
        input.focus();
        target = input;
      }
    }

    win.__deckKeysSeen = [];
    const event = keydown(win, target, key, init);
    const previewMode = mode === "preview";

    expect(win.__deckKeysSeen).toEqual(nav && previewMode ? [key, key] : []);
    if (nav) {
      expect(event.defaultPrevented).toBe(previewMode || !typing);
    }
    if (shortcut) {
      expect(event.defaultPrevented).toBe(true);
      expect(messages).toContainEqual({ type: "wysiwyg-shortcut", action: shortcut });
    }
  });

  it("keeps form-field typing safe and does not delete the selected element", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    const input = win.document.getElementById("deck-input") as HTMLInputElement;
    doubleClick(win, paragraph);
    postCommand(win, { command: "set-mode", mode: "select" });
    input.focus();

    const space = keydown(win, input, " ");
    const del = keydown(win, input, "Delete");

    expect(space.defaultPrevented).toBe(false);
    expect(del.defaultPrevented).toBe(false);
    expect(win.__deckKeysSeen).toEqual([]);
    expect(win.document.getElementById("editable")).not.toBeNull();
  });
});

describe("editor key semantics", () => {
  it("nudges only in Move mode", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as HTMLElement;
    doubleClick(win, paragraph);

    postCommand(win, { command: "set-mode", mode: "text" });
    keydown(win, win.document.body, "ArrowRight");
    expect(paragraph.style.transform).toBe("");

    postCommand(win, { command: "set-mode", mode: "move" });
    keydown(win, win.document.body, "ArrowRight");
    expect(paragraph.style.transform).toContain("translate(8px, 0px)");
  });

  it("uses Backspace as Delete only outside typing contexts", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    doubleClick(win, paragraph);

    keydown(win, paragraph, "Backspace");
    expect(win.document.getElementById("editable")).not.toBeNull();

    postCommand(win, { command: "set-mode", mode: "select" });
    keydown(win, win.document.body, "Backspace");
    expect(win.document.getElementById("editable")).toBeNull();
    expect(win.__deckKeysSeen).toEqual([]);
  });

  it("publishes editableText from the same predicate used by contenteditable", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    const slide = win.document.querySelector("section.slide") as Element;

    doubleClick(win, paragraph);
    expect(latestSelectionMessage(messages).selected).toMatchObject({
      id: paragraph.getAttribute("data-wysiwyg-id"),
      editableText: true,
    });

    postCommand(win, { command: "select", id: slide.getAttribute("data-wysiwyg-id") });

    expect(latestSelectionMessage(messages).selected).toMatchObject({
      id: slide.getAttribute("data-wysiwyg-id"),
      editableText: false,
    });
    expect(slide.hasAttribute("contenteditable")).toBe(false);
  });

  it("edits a wrapper's primary text child from inspector text commands", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><body>
        <div class="slide">
          <div id="body" class="slide-body">
            <h1 id="headline">Old headline</h1>
            <p id="supporting">Supporting line</p>
          </div>
        </div>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);
    const body = win.document.getElementById("body") as Element;

    click(win, body);

    expect(latestSelectionMessage(messages).selected).toMatchObject({
      id: body.getAttribute("data-wysiwyg-id"),
      text: "Old headline",
      childElementCount: 2,
      editableText: true,
    });

    postCommand(win, { command: "set-text", text: "New headline" });

    expect(win.document.getElementById("headline")?.textContent).toBe("New headline");
    expect(win.document.getElementById("supporting")?.textContent).toBe("Supporting line");
    expect(body.children).toHaveLength(2);
    expect(messages.filter((message) => message.type === "wysiwyg-operation").at(-1)).toMatchObject({
      operation: {
        kind: "text",
        reason: "text",
        value: "New headline",
        locator: { tagName: "h1" },
      },
    });
    expect(messages.some((message) => message.type === "wysiwyg-document-change")).toBe(false);
  });

  it("treats Escape as an editing ladder", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    doubleClick(win, paragraph);

    keydown(win, paragraph, "Escape");
    expect(paragraph.hasAttribute("contenteditable")).toBe(false);
    expect(paragraph.getAttribute("data-wysiwyg-selected")).toBe("true");

    keydown(win, win.document.body, "Escape");
    expect(paragraph.hasAttribute("data-wysiwyg-selected")).toBe(false);
  });
});

describe("editing polish", () => {
  it("uses single click for selection and double click for explicit text editing", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;

    click(win, paragraph);
    expect(paragraph.getAttribute("data-wysiwyg-selected")).toBe("true");
    expect(paragraph.hasAttribute("contenteditable")).toBe(false);
    expect(latestSelectionMessage(messages).selected.editing).toBe(false);

    doubleClick(win, paragraph);
    expect(paragraph.getAttribute("contenteditable")).toBe("true");
    expect(latestSelectionMessage(messages).selected.editing).toBe(true);
  });

  it("marks focused editing state and restores spellcheck/contenteditable metadata", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;

    doubleClick(win, paragraph);

    expect(paragraph.getAttribute("data-wysiwyg-editing")).toBe("true");
    expect(paragraph.getAttribute("spellcheck")).toBe("true");

    keydown(win, paragraph, "Escape");

    expect(paragraph.hasAttribute("data-wysiwyg-editing")).toBe(false);
    expect(paragraph.hasAttribute("contenteditable")).toBe(false);
    expect(paragraph.hasAttribute("spellcheck")).toBe(false);
  });

  it("exports without editing or spellcheck metadata", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);

    expect(cleaned).not.toContain("data-wysiwyg-editing");
    expect(cleaned).not.toContain("data-wysiwyg-original-spellcheck");
    expect(cleaned).not.toContain("spellcheck");
  });

  it("pastes plain text into contenteditable text mode", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    const text = paragraph.firstChild as Text;
    doubleClick(win, paragraph);

    const range = win.document.createRange();
    range.setStart(text, text.textContent?.length ?? 0);
    range.collapse(true);
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const paste = new win.Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData?: { getData: (type: string) => string };
    };
    paste.clipboardData = {
      getData(type: string) {
        return type === "text/plain" ? " Pasted rich text" : "<span style='color:red'>Pasted rich text</span>";
      },
    };
    paragraph.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(paragraph.textContent).toContain("Pasted rich text");
    expect(paragraph.innerHTML).not.toContain("span");
    expect(paragraph.innerHTML).not.toContain("color:red");
  });
});

describe("rich text editing commands", () => {
  it("wraps and unwraps selected text with semantic inline tags", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    selectSubstring(win, paragraph, "Alpha");
    postCommand(win, { command: "format-inline", action: "bold" });

    const strong = paragraph.querySelector("strong");
    expect(strong?.textContent).toBe("Alpha");

    selectSubstring(win, paragraph, "Alpha");
    postCommand(win, { command: "format-inline", action: "bold" });

    expect(paragraph.querySelector("strong")).toBeNull();

    selectSubstring(win, paragraph, "bravo");
    postCommand(win, { command: "format-inline", action: "italic" });

    expect(paragraph.querySelector("em")?.textContent).toBe("bravo");
  });

  it("creates, edits, removes, and validates links", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    selectSubstring(win, paragraph, "bravo");
    postCommand(win, { command: "format-inline", action: "create-link", href: "javascript:alert(1)" });
    expect(paragraph.querySelector("a")).toBeNull();

    postCommand(win, { command: "format-inline", action: "create-link", href: "https://example.com/demo" });
    const link = paragraph.querySelector("a");
    expect(link?.textContent).toBe("bravo");
    expect(link?.getAttribute("href")).toBe("https://example.com/demo");

    selectSubstring(win, paragraph, "bravo");
    postCommand(win, { command: "format-inline", action: "create-link", href: "/updated" });
    expect(paragraph.querySelector("a")?.getAttribute("href")).toBe("/updated");

    selectSubstring(win, paragraph, "bravo");
    postCommand(win, { command: "format-inline", action: "remove-link" });
    expect(paragraph.querySelector("a")).toBeNull();
  });

  it("uses Enter as a line break inside editable text", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    const text = paragraph.firstChild as Text;
    const range = win.document.createRange();
    range.setStart(text, "Alpha".length);
    range.collapse(true);
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const enter = keydown(win, paragraph, "Enter");

    expect(enter.defaultPrevented).toBe(true);
    expect(paragraph.querySelectorAll("br")).toHaveLength(1);
    expect(paragraph.querySelector("div, p")).toBeNull();
  });

  it("toggles a text element into a list and back", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    postCommand(win, { command: "format-inline", action: "toggle-list" });

    const list = win.document.querySelector("section.slide ul");
    const item = list?.querySelector("li");
    expect(item?.textContent).toBe("Alpha bravo charlie");
    expect(item?.getAttribute("data-wysiwyg-selected")).toBe("true");

    postCommand(win, { command: "format-inline", action: "toggle-list" });

    const restored = win.document.querySelector("section.slide p");
    expect(win.document.querySelector("section.slide ul")).toBeNull();
    expect(restored?.textContent).toBe("Alpha bravo charlie");
  });

  it("round-trips inline markup through clean export", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    selectSubstring(win, paragraph, "Alpha");
    postCommand(win, { command: "format-inline", action: "bold" });
    selectSubstring(win, paragraph, "charlie");
    postCommand(win, { command: "format-inline", action: "create-link", href: "https://example.com/charlie" });

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);

    expect(cleaned).toContain("<strong>Alpha</strong>");
    expect(cleaned).toContain('<a href="https://example.com/charlie">charlie</a>');
    expect(cleaned).not.toContain("data-wysiwyg-");
    expect(cleaned).not.toContain("contenteditable");
  });
});

describe("caret placement", () => {
  it("uses caretRangeFromPoint on first text-mode click", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    const text = paragraph.firstChild as Text;
    const range = win.document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    let calledWith: [number, number] | null = null;
    (win.document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range }).caretRangeFromPoint =
      (x: number, y: number) => {
        calledWith = [x, y];
        return range;
      };

    doubleClick(win, paragraph, { clientX: 42, clientY: 9 });

    expect(calledWith).toEqual([42, 9]);
    expect(win.getSelection()?.anchorNode).toBe(text);

    calledWith = null;
    doubleClick(win, paragraph, { clientX: 8, clientY: 3 });
    expect(calledWith).toBeNull();
  });
});

describe("deck detection", () => {
  it("detects reveal.js leaf sections without duplicating stack parents", () => {
    const { win, messages } = createWindow(REVEAL_DECK_HTML);
    installKeyboardFence(win);
    installEditorBridge(win);
    const deckMessage = messages.find((message) => message.type === "wysiwyg-deck");

    expect(deckMessage.slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Horizontal One",
      "Vertical Two A",
      "Vertical Two B",
    ]);
  });

  it("publishes sanitized slide thumbnails for the timeline", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><head><title>Thumbs</title></head><body>
        <section class="slide" data-title="Thumb"><h2 onclick="bad()">Thumb</h2><script>bad()</script><p data-wysiwyg-id="x">Body</p></section>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);
    const deck = latestDeckMessage(messages);
    const thumbnail = deck.slides[0].thumbnailHtml;

    expect(thumbnail).toContain("<h2>Thumb</h2>");
    expect(thumbnail).toContain("Body");
    expect(thumbnail).not.toContain("<script");
    expect(thumbnail).not.toContain("onclick");
    expect(thumbnail).not.toContain("data-wysiwyg-id");
  });

  it("republishes an inferred deck when force timeline is enabled", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><body><main>
        <div class="report-block"><h1>Opening Position</h1><p>Liquidity controls and beginning balances for the operating review.</p></div>
        <div class="report-block"><h1>Regulatory Lineage</h1><p>Rule mapping, data freshness, and exception history for the daily packet.</p></div>
        <div class="report-block"><h1>Closeout Actions</h1><p>Owners, checkpoints, and next-cycle evidence requirements for the team.</p></div>
      </main></body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);

    expect(latestDeckMessage(messages).slides).toEqual([]);

    postCommand(win, { command: "set-force-timeline", enabled: true });

    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Opening Position",
      "Regulatory Lineage",
      "Closeout Actions",
    ]);
  });

  it("republishes visual inferred slides when force timeline is enabled", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><body><main id="deck-canvas">
        <div id="visual-a" aria-label="Opening visual" class="plate-a" style="width: 1280px; height: 720px; background-image: url(opening.png);"></div>
        <div id="visual-b" aria-label="Risk visual" class="plate-b" style="width: 1280px; height: 720px; background: linear-gradient(#123, #456);"></div>
        <div id="visual-c" aria-label="Closeout visual" class="plate-c" style="width: 1280px; height: 720px; background-color: #f8fafc; border: 1px solid #94a3b8;"></div>
      </main></body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);

    expect(latestDeckMessage(messages).slides).toEqual([]);

    postCommand(win, { command: "set-force-timeline", enabled: true });

    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Opening visual",
      "Risk visual",
      "Closeout visual",
    ]);
  });

  it("uses an explicit CSS selector when automatic detection is insufficient", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><body><main>
        <article class="canvas-page"><h1>Custom one</h1></article>
        <article class="canvas-page"><h1>Custom two</h1></article>
        <aside class="canvas-page-note">Not a page</aside>
      </main></body></html>
    `);
    installEditorBridge(win);
    expect(latestDeckMessage(messages).slides).toEqual([]);

    postCommand(win, { command: "set-deck-selector", selector: ".canvas-page" });

    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Custom one",
      "Custom two",
    ]);
  });

  it("promotes selected siblings and publishes a restorable structural path", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><body><main><div class="wrapper">
        <article><h1>Sibling one</h1></article>
        <article id="picked"><h1>Sibling two</h1></article>
        <article><h1>Sibling three</h1></article>
      </div></main></body></html>
    `);
    installEditorBridge(win);
    const picked = win.document.getElementById("picked")!;
    picked.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

    postCommand(win, { command: "set-deck-from-selection" });

    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Sibling one",
      "Sibling two",
      "Sibling three",
    ]);
    const preference = messages.filter((message) => message.type === "wysiwyg-deck-preference").at(-1);
    expect(preference.siblingPath).toEqual([1, 0, 0]);

    postCommand(win, { command: "clear-deck-override" });
    expect(latestDeckMessage(messages).slides).toEqual([]);
    postCommand(win, { command: "set-deck-from-selection", siblingPath: preference.siblingPath });
    expect(latestDeckMessage(messages).slides).toHaveLength(3);
  });

  it("reports invalid manual selectors without breaking the bridge", () => {
    const { win, messages } = createWindow("<!doctype html><html><body><main><p>Body</p></main></body></html>");
    installEditorBridge(win);

    postCommand(win, { command: "set-deck-selector", selector: "[invalid" });

    expect(latestDeckMessage(messages).slides).toEqual([]);
    expect(messages.some((message) => message.diagnostic?.code === "deck-selector-invalid")).toBe(true);
  });

  it("uses persisted structural paths for individually marked pages", () => {
    const { win, messages } = createWindow(`<!doctype html><html><body><main>
      <article><h1>Marked one</h1></article><aside>Ignored</aside><article><h1>Marked two</h1></article>
    </main></body></html>`);
    installEditorBridge(win);
    postCommand(win, { command: "set-deck-marked", paths: [[1, 0, 0], [1, 0, 2]] });
    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Marked one", "Marked two",
    ]);
  });

  it("republishes a deck when slides are inserted after bridge startup", async () => {
    vi.useFakeTimers();
    const { win, messages } = createWindow("<main id='deck'></main>");
    installKeyboardFence(win);
    installEditorBridge(win);
    expect(latestDeckMessage(messages)?.slides).toEqual([]);
    const deck = win.document.querySelector("#deck");
    deck?.insertAdjacentHTML(
      "beforeend",
      '<section class="slide"><h1>Late one</h1></section><section class="slide"><h1>Late two</h1></section>',
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(130);
    expect(latestDeckMessage(messages)?.slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Late one",
      "Late two",
    ]);
    vi.useRealTimers();
  });
});

describe("document outline and ancestor selection", () => {
  const outlineHtml = `<!doctype html><html><body><main id="workspace"><section class="card"><div class="inner"><button id="target">Edit me</button></div></section></main></body></html>`;

  it("publishes the full document hierarchy rather than only selected siblings", () => {
    const { win, messages } = createWindow(outlineHtml);
    installEditorBridge(win);

    const outline = latestOutlineMessage(messages);
    expect(outline.truncated).toBe(false);
    expect(outline.items.map((item: { label: string }) => item.label)).toEqual([
      "body",
      "main#workspace",
      "section.card",
      "div.inner",
      "button#target",
    ]);
    expect(outline.items.map((item: { depth: number }) => item.depth)).toEqual([0, 0, 1, 2, 3]);
  });

  it("cycles from a clicked leaf through its ancestors with Alt-click", () => {
    const { win, messages } = createWindow(outlineHtml);
    installEditorBridge(win);
    const target = win.document.getElementById("target")!;

    click(win, target);
    expect(messages.filter((message) => message.type === "wysiwyg-selection").at(-1).selected.tagName).toBe("button");
    click(win, target, { altKey: true });
    expect(messages.filter((message) => message.type === "wysiwyg-selection").at(-1).selected.tagName).toBe("div");
    click(win, target, { altKey: true });
    expect(messages.filter((message) => message.type === "wysiwyg-selection").at(-1).selected.tagName).toBe("section");
  });

  it("supports editor-only hide and lock controls without contaminating export", () => {
    const { win, messages } = createWindow(outlineHtml);
    installEditorBridge(win);
    const outline = latestOutlineMessage(messages);
    const card = outline.items.find((item: { label: string }) => item.label === "section.card");

    postCommand(win, { command: "set-outline-hidden", id: card.id, enabled: true });
    postCommand(win, { command: "set-outline-locked", id: card.id, enabled: true });
    postCommand(win, { command: "set-picking-ignored", id: card.id, enabled: true });

    const cardElement = win.document.querySelector("section.card")!;
    expect(cardElement.getAttribute("data-wysiwyg-editor-hidden")).toBe("true");
    expect(cardElement.getAttribute("data-wysiwyg-editor-locked")).toBe("true");
    expect(cardElement.getAttribute("data-wysiwyg-editor-pick-through")).toBe("true");
    const updated = latestOutlineMessage(messages).items.find((item: { id: string }) => item.id === card.id);
    expect(updated).toMatchObject({ hidden: true, locked: true, pickThrough: true });

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).not.toContain("data-wysiwyg-editor-hidden");
    expect(cleaned).not.toContain("data-wysiwyg-editor-locked");
    expect(cleaned).not.toContain("data-wysiwyg-editor-pick-through");
  });

  it("explains unsupported direct-edit targets", () => {
    const { win, messages } = createWindow("<!doctype html><html><body><canvas id='chart'></canvas></body></html>");
    installEditorBridge(win);
    doubleClick(win, win.document.getElementById("chart")!);
    expect(messages.some((message) => message.diagnostic?.code === "unsupported-edit-target")).toBe(true);
  });
});

describe("bridge session isolation", () => {
  it("tags outbound messages and ignores missing or incorrect command tokens", () => {
    const { win, messages } = createWindow("<!doctype html><html><body><button id='target'>Target</button></body></html>");
    installEditorBridge(win, "correct-token");
    const target = latestOutlineMessage(messages).items.find((item: { label: string }) => item.label === "button#target");

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.sessionToken === "correct-token")).toBe(true);

    postCommand(win, { command: "select", id: target.id });
    postCommand(win, { command: "select", id: target.id }, "wrong-token");
    expect(messages.some((message) => message.type === "wysiwyg-selection")).toBe(false);

    postCommand(win, { command: "select", id: target.id }, "correct-token");
    expect(messages.filter((message) => message.type === "wysiwyg-selection").at(-1).selected.tagName).toBe("button");
  });

  it("rejects malformed current-session commands without mutating the document", () => {
    const { win, messages } = createWindow("<!doctype html><html><body><p id='target'>Original</p></body></html>");
    installEditorBridge(win, "correct-token");
    const target = latestOutlineMessage(messages).items.find((item: { label: string }) => item.label === "p#target");
    postCommand(win, { command: "select", id: target.id }, "correct-token");
    messages.length = 0;

    postCommand(win, { command: "set-text", text: 7 }, "correct-token");
    postCommand(win, { command: "request-html", unexpected: true }, "correct-token");

    expect(win.document.getElementById("target")?.textContent).toBe("Original");
    expect(messages.filter((message) => message.diagnostic?.code === "bridge-message-rejected")).toHaveLength(2);
    expect(messages.some((message) => message.type === "wysiwyg-document-change")).toBe(false);
  });

  it("includes the session token in fenced keyboard shortcuts", () => {
    const { win, messages } = createWindow("<!doctype html><html><body><p>Body</p></body></html>");
    installKeyboardFence(win, "shortcut-token");
    keydown(win, win.document.body, "s", { ctrlKey: true });
    expect(messages.at(-1)).toMatchObject({
      type: "wysiwyg-shortcut",
      action: "save",
      sessionToken: "shortcut-token",
    });
  });
});

describe("slide management commands", () => {
  it("renames a slide title and first heading", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];

    postCommand(win, { command: "rename-slide", id: firstSlide.id, title: "Renamed Slide" });

    const section = win.document.querySelector("section.slide");
    expect(section?.getAttribute("data-title")).toBe("Renamed Slide");
    expect(section?.querySelector("h2")?.textContent).toBe("Renamed Slide");
    expect(latestDeckMessage(messages).slides[0].title).toBe("Renamed Slide");
  });

  it("moves a slide by offset and republishes deck order", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];

    postCommand(win, { command: "move-slide", id: firstSlide.id, offset: 1 });

    const titles = Array.from(win.document.querySelectorAll("section.slide > h2")).map(
      (heading) => heading.textContent,
    );
    expect(titles).toEqual(["Slide Two", "Slide One", "Slide Three"]);
    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Two",
      "One",
      "Three",
    ]);
  });

  it("deletes a slide and activates a neighbor", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];

    postCommand(win, { command: "delete-slide", id: firstSlide.id });

    expect(win.document.querySelectorAll("section.slide")).toHaveLength(2);
    expect(latestDeckMessage(messages).slides.map((slide: { title: string }) => slide.title)).toEqual([
      "Two",
      "Three",
    ]);
    expect(win.document.querySelector("section.slide")?.getAttribute("data-wysiwyg-current-slide")).toBe("true");
  });
});

describe("slide template commands", () => {
  it.each([
    ["title", "Presentation title", "h1", 1],
    ["section", "Section divider", "h2", 1],
    ["quote", "Quote", "figure blockquote", 1],
    ["image-text", "Image and text", ".media-layout img", 1],
    ["metrics", "Metrics", ".metrics .metric", 3],
    ["agenda", "Agenda", "ol li", 4],
    ["closing", "Closing", "h2", 1],
  ])("inserts a %s template as the active next slide", (template, title, selector, count) => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];

    postCommand(win, { command: "insert-slide-template", id: firstSlide.id, template });

    const inserted = win.document.querySelector(`section.slide[data-title="${title}"]`) as Element | null;
    expect(inserted).not.toBeNull();
    expect(inserted?.querySelectorAll(selector)).toHaveLength(count);
    expect(inserted?.textContent).not.toContain("Slide One");
    expect(inserted?.textContent).not.toContain("Alpha bravo charlie");

    const deck = latestDeckMessage(messages);
    expect(deck.slides.map((slide: { title: string }) => slide.title)).toContain(title);
    expect(deck.activeId).toBe(inserted?.getAttribute("data-wysiwyg-id"));
    expect(inserted?.getAttribute("data-wysiwyg-current-slide")).toBe("true");
  });

  it("exports template slides without adding duplicate style blocks", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];

    postCommand(win, { command: "insert-slide-template", id: firstSlide.id, template: "metrics" });

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).toContain('data-title="Metrics"');
    expect(cleaned).toContain('<section class="metrics">');
    expect(cleaned).not.toContain("data-wysiwyg-");
    expect(cleaned.match(/<style/g)?.length ?? 0).toBe(1);
  });
});

describe("element insertion commands", () => {
  it.each([
    ["heading", "h2", "New heading"],
    ["paragraph", "p", "Add your text here."],
    ["image", "img", null],
    ["button", "button", "Button"],
    ["box", "div", "New box"],
  ])("inserts a %s primitive into the current slide", (kind, selector, text) => {
    const { win, messages } = installBridgeWithHostileDeck();

    postCommand(win, { command: "insert-element", kind });

    const inserted = win.document.querySelector("[data-wysiwyg-selected]");
    expect(inserted).toBeTruthy();
    expect(inserted?.matches(selector)).toBe(true);
    if (text !== null) expect(inserted?.textContent).toBe(text);
    expect(inserted?.getAttribute("data-wysiwyg-selected")).toBe("true");
    expect(messages.some((message) => message.type === "wysiwyg-document-change" && message.reason === "insert-element")).toBe(
      true,
    );
    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).not.toContain("data-wysiwyg-");
    expect(cleaned).toContain(text ?? "Placeholder image");
  });
});

describe("resize and layout controls", () => {
  it("resizes the selected element from the editor handle", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as HTMLElement;
    paragraph.style.width = "100px";
    paragraph.style.height = "50px";

    click(win, paragraph);
    const handle = win.document.querySelector("[data-wysiwyg-resize-handle]") as HTMLElement | null;
    expect(handle).not.toBeNull();

    pointer(win, handle as HTMLElement, "pointerdown", 10, 10);
    pointer(win, win.document, "pointermove", 35, 25);
    pointer(win, win.document, "pointerup", 35, 25);

    expect(paragraph.style.width).toBe("125px");
    expect(paragraph.style.height).toBe("65px");
    expect(messages).toContainEqual(expect.objectContaining({ type: "wysiwyg-document-change", reason: "resize" }));

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).not.toContain("wysiwyg-resize-handle");
  });

  it("aligns the selected element within its parent", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as HTMLElement;
    click(win, paragraph);

    postCommand(win, { command: "layout", action: "align-center" });

    expect(paragraph.style.display).toBe("block");
    expect(paragraph.style.marginLeft).toBe("auto");
    expect(paragraph.style.marginRight).toBe("auto");
    expect(messages).toContainEqual(expect.objectContaining({ type: "wysiwyg-document-change", reason: "layout" }));
  });

  it("distributes selected element siblings through the parent", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as HTMLElement;
    const slide = paragraph.closest("section.slide") as HTMLElement;
    click(win, paragraph);

    postCommand(win, { command: "layout", action: "distribute-horizontal" });

    expect(slide.style.display).toBe("flex");
    expect(slide.style.justifyContent).toBe("space-between");
    expect(slide.style.gap).toBe("16px");
  });
});

describe("snap guides and layers", () => {
  it("shows center snap guides when a move drag reaches parent center", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as HTMLElement;
    const slide = paragraph.closest("section.slide") as HTMLElement;
    stubRect(slide, { left: 0, top: 0, width: 200, height: 200 });
    stubRect(paragraph, { left: 40, top: 40, width: 20, height: 20 });

    postCommand(win, { command: "set-mode", mode: "move" });
    pointer(win, paragraph, "pointerdown", 0, 0);
    pointer(win, win.document, "pointermove", 50, 50);

    const vertical = win.document.querySelector("[data-wysiwyg-snap-guide='vertical']") as HTMLElement;
    const horizontal = win.document.querySelector("[data-wysiwyg-snap-guide='horizontal']") as HTMLElement;
    expect(vertical.style.display).toBe("block");
    expect(horizontal.style.display).toBe("block");
    expect(vertical.style.left).toBe("100px");
    expect(horizontal.style.top).toBe("100px");

    pointer(win, win.document, "pointerup", 50, 50);
    expect(vertical.style.display).toBe("none");
    expect(horizontal.style.display).toBe("none");
  });

  it("brings the selected element forward and republishes layer order", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><head><title>Layers</title></head><body>
        <section class="slide" data-title="Layers">
          <p id="first">First</p>
          <p id="second" style="z-index: 2">Second</p>
        </section>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);
    const first = win.document.getElementById("first") as HTMLElement;
    click(win, first);

    postCommand(win, { command: "z-order", action: "bring-forward" });

    expect(first.style.position).toBe("relative");
    expect(first.style.zIndex).toBe("3");
    const layers = latestLayersMessage(messages).layers;
    expect(layers.some((layer: { label: string; active: boolean }) => layer.label === "p#first" && layer.active)).toBe(
      true,
    );
  });
});

describe("image and background controls", () => {
  it("sets image alt text and object fit modes", () => {
    const { win } = createWindow(`
      <!doctype html><html><head><title>Images</title></head><body>
        <section class="slide" data-title="Image slide">
          <img id="hero" src="old.png" alt="Old alt" style="width: 100px; height: 80px" />
        </section>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);
    const image = win.document.getElementById("hero") as HTMLImageElement;

    click(win, image);
    postCommand(win, { command: "replace-image", src: "new.png", alt: "Updated alt" });
    postCommand(win, { command: "set-image-fit", fit: "fit" });
    expect(image.getAttribute("src")).toBe("new.png");
    expect(image.getAttribute("alt")).toBe("Updated alt");
    expect(image.style.objectFit).toBe("contain");

    postCommand(win, { command: "set-image-fit", fit: "fill" });
    expect(image.style.objectFit).toBe("fill");

    postCommand(win, { command: "set-image-fit", fit: "crop" });
    expect(image.style.objectFit).toBe("cover");
    expect(image.style.objectPosition).toBe("center");
  });

  it("replaces slide and body background images", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];
    postCommand(win, { command: "select", id: firstSlide.id });
    postCommand(win, { command: "replace-background", src: "https://example.com/slide.png" });

    const slide = win.document.querySelector("section.slide") as HTMLElement;
    expect(slide.style.backgroundImage).toContain("https://example.com/slide.png");
    expect(slide.style.backgroundSize).toBe("cover");
    expect(slide.style.backgroundPosition).toBe("center");

    const plain = createWindow("<main><p>Plain page</p></main>");
    installKeyboardFence(plain.win);
    installEditorBridge(plain.win);
    postCommand(plain.win, { command: "replace-background", src: "https://example.com/body.png" });
    expect(plain.win.document.body.style.backgroundImage).toContain("https://example.com/body.png");
  });

  it("marks broken images for audit without exporting the marker", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><head><title>Broken</title></head><body>
        <img id="broken" src="missing.png" alt="Broken" />
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);
    const image = win.document.getElementById("broken") as HTMLImageElement;

    image.dispatchEvent(new win.Event("error", { bubbles: true, cancelable: true }));
    postCommand(win, { command: "request-audit" });

    expect(image.getAttribute("data-cosmic-image-error")).toBe("true");
    expect(latestAuditMessage(messages).findings.map((finding: { type: string }) => finding.type)).toContain(
      "broken-image",
    );

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).not.toContain("data-cosmic-image-error");
  });
});

describe("theme controls", () => {
  it("sets the root font and swaps exact inline palette values", () => {
    const { win } = createWindow(`
      <!doctype html><html style="--brand: #111111; color: #111111"><head><title>Theme</title></head><body>
        <section class="slide" data-title="Theme" style="border-color: #111111; outline-color: #333333">
          <p id="copy" style="color: #111111">Copy</p>
        </section>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);

    postCommand(win, { command: "set-theme-font", fontFamily: "Georgia, serif" });
    expect(win.document.documentElement.style.fontFamily).toBe("Georgia, serif");

    postCommand(win, { command: "swap-theme-color", from: "#111111", to: "#2266aa" });

    expect(win.document.documentElement.getAttribute("style")).toContain("#2266aa");
    expect(win.document.querySelector("section.slide")?.getAttribute("style")).toContain("#2266aa");
    expect(win.document.getElementById("copy")?.getAttribute("style")).toContain("#2266aa");
    expect(win.document.querySelector("section.slide")?.getAttribute("style")).toContain("#333333");
  });

  it("sets the current slide background color", () => {
    const { win, messages } = installBridgeWithHostileDeck();
    const firstSlide = latestDeckMessage(messages).slides[0];
    postCommand(win, { command: "select", id: firstSlide.id });
    postCommand(win, { command: "set-slide-background", color: "#123456" });

    const slide = win.document.querySelector("section.slide") as HTMLElement;
    expect(slide.style.backgroundColor).toBe("rgb(18, 52, 86)");
  });
});

describe("data chart insertion", () => {
  it("inserts a proportional inline SVG bar chart with axis labels", () => {
    const { win } = installBridgeWithHostileDeck();

    postCommand(win, {
      command: "insert-chart",
      chartType: "bar",
      title: "Revenue chart",
      columns: ["Quarter", "Revenue"],
      rows: [
        ["Q1", "10"],
        ["Q2", "20"],
      ],
    });

    const figure = win.document.querySelector(".cosmic-chart-block[data-chart-type='bar']") as HTMLElement;
    const bars = Array.from(figure.querySelectorAll("rect.cosmic-chart-bar"));
    expect(figure.querySelector("figcaption")?.textContent).toBe("Revenue chart");
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute("height")).toBe("125");
    expect(bars[1].getAttribute("height")).toBe("250");
    expect(figure.textContent).toContain("Quarter");
    expect(figure.textContent).toContain("Revenue");

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).toContain("<svg");
    expect(cleaned).toContain("cosmic-chart-bar");
    const cleanedChart = cleaned.match(/<figure class="cosmic-chart-block"[\s\S]*?<\/figure>/)?.[0] || "";
    expect(cleanedChart).not.toContain("<script");
    expect(cleanedChart).not.toContain("<img");
    expect(cleanedChart).not.toContain("src=");
    expect(cleanedChart).not.toContain("href=");
  });

  it.each([
    ["line", ".cosmic-chart-line"],
    ["pie", ".cosmic-chart-slice"],
  ])("inserts a %s chart variant", (chartType, selector) => {
    const { win } = installBridgeWithHostileDeck();

    postCommand(win, {
      command: "insert-chart",
      chartType,
      title: "Variant chart",
      columns: ["Segment", "Count"],
      rows: [
        ["A", "4"],
        ["B", "6"],
      ],
    });

    const figure = win.document.querySelector(`.cosmic-chart-block[data-chart-type='${chartType}']`) as HTMLElement;
    expect(figure).not.toBeNull();
    expect(figure.querySelectorAll(selector).length).toBeGreaterThan(0);
    expect(figure.querySelector("svg")?.getAttribute("role")).toBe("img");
  });
});

describe("find and replace", () => {
  it("highlights rendered text matches and unwraps highlights on export", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><head><title>Find</title></head><body>
        <main><p>Alpha beta Alpha</p><a href="/Alpha">Alpha link</a></main>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);

    postCommand(win, { command: "find-text", query: "Alpha" });

    expect(latestFindMessage(messages)).toMatchObject({ query: "Alpha", count: 3 });
    expect(win.document.querySelectorAll("mark[data-wysiwyg-find]")).toHaveLength(3);

    const cleaned = cleanEditorHtml("<!doctype html>\n" + win.document.documentElement.outerHTML);
    expect(cleaned).toContain("Alpha beta Alpha");
    expect(cleaned).not.toContain("data-wysiwyg-find");
  });

  it("replaces text nodes without touching attributes", () => {
    const { win } = createWindow(`
      <!doctype html><html><head><title>Replace</title></head><body>
        <main><p>Alpha beta Alpha</p><a id="link" href="/Alpha">Alpha link</a></main>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);

    postCommand(win, { command: "replace-text", query: "Alpha", replacement: "Omega" });

    expect(win.document.body.textContent).toContain("Omega beta Omega");
    expect(win.document.body.textContent).not.toContain("Alpha link");
    expect(win.document.getElementById("link")?.getAttribute("href")).toBe("/Alpha");
  });
});

describe("validation audit", () => {
  it("reports document quality findings with selectable element ids", () => {
    const { win, messages } = createWindow(`
      <!doctype html><html><head><title>Audit</title></head><body>
        <img id="broken" src="" />
        <p id="tiny" style="font-size: 10px">Small</p>
        <div id="overflow">Overflow</div>
        <script data-wysiwyg-preserved-script="true" type="text/plain">console.log("x")</script>
      </body></html>
    `);
    installKeyboardFence(win);
    installEditorBridge(win);

    const overflow = win.document.getElementById("overflow") as HTMLElement;
    Object.defineProperty(overflow, "scrollWidth", { configurable: true, value: 120 });
    Object.defineProperty(overflow, "clientWidth", { configurable: true, value: 20 });
    postCommand(win, { command: "request-audit" });

    const audit = latestAuditMessage(messages);
    const types = audit.findings.map((finding: { type: string }) => finding.type);

    expect(types).toContain("broken-image");
    expect(types).toContain("missing-alt");
    expect(types).toContain("tiny-font");
    expect(types).toContain("overflow");
    expect(types).toContain("inert-script");
    expect(audit.findings.every((finding: { elementId: string }) => finding.elementId)).toBe(true);

    const missingAlt = audit.findings.find((finding: { type: string }) => finding.type === "missing-alt");
    postCommand(win, { command: "select", id: missingAlt.elementId });
    expect(win.document.getElementById("broken")?.getAttribute("data-wysiwyg-selected")).toBe("true");
  });

  it("reports zero findings for the clean sample document", () => {
    const { win, messages } = createWindow(SAMPLE_HTML);
    installKeyboardFence(win);
    installEditorBridge(win);

    expect(latestAuditMessage(messages).findings).toEqual([]);
  });
});
