<p align="center">
  <img src="public/app-icon-space-192.png" alt="Cosmic Canvas app icon" width="96" height="96">
</p>

# Cosmic Canvas

Cosmic Canvas is a free, easy-to-use WYSIWYG HTML editor for people who want to shape HTML visually without getting stuck in code. Paste a full HTML document or fragment, open a local `.html` file, preview it in the browser, click the page to edit it, and export clean HTML when it is ready.

The idea is simple: make HTML editing feel approachable. Cosmic Canvas is built for fast touch-ups, presentation polish, AI-generated page cleanup, and small web documents that need visual editing without a heavy desktop publishing workflow.

## Why Cosmic Canvas

HTML is portable, powerful, and easy to share, but it can be painful to tune by hand when all you need is a better headline, spacing fix, color change, or page layout adjustment. Cosmic Canvas gives you a visual control room for those edits while keeping the output as ordinary HTML.

Use it when you want to:

- Turn AI-generated HTML into something cleaner and more presentable.
- Touch up landing pages, reports, mockups, and one-off web documents.
- Edit text directly inside a rendered page.
- Adjust colors, spacing, sizing, borders, alignment, and positioning without hunting through source.
- Copy or download the final HTML for use somewhere else.
- Keep the workflow lightweight and free.

## Current Features

- Paste and edit raw HTML source.
- Open `.html` files directly, which is better than paste for very large documents.
- Render the HTML in a sandboxed iframe.
- Click rendered elements to select them.
- Edit text inline or through the inspector.
- Change common styles such as text color, fill, font size, spacing, width, height, radius, and alignment.
- Move selected elements by dragging in Move mode or with nudge buttons.
- Duplicate and delete selected elements.
- Undo and redo document snapshots.
- Copy or download the cleaned HTML output.
- Preview desktop, tablet, and mobile widths.
- Hide or show the source panel when you want a larger visual workspace.
- Navigate detected slide decks with a bottom timeline and previous/next controls.
- Insert a new slide after the active slide or duplicate the current slide.
- Edit small CSV/TSV datasets in the Data panel and insert them as styled HTML tables.
- Optional trusted-script mode for JavaScript-driven animations.

## How It Works

Cosmic Canvas has three main work areas:

- **Source panel**: paste, inspect, or directly edit the HTML.
- **Rendered page**: see the document as a live page and select elements visually.
- **Inspector/Data panel**: edit selected text and style properties, or shape tabular data and insert it into the preview.

The app is intentionally browser-based. There is no required account, no backend service, and no document format lock-in. Your final output is still HTML.

## App Flow

Cosmic Canvas keeps the editor shell separate from the rendered document. The user edits through the React app, while the HTML document runs inside an iframe with a temporary editor bridge.

```mermaid
flowchart LR
  User["User"] --> Shell["Cosmic Canvas app shell"]
  Shell --> Source["Source panel"]
  Shell --> Inspector["Inspector"]
  Shell --> Toolbar["Mode and viewport toolbar"]
  Shell --> Preview["Sandboxed iframe preview"]
  Source --> Render["Apply source"]
  Render --> Preview
  Preview --> Selection["Selected element details"]
  Selection --> Inspector
  Inspector --> Preview
  Preview --> Export["Copy or download clean HTML"]
```

The editing loop uses browser messages between the app shell and the iframe. Visual edits update the rendered document first, then the app cleans and stores the resulting HTML source.

```mermaid
sequenceDiagram
  participant User
  participant App as React app shell
  participant Frame as Editable iframe
  participant Cleaner as HTML cleanup

  User->>App: Paste or open HTML
  App->>Cleaner: Normalize input
  Cleaner-->>App: Source HTML
  App->>Frame: Prepare editable preview
  Frame-->>App: Ready message
  User->>Frame: Select, edit, move, or duplicate element
  Frame-->>App: Selection and document-change messages
  App->>Cleaner: Remove editor-only metadata
  Cleaner-->>App: Updated clean source
  User->>App: Copy or download
```

Editor modes keep the page behavior predictable. The same document can move between source editing, visual selection, movement, and preview without changing the final export format.

```mermaid
stateDiagram-v2
  [*] --> Text
  Text --> Select: Select mode
  Select --> Move: Move mode
  Move --> Select: Select mode
  Select --> Preview: Preview mode
  Move --> Preview: Preview mode
  Preview --> Text: Text mode
  Text --> Preview: Preview mode
  Select --> Text: Text mode
  Move --> Text: Text mode
```

Clean export is the final checkpoint. Cosmic Canvas preserves the user document, but strips out temporary IDs, selection markers, hover markers, and editor bridge code before copy or download.

```mermaid
flowchart TD
  Current["Current source HTML"] --> Parse["Parse document"]
  Parse --> RemoveBridge["Remove editor bridge"]
  RemoveBridge --> RemoveMarkers["Remove editor-only attributes"]
  RemoveMarkers --> RestoreScripts["Restore preserved scripts and handlers"]
  RestoreScripts --> Serialize["Serialize clean HTML"]
  Serialize --> Output{"Export target"}
  Output --> Copy["Clipboard"]
  Output --> Download["HTML file"]
```

## Editing Workflow

1. Paste HTML into the source panel or use **Open file** to load a local document.
2. Click **Apply source** to render the latest source changes.
3. Choose a mode:
   - **Text** for direct text editing.
   - **Select** for picking elements and changing styles.
   - **Move** for dragging or nudging selected elements.
   - **Preview** for viewing the page without editor selection behavior.
4. Use the inspector to adjust content, color, spacing, size, alignment, and shape.
5. For slide decks, use the timeline to move between slides, duplicate a slide, or insert a new slide.
6. Use the Data panel to paste or edit CSV/TSV data, then insert it as a table into the active slide or page.
7. Preview the result at desktop, tablet, and mobile widths.
8. Copy or download the cleaned HTML.

## Trusted Scripts

By default, Cosmic Canvas keeps pasted scripts and inline event handlers inert while editing. That makes visual editing safer and more predictable for random or AI-generated HTML.

Enable **Trusted scripts** only for documents you trust and need to run, such as local demos or animated HTML presentations. When enabled, pasted JavaScript can execute inside the preview sandbox.

## Local Development

```powershell
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

If npm is configured to install packages for a different operating system, install with an explicit platform override:

```powershell
npm install --os=win32 --cpu=x64
```

## Build

```powershell
npm run build
```

The static production build is written to `dist/`.

## Editing Model

The app keeps the first version intentionally focused:

- Source edits update the text panel first. Use **Apply source** to reload the rendered preview.
- Visual edits update the source panel automatically.
- The preview injects a temporary editor bridge into the iframe. Export removes editor-only attributes and scripts.
- User-provided `<script>` tags and inline event handlers are preserved but made inert while editing, then restored on export. This keeps the editor from executing pasted behavior during visual editing.
- Enable **Trusted scripts** when the document needs its own JavaScript to render or animate. Only use that mode for HTML you trust.
- Moving elements uses CSS transforms. It is practical for presentation touch-ups, but it is not a full layout engine.

## Large HTML Stress Fixtures

Generate local stress fixtures:

```powershell
npm run stress:generate
```

This writes ignored files to `public/stress-fixtures/`:

- `large-css-10000.html`
- `large-scripted-100000.html`

Use **Open file** to load them, or fetch them from the dev server while testing. For the scripted fixture, enable **Trusted scripts** before applying/loading if you want to verify JavaScript animation.

You can also load a fixture through the URL:

```text
http://127.0.0.1:5173/?load=/stress-fixtures/large-css-10000.html
http://127.0.0.1:5173/?load=/stress-fixtures/large-scripted-100000.html&trusted=1
```

## Known Limits

- Relative assets from local files, such as `./images/foo.png`, do not automatically come along when you paste HTML. Use absolute URLs, inline assets, or keep the document self-contained.
- Trusted-script mode executes pasted JavaScript inside the sandboxed preview. It is useful for your own generated HTML, but it should not be used for untrusted documents.
- Runtime DOM changes made by a document's own scripts may affect what gets exported after visual edits.
- Moving elements is designed for practical visual adjustments, not full responsive layout design.

## Project Direction

Cosmic Canvas is aiming to become a friendly, free editor for everyday HTML polish. Good next additions:

- Save and reload local drafts.
- Add a richer code editor such as CodeMirror.
- Add element tree navigation.
- Add image replacement controls.
- Add keyboard shortcuts for common actions.
- Add reusable page and presentation blocks.
- Improve deck-aware editing for HTML slide decks.

## Deck Editing Roadmap

For HTML presentations such as the corporate deck example, the friendliest path is to add deck-aware tools on top of the existing visual editor:

1. **Deck navigator**
   - Detect repeated slide containers such as `section.slide`.
   - Add previous/next slide buttons.
   - Show a compact slide list with titles from `data-title`, `data-section`, or headings.
   - Let users duplicate, delete, reorder, and rename slides.

2. **Insert slide**
   - Add a button that creates a new slide after the current one.
   - Start with simple templates: title, title/body, metrics, chart placeholder, image/text, comparison table, agenda, closing.
   - Match the current deck's classes where possible instead of injecting unrelated styling.

3. **Component library**
   - Provide drag/drop or click-to-insert blocks: KPI cards, callouts, tables, quote blocks, timelines, Mermaid diagrams, chart canvases, and image frames.
   - Keep inserted blocks as normal HTML so the final export remains portable.

4. **Data-assisted blocks**
   - Add a small data panel for pasted CSV/JSON.
   - Bind data to reusable chart/table components.
   - Keep generated data blocks editable as regular DOM elements.

5. **Safer export**
   - Track inserted editor-created slides/components.
   - Offer a clean export that keeps user content and removes editor-only metadata.
