import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { HOSTILE_DECK_HTML, installHostileDeckNavigation, REVEAL_DECK_HTML } from "../fixtures/hostileDeck";
import { cleanEditorHtml, prepareEditableHtml, SAMPLE_HTML } from "../htmlDocument";
import {
  canDirectlyEditTextElement,
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

function postCommand(win: TestWindow, command: Record<string, unknown>) {
  win.dispatchEvent(
    new win.MessageEvent("message", {
      data: { type: "wysiwyg-command", ...command },
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

function latestDeckMessage(messages: any[]) {
  return messages.filter((message) => message.type === "wysiwyg-deck").at(-1);
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

    click(win, paragraph as Element);
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
    click(win, paragraph);
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

    click(win, paragraph);
    const undo = keydown(win, paragraph, "z", { ctrlKey: true });
    expect(undo.defaultPrevented).toBe(false);
    expect(messages).not.toContainEqual({ type: "wysiwyg-shortcut", action: "undo" });

    postCommand(win, { command: "set-mode", mode: "select" });
    keydown(win, win.document.body, "z", { ctrlKey: true });
    expect(messages).toContainEqual({ type: "wysiwyg-shortcut", action: "undo" });
  });
});

describe("editor key semantics", () => {
  it("nudges only in Move mode", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as HTMLElement;
    click(win, paragraph);

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
    click(win, paragraph);

    keydown(win, paragraph, "Backspace");
    expect(win.document.getElementById("editable")).not.toBeNull();

    postCommand(win, { command: "set-mode", mode: "select" });
    keydown(win, win.document.body, "Backspace");
    expect(win.document.getElementById("editable")).toBeNull();
    expect(win.__deckKeysSeen).toEqual([]);
  });

  it("treats Escape as an editing ladder", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;
    click(win, paragraph);

    keydown(win, paragraph, "Escape");
    expect(paragraph.hasAttribute("contenteditable")).toBe(false);
    expect(paragraph.getAttribute("data-wysiwyg-selected")).toBe("true");

    keydown(win, win.document.body, "Escape");
    expect(paragraph.hasAttribute("data-wysiwyg-selected")).toBe(false);
  });
});

describe("editing polish", () => {
  it("marks focused editing state and restores spellcheck/contenteditable metadata", () => {
    const { win } = installBridgeWithHostileDeck();
    const paragraph = win.document.getElementById("editable") as Element;

    click(win, paragraph);

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
    click(win, paragraph);

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

    click(win, paragraph, { clientX: 42, clientY: 9 });

    expect(calledWith).toEqual([42, 9]);
    expect(win.getSelection()?.anchorNode).toBe(text);

    calledWith = null;
    click(win, paragraph, { clientX: 8, clientY: 3 });
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
