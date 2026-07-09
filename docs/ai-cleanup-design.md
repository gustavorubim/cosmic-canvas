# AI Cleanup Design

AI cleanup is intentionally not implemented yet. The editor now has deterministic cleanup through `normalizeDeckHtml`; AI cleanup should stay a separate, opt-in workflow because it sends document content outside the local editor.

## Goals

- Tighten copy, improve slide titles, simplify verbose bullets, and suggest accessibility fixes.
- Preserve the HTML structure unless the user explicitly approves structural changes.
- Show a reviewable before/after diff before anything is applied.
- Work on the selected element, selected slide, or whole document with the smallest useful scope as the default.

## Non-Goals

- No silent rewrites.
- No automatic network calls while typing.
- No API keys stored in source code, committed files, or browser localStorage.
- No replacement for deterministic normalize, validation, find/replace, or manual editing controls.

## Proposed Flow

1. User opens an AI cleanup panel and chooses a scope: selected element, active slide, or document.
2. User chooses an operation: tighten copy, clarify headings, improve alt text, or summarize slide notes.
3. The app builds a payload from cleaned HTML only, without editor metadata.
4. The AI provider returns proposed HTML or text patches plus a short explanation.
5. The app renders a diff preview.
6. User applies all, applies selected changes, or discards.
7. Applying creates an automatic checkpoint first, then updates the document history.

## Credential Handling

- VS Code extension: store provider credentials through VS Code SecretStorage.
- Browser build: prefer a short-lived user-entered key kept only in memory for the session.
- Future hosted build: proxy requests through a backend that owns provider credentials and enforces rate limits.

## Provider Boundary

Create a small provider interface:

```ts
type CleanupScope = "selection" | "slide" | "document";
type CleanupTask = "tighten-copy" | "clarify-headings" | "improve-alt-text" | "summarize-notes";

type CleanupRequest = {
  scope: CleanupScope;
  task: CleanupTask;
  html: string;
};

type CleanupProposal = {
  summary: string;
  html: string;
  warnings: string[];
};
```

The React UI should depend on this interface, not directly on any provider SDK.

## Verification Before Building

- Unit: request payload is cleaned of `data-wysiwyg-*`, editor scripts, and transient selection markers.
- Unit: applying a proposal creates a checkpoint before mutating source HTML.
- Unit: rejected proposals do not mutate history, source, or rendered iframe.
- Manual: selected-slide cleanup on a real deck shows a diff and can be discarded without changes.
