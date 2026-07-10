/** Runtime validation for commands crossing into the editable iframe.
 * Keep this function self-contained: its source is embedded in the srcdoc. */
export function isBridgeCommand(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (data.type !== "wysiwyg-command" || typeof data.command !== "string") return false;
  if (data.sessionToken !== undefined && (typeof data.sessionToken !== "string" || data.sessionToken.length > 256)) return false;

  const text = (input: unknown, limit = 20_000) => typeof input === "string" && input.length <= limit;
  const finite = (input: unknown) => typeof input === "number" && Number.isFinite(input);
  const bool = (input: unknown) => typeof input === "boolean";
  const path = (input: unknown) => Array.isArray(input) && input.length <= 64 && input.every((part) => Number.isInteger(part) && Number(part) >= 0);
  const stringList = (input: unknown, limit = 200) => Array.isArray(input) && input.length <= limit && input.every((part) => text(part, 20_000));
  const rows = (input: unknown) => Array.isArray(input) && input.length <= 10_000 && input.every((row) => stringList(row, 200));
  const styles = (input: unknown) => Boolean(input) && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input as Record<string, unknown>).length <= 200 && Object.values(input as Record<string, unknown>).every((part) => text(part, 20_000));
  const exact = (...payloadKeys: string[]) => {
    const allowed = new Set(["type", "command", "sessionToken", ...payloadKeys]);
    return Object.keys(data).every((key) => allowed.has(key));
  };

  switch (data.command) {
    case "set-mode": return exact("mode") && ["text", "select", "move", "preview"].includes(String(data.mode));
    case "set-force-timeline": return exact("enabled") && bool(data.enabled);
    case "set-deck-selector": return exact("selector") && text(data.selector, 500);
    case "set-deck-from-selection": return exact("siblingPath") && (data.siblingPath === undefined || path(data.siblingPath));
    case "set-deck-marked": return exact("paths") && Array.isArray(data.paths) && data.paths.length <= 500 && data.paths.every(path);
    case "clear-deck-override":
    case "select-parent":
    case "duplicate":
    case "delete":
    case "request-audit":
    case "request-html": return exact();
    case "set-outline-hidden":
    case "set-outline-locked":
    case "set-picking-ignored": return exact("id", "enabled") && text(data.id, 256) && bool(data.enabled);
    case "select":
    case "duplicate-slide":
    case "insert-slide":
    case "delete-slide":
    case "go-slide": return exact("id") && text(data.id, 256);
    case "apply-style": return exact("styles") && styles(data.styles);
    case "set-text": return exact("text") && text(data.text, 2_000_000);
    case "set-class": return exact("className", "action") && text(data.className, 1_000) && ["add", "remove", "toggle"].includes(String(data.action));
    case "replace-image": return exact("src", "alt") && text(data.src, 5_000_000) && (data.alt === undefined || text(data.alt, 20_000));
    case "set-image-fit": return exact("fit") && ["fit", "fill", "crop"].includes(String(data.fit));
    case "replace-background": return exact("src") && text(data.src, 5_000_000);
    case "set-theme-font": return exact("fontFamily") && text(data.fontFamily, 1_000);
    case "swap-theme-color": return exact("from", "to") && text(data.from, 200) && text(data.to, 200);
    case "set-slide-background": return exact("color") && text(data.color, 200);
    case "find-text": return exact("query") && text(data.query, 100_000);
    case "replace-text": return exact("query", "replacement") && text(data.query, 100_000) && text(data.replacement, 2_000_000);
    case "z-order": return exact("action") && ["bring-forward", "send-backward", "bring-to-front", "send-to-back"].includes(String(data.action));
    case "insert-slide-template": return exact("id", "template") && text(data.id, 256) && ["title", "section", "quote", "image-text", "metrics", "agenda", "closing"].includes(String(data.template));
    case "rename-slide": return exact("id", "title") && text(data.id, 256) && text(data.title, 20_000);
    case "move-slide": return exact("id", "offset") && text(data.id, 256) && finite(data.offset) && Math.abs(Number(data.offset)) <= 10_000;
    case "insert-element": return exact("kind") && ["heading", "paragraph", "image", "button", "box"].includes(String(data.kind));
    case "format-inline": return exact("action", "href") && ["bold", "italic", "create-link", "remove-link", "toggle-list"].includes(String(data.action)) && (data.href === undefined || text(data.href, 100_000));
    case "insert-table": return exact("columns", "rows", "title") && stringList(data.columns) && rows(data.rows) && text(data.title, 20_000);
    case "insert-chart": return exact("chartType", "columns", "rows", "title") && ["bar", "line", "pie"].includes(String(data.chartType)) && stringList(data.columns) && rows(data.rows) && text(data.title, 20_000);
    case "nudge": return exact("dx", "dy") && finite(data.dx) && finite(data.dy) && Math.abs(Number(data.dx)) <= 100_000 && Math.abs(Number(data.dy)) <= 100_000;
    case "layout": return exact("action") && ["align-left", "align-center", "align-right", "distribute-horizontal"].includes(String(data.action));
    case "scroll-to": return exact("x", "y") && finite(data.x) && finite(data.y);
    default: return false;
  }
}
