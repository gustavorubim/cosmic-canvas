# WYSIWYG HTML Editor

A small browser-based editor for touching up AI-generated HTML. Paste a full HTML document or fragment, render it in an isolated preview, edit the rendered page, then copy or download the cleaned HTML.

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
- Optional trusted-script mode for JavaScript-driven animations.

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

The app keeps the first version intentionally small:

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

## Project Direction

Good next additions:

- Save and reload local drafts.
- Add a richer code editor such as CodeMirror.
- Add element tree navigation.
- Add image replacement controls.
- Add keyboard shortcuts for common actions.
- Add optional script execution for trusted local documents.
