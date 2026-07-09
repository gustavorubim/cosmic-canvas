import { type SelectedElement } from "./protocol";

export type SourceLocation = {
  lineNumber: number;
  from: number;
  to: number;
  tag: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attrValue(openingTag: string, attr: string) {
  const pattern = new RegExp(`\\s${escapeRegExp(attr)}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i");
  const match = openingTag.match(pattern);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? "";
}

function openingTagMatches(openingTag: string, selected: SelectedElement) {
  if (selected.domId && attrValue(openingTag, "id") !== selected.domId) {
    return false;
  }
  if (selected.classes.length) {
    const classes = new Set(attrValue(openingTag, "class").split(/\s+/).filter(Boolean));
    if (!selected.classes.every((className) => classes.has(className))) {
      return false;
    }
  }
  return true;
}

export function sourceNeedleForSelected(selected: SelectedElement | null) {
  if (!selected) return "";
  const details = [
    selected.domId ? `#${selected.domId}` : "",
    ...selected.classes.map((className) => `.${className}`),
  ].join("");
  return `<${selected.tagName}${details}`;
}

export function findOpeningTagLocation(source: string, selected: SelectedElement | null): SourceLocation | null {
  if (!selected) return null;
  const tag = selected.tagName.toLowerCase();
  const pattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>`, "gi");
  let fallback: SourceLocation | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    const openingTag = match[0];
    const location: SourceLocation = {
      lineNumber: source.slice(0, match.index).split("\n").length,
      from: match.index,
      to: match.index + openingTag.length,
      tag,
    };

    if (!fallback) fallback = location;
    if (openingTagMatches(openingTag, selected)) return location;
  }

  return fallback;
}
