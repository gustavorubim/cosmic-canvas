export type SourceLocator = {
  path: number[];
  tagName: string;
  domId: string;
  classes: string[];
};

type OperationBase = {
  id: string;
  reason: string;
  locator: SourceLocator;
};

export type EditOperation =
  | (OperationBase & { kind: "text"; value: string })
  | (OperationBase & { kind: "attribute"; name: string; value: string | null })
  | (OperationBase & { kind: "style"; value: string })
  | (OperationBase & { kind: "class"; value: string })
  | (OperationBase & { kind: "insert"; position: "before" | "after" | "inside"; html: string })
  | (OperationBase & { kind: "delete" })
  | (OperationBase & { kind: "move"; target: SourceLocator; position: "before" | "after" | "inside" })
  | (OperationBase & { kind: "reorder"; orderedPaths: number[][] })
  | (OperationBase & { kind: "replace-subtree"; html: string });

export type AppliedSourceOperation = {
  source: string;
  edit: {
    from: number;
    to: number;
    text: string;
    expected: string;
    key: string;
  };
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string) {
  return escapeText(value).replace(/"/g, "&quot;");
}

function elementAtPath(doc: Document, path: number[]) {
  let element: Element | null = doc.documentElement;
  for (const index of path) {
    element = element?.children[index] || null;
    if (!element) return null;
  }
  return element;
}

function openingTagRange(source: string, locator: SourceLocator) {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const element = elementAtPath(doc, locator.path);
  const tagName = locator.tagName.toLowerCase();
  if (!element || element.tagName.toLowerCase() !== tagName) return null;
  if (locator.domId && element.id !== locator.domId) return null;
  if (locator.classes.length && !locator.classes.every((className) => element.classList.contains(className))) return null;
  const ordinal = Array.from(doc.querySelectorAll(tagName)).indexOf(element);
  if (ordinal < 0) return null;
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  let match: RegExpExecArray | null;
  let current = 0;
  while ((match = pattern.exec(source))) {
    if (current === ordinal) return { from: match.index, to: match.index + match[0].length, text: match[0] };
    current += 1;
  }
  return null;
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function elementRange(source: string, locator: SourceLocator) {
  const opening = openingTagRange(source, locator);
  if (!opening) return null;
  const tagName = locator.tagName.toLowerCase();
  if (VOID_ELEMENTS.has(tagName) || /\/\s*>$/.test(opening.text)) {
    return { from: opening.from, to: opening.to, contentEnd: opening.to };
  }
  const token = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  token.lastIndex = opening.to;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match[1]) depth -= 1;
    else depth += 1;
    if (depth === 0) return { from: opening.from, to: match.index + match[0].length, contentEnd: match.index };
  }
  return null;
}

function contentRange(source: string, locator: SourceLocator) {
  const opening = openingTagRange(source, locator);
  if (!opening) return null;
  const tag = escapeRegExp(locator.tagName);
  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  token.lastIndex = opening.to;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match[1]) depth -= 1;
    else depth += 1;
    if (depth === 0) return { from: opening.to, to: match.index };
  }
  return null;
}

function updateAttribute(openingTag: string, name: string, value: string | null) {
  const escapedName = escapeRegExp(name);
  const attribute = new RegExp(`\\s${escapedName}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  if (value === null || value === "") return openingTag.replace(attribute, "");
  const next = ` ${name}="${escapeAttribute(value)}"`;
  if (attribute.test(openingTag)) return openingTag.replace(attribute, next);
  return openingTag.replace(/\s*\/?\s*>$/, (ending) => `${next}${ending}`);
}

function changedRange(source: string, next: string, key: string): AppliedSourceOperation {
  let from = 0;
  while (from < source.length && from < next.length && source[from] === next[from]) from += 1;
  let sourceEnd = source.length;
  let nextEnd = next.length;
  while (sourceEnd > from && nextEnd > from && source[sourceEnd - 1] === next[nextEnd - 1]) {
    sourceEnd -= 1;
    nextEnd -= 1;
  }
  return {
    source: next,
    edit: {
      from,
      to: sourceEnd,
      text: next.slice(from, nextEnd),
      expected: source.slice(from, sourceEnd),
      key,
    },
  };
}

export function applySourceOperation(source: string, operation: EditOperation): AppliedSourceOperation | null {
  let range: { from: number; to: number } | null = null;
  let text = "";
  if (operation.kind === "text") {
    range = contentRange(source, operation.locator);
    text = escapeText(operation.value);
  } else if (operation.kind === "attribute" || operation.kind === "style" || operation.kind === "class") {
    const opening = openingTagRange(source, operation.locator);
    if (!opening) return null;
    range = { from: opening.from, to: opening.to };
    const name = operation.kind === "attribute" ? operation.name : operation.kind;
    text = updateAttribute(opening.text, name, operation.value);
  } else if (operation.kind === "insert") {
    const element = elementRange(source, operation.locator);
    if (!element) return null;
    const insertion = operation.position === "before"
      ? element.from
      : operation.position === "after"
        ? element.to
        : element.contentEnd;
    range = { from: insertion, to: insertion };
    text = operation.html;
  } else if (operation.kind === "delete" || operation.kind === "replace-subtree") {
    const element = elementRange(source, operation.locator);
    if (!element) return null;
    range = { from: element.from, to: element.to };
    text = operation.kind === "delete" ? "" : operation.html;
  } else if (operation.kind === "move") {
    const moving = elementRange(source, operation.locator);
    const target = elementRange(source, operation.target);
    if (!moving || !target || (moving.from === target.from && moving.to === target.to)) return null;
    const fragment = source.slice(moving.from, moving.to);
    const without = source.slice(0, moving.from) + source.slice(moving.to);
    const removedLength = moving.to - moving.from;
    const targetAfterRemoval = target.from > moving.from
      ? { from: target.from - removedLength, to: target.to - removedLength, contentEnd: target.contentEnd - removedLength }
      : target;
    const insertion = operation.position === "before"
      ? targetAfterRemoval.from
      : operation.position === "after"
        ? targetAfterRemoval.to
        : targetAfterRemoval.contentEnd;
    return changedRange(source, without.slice(0, insertion) + fragment + without.slice(insertion), `move:${operation.locator.path.join(".")}`);
  } else if (operation.kind === "reorder") {
    if (operation.orderedPaths.length < 2) return null;
    const ranges = operation.orderedPaths.map((path) => elementRange(source, { ...operation.locator, path }));
    if (ranges.some((item) => !item)) return null;
    const concrete = ranges as Array<{ from: number; to: number; contentEnd: number }>;
    const sorted = [...concrete].sort((a, b) => a.from - b.from);
    const parentPaths = operation.orderedPaths.map((path) => path.slice(0, -1).join("."));
    if (new Set(parentPaths).size !== 1) return null;
    const separators = sorted.slice(0, -1).map((item, index) => source.slice(item.to, sorted[index + 1].from));
    const fragments = concrete.map((item) => source.slice(item.from, item.to));
    const replacement = fragments.map((fragment, index) => fragment + (separators[index] || "")).join("");
    const from = sorted[0].from;
    const to = sorted.at(-1)!.to;
    range = { from, to };
    text = replacement;
  } else {
    return null;
  }
  if (!range) return null;
  const expected = source.slice(range.from, range.to);
  return {
    source: source.slice(0, range.from) + text + source.slice(range.to),
    edit: {
      from: range.from,
      to: range.to,
      text,
      expected,
      key: `${operation.kind}:${operation.locator.path.join(".")}`,
    },
  };
}

export function isEditOperation(value: unknown): value is EditOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Record<string, unknown>;
  if (typeof operation.id !== "string" || typeof operation.reason !== "string") return false;
  if (!operation.locator || typeof operation.locator !== "object") return false;
  const locator = operation.locator as Record<string, unknown>;
  if (!Array.isArray(locator.path) || !locator.path.every((part) => Number.isInteger(part) && Number(part) >= 0)) return false;
  if (typeof locator.tagName !== "string" || typeof locator.domId !== "string" || !Array.isArray(locator.classes) ||
    !locator.classes.every((className) => typeof className === "string")) return false;
  if (operation.kind === "text" || operation.kind === "style" || operation.kind === "class") {
    return typeof operation.value === "string";
  }
  if (operation.kind === "attribute") {
    return typeof operation.name === "string" && (typeof operation.value === "string" || operation.value === null);
  }
  if (operation.kind === "insert") {
    return ["before", "after", "inside"].includes(String(operation.position)) && typeof operation.html === "string";
  }
  if (operation.kind === "delete") return true;
  if (operation.kind === "replace-subtree") return typeof operation.html === "string";
  if (operation.kind === "move") {
    return isEditOperation({ ...operation, kind: "delete", locator: operation.target }) &&
      ["before", "after", "inside"].includes(String(operation.position));
  }
  if (operation.kind === "reorder") {
    return Array.isArray(operation.orderedPaths) && operation.orderedPaths.length <= 500 &&
      operation.orderedPaths.every((path) => Array.isArray(path) && path.every((part) => Number.isInteger(part) && Number(part) >= 0));
  }
  return false;
}
