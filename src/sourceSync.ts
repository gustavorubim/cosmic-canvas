import { type SelectedElement } from "./protocol";

export type SourceLocation = {
  lineNumber: number;
  from: number;
  to: number;
  tag: string;
};

export type SourceLocationResult =
  | { status: "matched"; location: SourceLocation }
  | { status: "ambiguous"; location: null; candidates: number }
  | { status: "not-found"; location: null; candidates: 0 };

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

export function resolveOpeningTagLocation(source: string, selected: SelectedElement | null): SourceLocationResult {
  if (!selected) return { status: "not-found", location: null, candidates: 0 };
  const tag = selected.tagName.toLowerCase();
  const pattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>`, "gi");
  let structuralOrdinal = -1;
  if (selected.sourcePath?.length) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    let element: Element | null = doc.documentElement;
    for (const index of selected.sourcePath) {
      element = element?.children[index] || null;
      if (!element) break;
    }
    if (element?.tagName.toLowerCase() === tag) {
      structuralOrdinal = Array.from(doc.querySelectorAll(tag)).indexOf(element);
    }
  }
  const matchingLocations: SourceLocation[] = [];
  let match: RegExpExecArray | null;
  let ordinal = 0;

  while ((match = pattern.exec(source))) {
    const openingTag = match[0];
    const location: SourceLocation = {
      lineNumber: source.slice(0, match.index).split("\n").length,
      from: match.index,
      to: match.index + openingTag.length,
      tag,
    };

    if (structuralOrdinal >= 0) {
      if (ordinal === structuralOrdinal) return { status: "matched", location };
    } else if (openingTagMatches(openingTag, selected)) {
      matchingLocations.push(location);
    }
    ordinal += 1;
  }

  if (structuralOrdinal >= 0 || matchingLocations.length === 0) {
    return { status: "not-found", location: null, candidates: 0 };
  }
  if (matchingLocations.length > 1) {
    return { status: "ambiguous", location: null, candidates: matchingLocations.length };
  }
  return { status: "matched", location: matchingLocations[0] };
}

export function findOpeningTagLocation(source: string, selected: SelectedElement | null): SourceLocation | null {
  return resolveOpeningTagLocation(source, selected).location;
}
