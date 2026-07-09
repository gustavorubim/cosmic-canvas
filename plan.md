# Cosmic Canvas — Fix & Enhancement Plan

This plan is written so a coding agent can implement each item and **verify it against
explicit acceptance criteria**. Every item has a *Verify* block: automated checks run with
the existing toolchain (`vitest` + `jsdom`), plus manual checks where browser behavior
cannot be simulated. An item is DONE only when every checkbox in its Verify block passes.

## Global verification gates

Run after every item; all must pass before an item can be marked complete:

```bash
npm test          # vitest run — all suites green, including new ones added by the item
npm run build     # tsc --noEmit && vite build — no type errors, bundle builds
```

Manual smoke (for items touching the canvas): `npm run dev`, load the sample document,
click a paragraph in Text mode, type a multi-word sentence with Backspace corrections.

### Shared test fixture: the hostile deck

Several items verify against `src/fixtures/hostileDeck.ts` (create in item F1). It is an
HTML string containing:

- Three slides matching `SLIDE_SELECTOR` (`<section class="slide">`), each with an `h2`
  and a `p`.
- A deck script that binds, on **both** `document` (bubble) and `window` (capture):
  `Space` → next slide, `Backspace` → previous slide, `ArrowLeft`/`ArrowRight` → prev/next,
  `PageUp`/`PageDown`/`Home`/`End` → navigation. Every handler calls `preventDefault()`
  and records each key it receives into `window.__deckKeysSeen` (an array) and the current
  slide index into `window.__deckSlideIndex`.
- One `<input type="text">` and one `<a href>` inside slide 2.

This mimics the worst-case real presentation: handlers that never check for editable
targets and that register before the editor bridge.

---

# Part A — Bug fixes (do in order)

## F1. Extract the editor bridge from the string IIFE (test prerequisite)

**Problem.** `EDITOR_SCRIPT` in `src/htmlDocument.ts:190` is a ~700-line string. Its logic
cannot be type-checked or unit-tested, which blocks every regression test below.

**Change.**
- Move the bridge to `src/bridge/editorBridge.ts` as real TypeScript.
- Inject compiled browser JavaScript, not raw TypeScript with type annotations. Use either
  a small build step that emits the compiled bridge source string, or keep the injectable
  source as JS-compatible runtime code that imports shared typed helpers. If using Vite
  `?raw`, add the needed module declaration and verify the raw string is executable JS.
  Injected behavior must be byte-for-byte equivalent in effect (same messages, same commands).
- Export an `installEditorBridge(win: Window & typeof globalThis)` entry point so tests can
  install it into a jsdom window directly.

**Verify.**
- [ ] `src/htmlDocument.ts` no longer contains the bridge logic inline (grep: no
      `function selectElement` inside `htmlDocument.ts`).
- [ ] New test `src/bridge/editorBridge.test.ts` installs the bridge into a jsdom document
      built from `SAMPLE_HTML` and asserts a `wysiwyg-ready` message is posted to the parent.
- [ ] The injected `<script>` text contains no TypeScript-only syntax (`: type`,
      `interface`, `export`, etc.) and executes in a real browser `srcdoc` iframe.
- [ ] `npm run build` output still renders the sample document (manual: dev server, canvas
      loads, clicking selects elements).
- [ ] All existing tests still pass unmodified (`htmlDocument.test.ts`, `csv.test.ts`).

## F2. Keyboard fence — editor owns the keyboard outside Preview mode

**Problem.** The bridge keydown handler (`src/htmlDocument.ts:818`, post-F1:
`editorBridge.ts`) merely `return`s while editing. The event still propagates, so deck
scripts receive Space/Backspace/arrows and navigate slides while the user is typing.
With scripts inert, Space still triggers the browser page-scroll default, which shifts
`nearestSlide` and makes the timeline jump.

**Change.**
- Add a fence: `keydown`, `keypress`, and `keyup` listeners on **`window`, capture phase**.
- Policy:
  | State | Behavior |
  |---|---|
  | Preview mode | Fence inactive. Page scripts and browser defaults untouched. |
  | Text/Select/Move + typing context (see F3) | `stopImmediatePropagation()` so page scripts never see the event. **No** `preventDefault()` — the browser must still insert characters, move the caret, delete text. |
  | Text/Select/Move + NOT typing | Navigation keys (`Space`, `Backspace`, `PageUp`, `PageDown`, `Home`, `End`, arrows) get `stopImmediatePropagation()` **and** `preventDefault()` (kills deck handlers and the Space-scroll default). Editor shortcuts (Escape, Delete, arrows-as-nudge per F6) still run. |
- **Early registration.** In trusted mode `injectEditorBridge` (`src/htmlDocument.ts:1092`)
  injects the bridge before `</body>` — after deck scripts run. Split out a minimal fence
  script injected immediately after the opening `<head>` tag, before all author scripts in
  the head/body. If the document has no head, create one before author script execution.
  The head fence reads mode/typing state from shared globals the main bridge keeps updated
  (e.g. `window.__cosmicFenceState`). The inert-scripts path may keep a single injection
  point but must use the same fence code.
- **Iframe shortcuts.** Do not assume modifier keys in the iframe reach `App.tsx`; they do
  not reliably bubble to the parent window. Add explicit bridge handling/postMessage for
  editor-owned shortcuts from iframe focus: Ctrl/Cmd+S (save), Ctrl/Cmd+Enter (apply),
  and undo/redo when not in a text-editing context. In text-editing context, preserve
  native copy/paste/select-all/text undo semantics except save/apply, which should still
  be forwarded.

**Verify** (in `editorBridge.test.ts` / new `keyboardFence.test.ts`, using the hostile deck):
- [ ] Text mode, element contenteditable and focused: dispatching Space, Backspace,
      ArrowLeft, PageDown keydowns → `window.__deckKeysSeen` stays empty and
      `event.defaultPrevented === false` for Space/Backspace (typing not blocked).
- [ ] Select mode, element selected, nothing focused: Space and PageDown →
      `__deckKeysSeen` empty **and** `defaultPrevented === true`.
- [ ] Preview mode: Space → `__deckKeysSeen` contains `" "` and `__deckSlideIndex`
      advanced (deck still works).
- [ ] Ctrl+S / Cmd+Z dispatched in any mode follows the explicit shortcut policy:
      save/apply are forwarded to the parent, text-editing undo remains native, and
      non-typing undo/redo uses the app history.
- [ ] Ordering: hostile deck registers its `window`-capture handler **before** the bridge
      body script runs, and the fence still wins. A separate fixture with a head script
      also proves the fence is inserted before existing author head scripts.
- [ ] Manual: paste a real deck with Space/Backspace nav, Trusted scripts ON, Text mode —
      type a multi-word sentence with typo corrections; slide never changes. Switch to
      Preview — Space/Backspace navigate again.

## F3. Robust "typing context" detection

**Problem.** `active.getAttribute("contenteditable") === "true"` misses focus nested
inside editable content and misses form fields, so the fence/shortcut policy misfires.

**Change.** Single helper used by the fence and all bridge shortcut handlers:

```ts
function inTypingContext(active: Element | null): boolean {
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  const editable = active.closest("[contenteditable]");
  if (editable instanceof HTMLElement && editable.contentEditable !== "false") return true;
  if (active.matches("textarea, select, [role='textbox'], [role='textbox'] *")) return true;
  if (active instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(active.type);
  }
  return false;
}
```

**Verify.**
- [ ] Unit tests for the helper: contenteditable host → true; element nested inside a
      contenteditable → true; `<input>` in the deck → true; plain `<div>` → false;
      `contenteditable="plaintext-only"` → true; `contenteditable="false"` inside an
      editable ancestor → false; `null` → false.
- [ ] Focus the hostile deck's `<input>`, dispatch Space → character allowed
      (`defaultPrevented === false`), deck sees nothing.
- [ ] Delete key with focus in the `<input>` → the selected element is NOT deleted.

## F4. Caret placement on first click (Text mode)

**Problem.** On the *first* click into an element, it is not yet contenteditable at
mousedown, so the browser never places a caret at the click point; `makeEditable()` +
`focus()` (`src/htmlDocument.ts:445`) then drops the caret at the element start.
(Re-clicks already work — do not "fix" them.)

**Change.** In the click handler (`src/htmlDocument.ts:802`), after `makeEditable`, place
the caret at the click point:

```js
const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  ?? caretPositionToRange(document.caretPositionFromPoint?.(event.clientX, event.clientY));
if (range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
```

Guard for both APIs (WebKit vs Firefox). Only in Text mode, only when the element just
became editable.

**Verify.**
- [ ] Unit test (jsdom): after simulated click on a text element in Text mode, the
      selection anchor node is inside the clicked element (jsdom lacks
      `caretRangeFromPoint`; stub it and assert it is called with the click coordinates
      and its range is applied to the selection).
- [ ] Unit test: re-click on an already-editable element does not call
      `sel.removeAllRanges()` a second time (existing caret untouched).
- [ ] Manual: click mid-word in a paragraph → caret lands where clicked, first time.

## F5. Restrict direct contenteditable to text-bearing elements

**Problem.** `makeEditable()` will make any selected element editable — including whole
slides/sections via breadcrumb or chip selection — making it easy to destroy structure.

**Change.** Only make an element contenteditable when it is "simple text": no element
children, or only inline children (`strong/em/a/span/code/b/i/u/br/small/mark/sub/sup`).
For container elements, selection still works (outline, inspector, styles) but no
contenteditable; the inspector note already explains leaf editing. Use the same predicate
for `publishSelected().editableText` instead of `childElementCount === 0`; otherwise the
inspector and canvas will disagree about what is safely editable. Until E4 lands, inspector
plain-text edits to simple-text elements with inline markup must either be disabled or
clearly flatten by design; do not accidentally destroy inline tags.

**Verify.**
- [ ] Unit tests: `p` with plain text → editable; `p` with `<strong>` child → editable;
      `section.slide` containing `h2` + `p` → selected but `contenteditable` attribute
      absent; `div` with only block children → not editable.
- [ ] Unit: `publishSelected().editableText` follows the same simple-text predicate.
- [ ] Existing round-trip tests still pass (contenteditable restoration untouched).

## F6. Arrow/Delete/Escape semantics

**Problem.** Arrows nudge in every non-Preview mode whenever the editing check fails;
Backspace does nothing on a selected element; Escape is dead while editing.

**Change** (in the bridge keydown handler, all gated on `!inTypingContext(...)`):
- Arrow nudge **only in Move mode** (Alt+Arrows optionally allowed in Select mode).
- In Text/Select mode, arrows when not typing: no nudge (fence still blocks them from
  the deck per F2).
- `Backspace` behaves like `Delete` (delete selected element) when not typing.
- Escape ladder: while typing → exit editing (blur + restore contenteditable), keep the
  element selected; when selected but not typing → clear selection. Escape must run even
  while typing (move its check above the typing early-return).

**Verify.**
- [ ] Move mode + selected: ArrowRight → element's translate x increases by 8 (1 with
      Shift). Text mode + selected, not typing: ArrowRight → transform unchanged.
- [ ] Select mode + selected, not typing: Backspace → element removed from DOM, and the
      deck saw nothing.
- [ ] Typing: Backspace → element NOT removed, character deletion not prevented.
- [ ] Escape while typing → element no longer contenteditable, still has
      `data-wysiwyg-selected`. Second Escape → selection cleared.

## F7. Deck detection: reveal.js structure

**Problem.** `SLIDE_SELECTOR` (`src/htmlDocument.ts:193`) misses the most common framework
format: `.reveal .slides > section`.

**Change.** Add `.reveal .slides > section` (and nested vertical stacks:
`.reveal .slides > section > section`, treating leaf sections as slides) to
`SLIDE_SELECTOR` and `slideCandidates()`. Keep dedupe behavior.

**Verify.**
- [ ] Unit test: a reveal.js-shaped document publishes a `wysiwyg-deck` message listing
      each leaf `section` exactly once, titled from its heading.
- [ ] Unit test: existing formats (`section.slide`, `[data-slide]`) unchanged; a document
      matching both patterns produces no duplicates.

## F8. Hostile-deck regression suite

**Problem.** Nothing prevents the Space/Backspace bug from regressing.

**Change.** Consolidate F2–F7 assertions into `src/bridge/keyboardFence.test.ts` +
`editorBridge.test.ts` against the hostile deck fixture, covering the full matrix:
{Text, Select, Move, Preview} × {typing, not typing} × {Space, Backspace, ArrowRight,
PageDown, Escape, Delete, Ctrl+S}.

**Verify.**
- [ ] The matrix above is table-driven and complete (every combination asserted).
- [ ] `npm test` runs it in CI-conditions (no browser needed).
- [ ] Deliberately reverting the F2 fence (comment out `stopImmediatePropagation`) makes
      at least 4 tests fail — proves the suite actually guards the fix.

## F9. Secondary fixes (each small; verify individually)

| ID | Fix | Verify |
|---|---|---|
| F9a | **Visible editing state**: distinct outline color/style while the selected element is contenteditable-focused, vs merely selected. | Unit: focused editable element gets a distinguishing attribute (e.g. `data-wysiwyg-editing="true"`); blur removes it. Manual: visibly different. |
| F9b | **Plain-text paste** in Text mode: intercept `paste`, insert `text/plain` only. | Unit: dispatch `paste` with HTML clipboard payload → element gains the plain text, no `<span>`/`style` from clipboard. |
| F9c | **Spellcheck**: `spellcheck="true"` set with `makeEditable`, removed on restore/export. | Unit: attribute present while editable; absent from `cleanEditorHtml` output. |
| F9d | **Inspector stale-echo guard**: ignore `wysiwyg-selection` text echoes while the inspector textarea is focused. | Unit (React or handler-level): simulate echo arriving with older text while textarea focused → textarea value keeps the newer draft. |
| F9e | **VS Code edit coalescing**: only push `WorkspaceEdit` on ≥1s typing pause, blur, or save (today: every 250ms, `src/extension.cts:96` / `src/App.tsx:157`). | Unit on debounce helper: 10 rapid changes → 1 host post. Manual in VS Code: type a sentence, one undo step reverts it. |
| F9f | **`beforeunload` guard** in browser build when `sourceDirty`. | Unit: handler returns a truthy value when dirty, undefined when clean, never registered under VS Code. |
| F9g | **Deck hint toast** (once per document) when a deck is detected: "Edit modes type text — use the timeline for slides. Preview runs deck shortcuts." | Unit: first `wysiwyg-deck` with slides → toast shown once; subsequent deck messages → no repeat. |
| F9h | **Review `allow-same-origin`** (`src/App.tsx:652`): drop it in trusted-scripts browser mode, or document in README why it must stay. | Either: sandbox attr excludes `allow-same-origin` when trusted mode is on (+ manual check nothing breaks), or README section explains the residual risk. Grep-verifiable. |

---

# Part B — Enhancements

Positioning rule for all deck features: they must only appear when a deck is detected
(`deckSlides.length > 0`), the same pattern the timeline already uses. A plain page shows
no deck chrome. **Verify (global):** load a non-deck document → none of the deck UI below
is rendered.

## Tier 1 — highest ROI

### E1. Slide management: rename, delete, reorder
New bridge commands `rename-slide`, `delete-slide`, `move-slide` (+ timeline UI: rename on
double-click, drag or up/down buttons to reorder, delete with confirm). Rename sets
`data-title` and the first heading. *Thumbnails intentionally deferred to Tier 3 (E12).*

**Verify.**
- [ ] Unit: `move-slide {id, offset:+1}` swaps DOM order; serialize confirms; deck message
      re-publishes new order.
- [ ] Unit: `delete-slide` removes exactly that slide; active slide moves to a neighbor.
- [ ] Unit: `rename-slide` updates both `data-title` and heading text; export contains both.
- [ ] Undo restores the previous order/slide (history snapshot taken per operation).

### E2. Element insertion
Insert primitives into the selected container / current slide: heading, paragraph, image
(placeholder src + upload flow reuse), button, box (`div`). Styling inherits from context
(no injected CSS beyond what E5-style blocks need).

**Verify.**
- [ ] Unit per primitive: command inserts the element after the selection (or appended to
      the current slide), selects it, publishes a document change.
- [ ] Export contains the new element with no `data-wysiwyg-*` residue.

### E3. Validation panel
New side-panel tab listing: broken images (error event or empty src), missing alt text,
overflowing/clipped text (`scrollWidth > clientWidth + 1`), tiny fonts (< 12px), inert
external scripts present. Each finding clicks through to select the offending element.

**Verify.**
- [ ] Unit: fixture document with one of each defect → bridge audit message reports
      exactly those findings with element ids.
- [ ] Unit: clicking a finding posts `select` with the right id.
- [ ] Clean sample document → zero findings.

### E4. Rich-text controls (the parts not in Part A)
Bold/italic toggles, link create/edit/remove, list toggle, and an explicit Enter policy in
contenteditable (Enter → `<br>` within simple-text elements; document the choice).
Implement with Selection/Range APIs (not `execCommand`) inside the bridge.

**Verify.**
- [ ] Unit: selecting a word and toggling bold wraps it in `<strong>` (and unwraps on
      second toggle); italic ↔ `<em>`.
- [ ] Unit: link editor sets/removes `href`; `javascript:` URLs rejected.
- [ ] Unit: Enter inside a simple-text `p` inserts `<br>`, does not split the slide DOM.
- [ ] Export round-trips the inline markup (no flattening — pairs with F5).

### E5. Slide templates as clone-and-restructure recipes
Recipes clone the current slide (inheriting deck theme) then restructure: title slide,
section divider, quote, image+text, metrics row, agenda, closing. Extends the existing
`prepareNewSlide` pattern (`src/htmlDocument.ts:625`).

**Verify.**
- [ ] Unit per recipe: applied to the sample deck slide, output slide contains the
      recipe's required elements and none of the source slide's leftover content.
- [ ] Inserted slide appears in the deck message and becomes active.
- [ ] No new `<style>` blocks injected except a single shared one (grep export).

### E6. Mode clarity
Make the active mode unmissable: stronger mode badge, canvas border tint per mode, and the
F9g hint. Include the F9a editing indicator.

**Verify.**
- [ ] The canvas container carries `data-mode="<mode>"` and CSS renders distinct visuals.
- [ ] Manual screenshot review across the four modes.

### E7. Resize handles + align/distribute row
Overlay resize handles on the selected element (width/height via style, matching the
existing non-destructive transform philosophy where possible); inspector row for
align-left/center/right within parent and equal-space distribution for siblings.

**Verify.**
- [ ] Unit: drag simulation on the SE handle updates `style.width/height` by the drag delta.
- [ ] Unit: align-center sets expected margin/transform for a positioned child.
- [ ] Escape/undo reverts a resize in one step.

## Tier 2 — next useful layer

### E8. Image & background workflow
`object-fit` (fit/fill/crop) controls, alt-text field, background image replace on
slides/body, broken-URL badge (feeds E3).

**Verify.** Unit per control: command sets the expected attribute/style; alt text appears
in export; broken image (error event) flagged.

### E9. Theme controls (scoped)
Global font family, palette swap (map of old→new colors applied to inline styles +
`:root`), slide background. Explicitly **not** a general stylesheet editor.

**Verify.** Unit: font applied at `:root` level only (single declaration, grep export);
palette swap replaces exact color values and leaves others; undo restores in one step.

### E10. Charts from CSV
Bar/line/pie blocks generated as **inline SVG** from the Data panel (no runtime deps),
following the existing `insertDataTable` pattern (`src/htmlDocument.ts:709`).

**Verify.** Unit: known CSV → SVG with correct bar count/heights proportional to values;
export self-contained (no external refs); axis labels present.

### E11. Export options
(a) Self-contained HTML: inline `<img>` URLs as data URIs (fetch where possible, report
failures). (b) Print-to-PDF stylesheet: one slide per page. (c) Existing clean export
unchanged as default.

**Verify.** Unit: document with a data-URI-able image exports with zero external `src`
attributes; print CSS contains `page-break` rules per slide; default export byte-identical
to pre-change output for the sample document.

### E12. Drafts & recovery upgrade
Replace single `DRAFT_KEY` slot with per-document drafts (keyed by file name/URI + hash),
plus a "recent drafts" list in the open flow.

**Verify.** Unit: two documents edited in sequence → both drafts recoverable; draft prompt
shows the matching document's draft, not the other's.

### E13. Find / replace
Find across the rendered document (highlight + jump), replace in text nodes only.

**Verify.** Unit: search hits count matches fixture; replace changes text nodes only
(attributes/tags untouched); works across slides.

## Tier 3 — polish & power

| ID | Item | Verify |
|---|---|---|
| E14 | Slide thumbnails in the timeline (SVG `foreignObject` snapshot or scaled clone). | Manual: thumbnails visually match slides; perf: 60-slide stress fixture (`npm run stress:generate`) stays responsive. |
| E15 | Snap guides, z-order controls, layer panel. | Unit: bring-forward adjusts z-index relative to siblings; guides appear at parent center ±2px during drag (simulated). |
| E16 | Undo checkpoints: named snapshots + jump list. | Unit: checkpoint created → appears in list → restore returns exact HTML. |
| E17 | Source sync: jump from selected element to source line. | Unit: selecting an element scrolls/flashes the CodeMirror line containing its opening tag for the sample doc. |
| E18 | Deterministic deck normalize (consistent heading levels, spacing, remove empty nodes) — the non-AI half of "cleanup workflow". | Unit: messy fixture → normalized output matches snapshot; idempotent (running twice = same output). |
| E19 | AI cleanup ("tighten copy" etc.) — **separate decision**: needs API key handling; scope before building. | Plan-level: design doc reviewed; not started until approved. |
| E20 | Keyboard shortcut map/panel (after Part A ships). | Unit: every registered shortcut appears in the map; no duplicate bindings. |

---

## Suggested execution order

1. **F1 → F2 → F3** (one PR: fence + detection + tests — fixes the typing bug).
2. **F4, F5, F6** (one PR: caret + editable restriction + key semantics).
3. **F7, F8** (detection + full regression matrix).
4. **F9a–F9h** (batched small fixes).
5. Tier 1 enhancements E1–E7, then Tier 2, then Tier 3.

## Definition of done (per item)

- All Verify checkboxes pass; `npm test` and `npm run build` green.
- New logic lives in testable modules, not string literals.
- Export stays clean: `cleanEditorHtml` output contains no `data-wysiwyg-*` attributes,
  editor styles, or fence scripts (existing tests + spot grep).
- No new runtime dependencies without explicit approval.
