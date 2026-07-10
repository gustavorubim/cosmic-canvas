import { isBridgeCommand } from "../bridgeCommandValidation";

type FenceState = {
  mode: string;
};

type EditorKeyContext = {
  typing: boolean;
};

type CosmicWindow = Window &
  typeof globalThis & {
    __cosmicFenceInstalled?: boolean;
    __cosmicFenceState?: FenceState;
    __cosmicHandleEditorKey?: (event: KeyboardEvent, context: EditorKeyContext) => boolean;
    __cosmicMetrics?: Record<string, number[]> & { thumbnailBuilds?: number[] };
    __cosmicThumbnailLog?: string[];
    __cosmicThumbnailInvalidations?: string[];
  };

const NONE = "__wysiwyg_none__";

export type MutationImpact = "deck-structural" | "active-slide-only" | "thumbnail-affecting" | "irrelevant";

/** Classify observed author-DOM mutations so unrelated changes do not trigger
 * every navigator and outline cache. This is also embedded in the srcdoc. */
export function classifyBridgeMutation(
  record: MutationRecord,
  slideSelector: string,
  activeSlideId: string,
): MutationImpact {
  const elementFor = (node: Node | null) => {
    if (!node) return null;
    return node.nodeType === 1 ? node as Element : node.parentElement;
  };
  const closestSlide = (node: Node | null) => {
    const element = elementFor(node);
    try {
      return element?.closest(slideSelector) || null;
    } catch {
      return null;
    }
  };
  const isSlideTree = (node: Node) => {
    const element = elementFor(node);
    if (!element) return false;
    try {
      return element.matches(slideSelector) || Boolean(element.querySelector(slideSelector));
    } catch {
      return false;
    }
  };

  if (record.type === "characterData") {
    return closestSlide(record.target) ? "thumbnail-affecting" : "irrelevant";
  }
  if (record.type === "childList") {
    const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    if (changed.some(isSlideTree)) return "deck-structural";
    return closestSlide(record.target) ? "thumbnail-affecting" : "deck-structural";
  }
  if (record.type !== "attributes") return "irrelevant";

  const attribute = record.attributeName || "";
  if (attribute.startsWith("data-wysiwyg-")) return "irrelevant";
  if (["aria-current", "data-active"].includes(attribute)) return "active-slide-only";
  if (["id", "class", "data-slide", "data-slide-id", "data-page", "data-page-id", "aria-roledescription"].includes(attribute)) {
    return "deck-structural";
  }
  const slide = closestSlide(record.target);
  if (!slide) return attribute === "style" ? "deck-structural" : "irrelevant";
  if (activeSlideId && (slide as HTMLElement).dataset.wysiwygId === activeSlideId && attribute === "hidden") {
    return "active-slide-only";
  }
  return "thumbnail-affecting";
}

export function combineMutationImpacts(impacts: MutationImpact[]): MutationImpact {
  if (impacts.includes("deck-structural")) return "deck-structural";
  if (impacts.includes("thumbnail-affecting")) return "thumbnail-affecting";
  if (impacts.includes("active-slide-only")) return "active-slide-only";
  return "irrelevant";
}

export function inTypingContextForElement(active: Element | null): boolean {
  if (!active) return false;
  const view = active.ownerDocument?.defaultView;
  const HTMLElementCtor = view?.HTMLElement;
  const HTMLInputElementCtor = view?.HTMLInputElement;
  if (!HTMLElementCtor || !(active instanceof HTMLElementCtor)) return false;

  if (active.getAttribute("contenteditable") === "false") return false;
  if (active.isContentEditable) return true;

  const editable = active.closest("[contenteditable]");
  if (editable instanceof HTMLElementCtor) {
    if (editable === active && active.contentEditable === "false") return false;
    if (editable.contentEditable !== "false") return true;
  }

  if (active.matches("textarea, select, [role='textbox'], [role='textbox'] *")) {
    return true;
  }

  if (HTMLInputElementCtor && active instanceof HTMLInputElementCtor) {
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(active.type);
  }

  return false;
}

export function canDirectlyEditTextElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (["html", "head", "body", "script", "style", "img", "input", "select", "textarea", "canvas", "iframe", "svg"].includes(tag)) {
    return false;
  }

  const inlineTags = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "br",
    "cite",
    "code",
    "data",
    "dfn",
    "em",
    "i",
    "kbd",
    "mark",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr",
  ]);

  function allInline(node: Element): boolean {
    return Array.from(node.children).every((child) => {
      const childTag = child.tagName.toLowerCase();
      return inlineTags.has(childTag) && allInline(child);
    });
  }

  return allInline(element);
}

export function editableTextTarget(element: Element | null): Element | null {
  if (!element) return null;
  if (canDirectlyEditTextElement(element)) return element;
  if (["html", "head", "body", "script", "style"].includes(element.tagName.toLowerCase())) return null;
  if (element.matches(deckSlideSelector()) && !isSlidePartElement(element)) return null;

  const directChildren = Array.from(element.children).filter((child) => {
    return (child as HTMLElement).dataset?.wysiwygEditor !== "true";
  });
  const directTextChildren = directChildren.filter((child) => {
    return canDirectlyEditTextElement(child) && (child.textContent || "").trim() !== "";
  });
  const directHeading = directTextChildren.find((child) => /^h[1-6]$/i.test(child.tagName));
  if (directHeading && directChildren.length <= 3) return directHeading;
  if (directTextChildren.length === 1) return directTextChildren[0];

  const candidates = Array.from(
    element.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, figcaption, blockquote, button, a, span"),
  ).filter((child) => {
    return (
      !child.closest('[data-wysiwyg-editor="true"]') &&
      canDirectlyEditTextElement(child) &&
      (child.textContent || "").trim() !== ""
    );
  });
  if (candidates.length === 1) return candidates[0];

  const heading = candidates.find((child) => /^h[1-6]$/i.test(child.tagName));
  if (heading && directChildren.length <= 3) return heading;

  return null;
}

export function deckSlideSelectorList() {
  return [
    ".slide",
    ".deck-slide",
    ".presentation-slide",
    ".ppt-slide",
    ".pptx-slide",
    ".powerpoint-slide",
    "[data-slide]",
    "[data-slide-id]",
    "[data-page]",
    "[data-page-id]",
    "[aria-roledescription='slide']",
    ".reveal .slides > section",
    ".reveal .slides > section > section",
    ".slides > section",
    ".slides > article",
    ".slides > div",
    ".deck > section",
    ".deck > article",
    ".deck > div",
    ".presentation > section",
    ".presentation > article",
    ".presentation > div",
    "[data-deck] > section",
    "[data-deck] > article",
    "[data-deck] > div",
    "[data-presentation] > section",
    "[data-presentation] > article",
    "[data-presentation] > div",
  ];
}

export function deckSlideSelector() {
  return deckSlideSelectorList().join(", ");
}

export function isRevealStackElement(element: Element) {
  return (
    element.matches(".reveal .slides > section") &&
    Array.from(element.children).some((child) => child.tagName.toLowerCase() === "section")
  );
}

export function isSlidePartElement(element: Element) {
  const classList = Array.from(element.classList).map((name) => name.toLowerCase());
  if (classList.includes("slide")) return false;
  return classList.some((name) => {
    return /(^|[-_])(body|content|headline|heading|title|subtitle|text|copy|image|media|header|footer|number|logo)([-_]|$)/.test(
      name,
    );
  });
}

export function elementDescriptorText(element: Element) {
  return [
    element.tagName,
    element.id,
    element.className,
    element.getAttribute("role"),
    element.getAttribute("aria-roledescription"),
    element.getAttribute("aria-label"),
    element.getAttribute("data-kind"),
    element.getAttribute("data-type"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function hasTokenMatch(element: Element, pattern: RegExp) {
  return pattern.test(elementDescriptorText(element));
}

export function hasDeckContainerHint(element: Element | null) {
  if (!element) return false;
  return hasTokenMatch(
    element,
    /(^|[\s_-])(deck|slides?|presentation|presenter|carousel|swiper|pages?|screens?|frames?|story|document|report)([\s_-]|$)/,
  );
}

export function hasSlideItemHint(element: Element) {
  return (
    element.getAttribute("aria-roledescription")?.toLowerCase() === "slide" ||
    hasTokenMatch(
      element,
      /(^|[\s_-])(slide|page|screen|panel|frame|card|view|sheet|artboard|canvas|spread)([\s_-]|$)/,
    )
  );
}

export function hasNonSlideChromeHint(element: Element) {
  return hasTokenMatch(
    element,
    /(^|[\s_-])(nav|navbar|menu|toolbar|sidebar|aside|footer|masthead|controls?|pagination|dots?|thumbs?|thumbnail|notes?|speaker|caption|legend|modal|dialog)([\s_-]|$)/,
  );
}

export function styleLooksPaged(element: Element) {
  const style = element.getAttribute("style") || "";
  return /(width|min-width|max-width|height|min-height|max-height|aspect-ratio)\s*:|(?:100|90|80)vh|(?:540|720|768|900|960|1024|1080|1200|1280|1366|1440|1600|1920)px/i.test(
    style,
  );
}

export function computedStyleLooksPaged(element: Element) {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  try {
    const style = view.getComputedStyle(element);
    const width = parseFloat(style.width || "");
    const height = parseFloat(style.height || "");
    if (Number.isFinite(width) && Number.isFinite(height) && width >= 300 && height >= 180) return true;
    return /^(?:100|9\d|8\d)vh$/.test(style.height || "") || /^(?:100|9\d|8\d)vw$/.test(style.width || "");
  } catch {
    return false;
  }
}

export function forcedVisualSignal(element: Element) {
  if (element.querySelector("img, svg, canvas, table, video, picture")) return true;
  const style = (element.getAttribute("style") || "").toLowerCase();
  if (/(background|background-image)\s*:\s*(?!none)(?:[^;]*url\(|[^;]*(?:#|rgb|hsl|linear-gradient|radial-gradient))/i.test(style)) {
    return true;
  }
  if (/(border|box-shadow|filter|object-fit|overflow)\s*:|position\s*:\s*(absolute|fixed)|inset\s*:/i.test(style)) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  try {
    const computed = view.getComputedStyle(element);
    return (
      (computed.backgroundImage && computed.backgroundImage !== "none") ||
      (computed.backgroundColor && !["", "transparent", "rgba(0, 0, 0, 0)"].includes(computed.backgroundColor)) ||
      (computed.borderStyle && computed.borderStyle !== "none") ||
      computed.position === "absolute" ||
      computed.position === "fixed"
    );
  } catch {
    return false;
  }
}

export function forcedTitleSignal(element: Element) {
  if (element.getAttribute("data-title") || element.getAttribute("aria-label")) return true;
  return Boolean(
    element.querySelector(
      "h1, h2, h3, h4, h5, h6, [role='heading'], [data-title], [aria-label], [class*='title'], [class*='headline'], [class*='heading']",
    ),
  );
}

export function structuralSlideScore(element: Element, parent: Element | null) {
  if ((element as HTMLElement).dataset?.wysiwygEditor === "true") return -Infinity;
  if (element.closest('[data-wysiwyg-editor="true"]')) return -Infinity;
  if (isRevealStackElement(element) || isSlidePartElement(element) || hasNonSlideChromeHint(element)) return -Infinity;

  const tag = element.tagName.toLowerCase();
  if (["script", "style", "template", "link", "meta", "nav", "footer", "header", "aside"].includes(tag)) {
    return -Infinity;
  }

  const text = (element.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length < 20) return -Infinity;

  let score = 0;
  if (hasSlideItemHint(element)) score += 4;
  if (hasDeckContainerHint(parent)) score += 3;
  if (styleLooksPaged(element)) score += 3;
  if (element.querySelector("h1, h2, h3, [role='heading']")) score += 2;
  if (/(\bslide\b|\bpage\b)\s*\d+(\s*(of|\/)\s*\d+)?/i.test(text)) score += 2;
  if (text.length >= 80) score += 1;
  if (element.children.length >= 2) score += 1;
  if (["section", "article"].includes(tag)) score += 1;

  return score;
}

export function classSignature(element: Element) {
  const stableClasses = Array.from(element.classList)
    .map((name) => name.toLowerCase())
    .filter((name) => !/^(active|current|selected|visible|hidden|show|open|closed|enter|exit|previous|next)$/.test(name))
    .sort();
  return `${element.tagName.toLowerCase()}|${stableClasses.join(".")}`;
}

export function hasRepeatedSiblingShape(elements: Element[]) {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const key = classSignature(element);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.values()).some((count) => count >= 2);
}

export function inferStructuralDeckSlides(root: ParentNode) {
  const rootNode = root as Node;
  const ownerDocument = rootNode.nodeType === 9 ? (rootNode as Document) : rootNode.ownerDocument;
  const searchRoot = rootNode.nodeType === 9 ? ownerDocument?.body || ownerDocument?.documentElement : root;
  if (!searchRoot) return [];

  const containers = [
    searchRoot,
    ...Array.from(searchRoot.querySelectorAll("main, [role='main'], body *")).filter((element) => {
      return element.children.length >= 2 && element.children.length <= 80;
    }),
  ];
  let best: { slides: Element[]; score: number } | null = null;

  for (const container of containers) {
    if ((container as Node).nodeType !== 1) continue;
    const containerElement = container as Element;
    if (hasNonSlideChromeHint(containerElement)) continue;
    const children = Array.from(containerElement.children).filter((child) => {
      return (child as HTMLElement).dataset?.wysiwygEditor !== "true";
    });
    if (children.length < 2 || children.length > 80) continue;

    const parentHint = hasDeckContainerHint(containerElement);
    const scored = children
      .map((child) => ({ child, score: structuralSlideScore(child, containerElement) }))
      .filter((item) => item.score >= (parentHint ? 5 : 7));
    if (scored.length < 2) continue;

    const candidates = scored.map((item) => item.child);
    const repeated = hasRepeatedSiblingShape(candidates);
    const allStrong = scored.every((item) => item.score >= 7);
    if (!parentHint && !repeated && !allStrong) continue;

    const average = scored.reduce((total, item) => total + item.score, 0) / scored.length;
    const groupScore = candidates.length * 10 + average + (parentHint ? 10 : 0) + (repeated ? 4 : 0);
    if (!best || groupScore > best.score) {
      best = { slides: candidates, score: groupScore };
    }
  }

  return best?.slides || [];
}

export function meaningfulForcedSlideElement(element: Element) {
  if ((element as HTMLElement).dataset?.wysiwygEditor === "true") return false;
  if (element.closest('[data-wysiwyg-editor="true"]')) return false;
  if (isRevealStackElement(element) || isSlidePartElement(element) || hasNonSlideChromeHint(element)) return false;
  if (["script", "style", "template", "link", "meta", "nav", "footer", "header", "aside"].includes(element.tagName.toLowerCase())) {
    return false;
  }
  const text = (element.textContent || "").replace(/\s+/g, " ").trim();
  return (
    text.length >= 6 ||
    forcedVisualSignal(element) ||
    forcedTitleSignal(element) ||
    styleLooksPaged(element) ||
    computedStyleLooksPaged(element)
  );
}

export function forcedSlideScore(element: Element, parent: Element | null) {
  if (!meaningfulForcedSlideElement(element)) return -Infinity;
  const baseScore = structuralSlideScore(element, parent);
  let score = Number.isFinite(baseScore) ? Math.max(0, baseScore) : 0;
  if (hasDeckContainerHint(parent)) score += 2;
  if (hasSlideItemHint(element)) score += 2;
  if (styleLooksPaged(element) || computedStyleLooksPaged(element)) score += 3;
  if (forcedVisualSignal(element)) score += 2;
  if (forcedTitleSignal(element)) score += 2;
  if (/(\bslide\b|\bpage\b|\bscreen\b|\bframe\b)\s*\d+(\s*(of|\/)\s*\d+)?/i.test(element.textContent || "")) score += 2;
  if (element.children.length > 0) score += 1;
  if ((element.textContent || "").replace(/\s+/g, " ").trim().length >= 60) score += 1;
  return score;
}

export function forcedSlideStrongSignal(element: Element) {
  return (
    hasSlideItemHint(element) ||
    styleLooksPaged(element) ||
    computedStyleLooksPaged(element) ||
    forcedVisualSignal(element) ||
    forcedTitleSignal(element)
  );
}

export function forcedSlideCandidate(element: Element, parent: Element | null) {
  const tag = element.tagName.toLowerCase();
  if (["html", "body", "main"].includes(tag)) return false;
  return forcedSlideStrongSignal(element) && forcedSlideScore(element, parent) >= 5;
}

export function hasForcedWrapperHint(element: Element) {
  return hasTokenMatch(
    element,
    /(^|[\s_-])(wrapper|container|viewport|scaler|scale|outer|inner|mount|root|stage|holder|layer)([\s_-]|$)/,
  );
}

export function forcedSlideContentElement(element: Element) {
  if (!hasForcedWrapperHint(element)) return element;
  if (styleLooksPaged(element) || forcedVisualSignal(element)) return element;
  const directCandidates = Array.from(element.children).filter((child) => forcedSlideCandidate(child, element));
  return directCandidates.length === 1 ? directCandidates[0] : element;
}

export function pruneForcedSlideCandidates(candidates: Element[]) {
  return candidates.filter((candidate) => {
    const candidateScore = forcedSlideScore(candidate, candidate.parentElement);
    const directContent = forcedSlideContentElement(candidate);
    if (directContent !== candidate && candidates.includes(directContent)) return false;

    const containingCandidates = candidates.filter((other) => other !== candidate && other.contains(candidate));
    if (
      containingCandidates.some((other) => {
        if (hasDeckContainerHint(other)) return false;
        if (!forcedSlideStrongSignal(other)) return false;
        return forcedSlideScore(other, other.parentElement) >= candidateScore;
      })
    ) {
      return false;
    }

    const containedCandidates = candidates.filter((other) => other !== candidate && candidate.contains(other));
    if (containedCandidates.length >= 2 && hasDeckContainerHint(candidate)) return false;
    if (containedCandidates.length >= 2 && !styleLooksPaged(candidate) && !computedStyleLooksPaged(candidate)) return false;
    return true;
  });
}

export function inferForcedDeckSlidesFromAll(root: ParentNode) {
  const rootNode = root as Node;
  const ownerDocument = rootNode.nodeType === 9 ? (rootNode as Document) : rootNode.ownerDocument;
  const searchRoot = rootNode.nodeType === 9 ? ownerDocument?.body || ownerDocument?.documentElement : root;
  if (!searchRoot) return [];

  const candidates = Array.from(searchRoot.querySelectorAll("*"))
    .filter((element) => forcedSlideCandidate(element, element.parentElement))
    .sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
  const pruned = pruneForcedSlideCandidates(candidates);
  return pruned.length >= 2 ? pruned : [];
}

export function forcedSlidesShouldReplaceExisting(forcedSlides: Element[], existingSlides: Element[]) {
  if (!forcedSlides.length) return false;
  if (existingSlides.length <= 1) return true;
  if (forcedSlides.length > existingSlides.length) return true;
  if (forcedSlides.length !== existingSlides.length) return false;
  if (existingSlides.every((slide, index) => slide === forcedSlides[index])) return false;
  if (existingSlides.some((slide) => hasForcedWrapperHint(slide))) return true;
  return existingSlides.some((slide) => forcedSlides.some((forcedSlide) => slide !== forcedSlide && slide.contains(forcedSlide)));
}

export function inferForcedDeckSlides(root: ParentNode) {
  const rootNode = root as Node;
  const ownerDocument = rootNode.nodeType === 9 ? (rootNode as Document) : rootNode.ownerDocument;
  const searchRoot = rootNode.nodeType === 9 ? ownerDocument?.body || ownerDocument?.documentElement : root;
  if (!searchRoot) return [];

  const containers = [
    searchRoot,
    ...Array.from(searchRoot.querySelectorAll("main, [role='main'], body *")).filter((element) => {
      return element.children.length >= 2 && element.children.length <= 120;
    }),
  ];
  let best: { slides: Element[]; score: number } | null = null;

  for (const container of containers) {
    if ((container as Node).nodeType !== 1) continue;
    const containerElement = container as Element;
    if (hasNonSlideChromeHint(containerElement)) continue;
    if (
      containerElement !== searchRoot &&
      !hasDeckContainerHint(containerElement) &&
      (hasSlideItemHint(containerElement) || styleLooksPaged(containerElement) || computedStyleLooksPaged(containerElement)) &&
      forcedSlideScore(containerElement, containerElement.parentElement) >= 6
    ) {
      continue;
    }
    const children = Array.from(containerElement.children).filter(meaningfulForcedSlideElement);
    if (children.length < 2 || children.length > 120) continue;

    const scored = children
      .map((child) => {
        const candidate = forcedSlideContentElement(child);
        return { child: candidate, score: forcedSlideScore(candidate, candidate.parentElement || containerElement) };
      })
      .filter((item) => item.score >= 3);
    if (scored.length < 2) continue;

    const candidates = scored.map((item) => item.child);
    const repeated = hasRepeatedSiblingShape(candidates);
    const parentHint = hasDeckContainerHint(containerElement);
    const itemHints = candidates.filter((candidate) => hasSlideItemHint(candidate)).length;
    const visualHints = candidates.filter((candidate) => forcedVisualSignal(candidate)).length;
    const pagedHints = candidates.filter((candidate) => styleLooksPaged(candidate) || computedStyleLooksPaged(candidate)).length;
    const allStrong = scored.every((item) => item.score >= 6);
    const allSlideLike = candidates.every(forcedSlideStrongSignal);
    if (!parentHint && !repeated && itemHints < 2 && scored.length < 3 && !(allStrong && allSlideLike)) continue;

    const average = scored.reduce((total, item) => total + item.score, 0) / scored.length;
    const groupScore =
      candidates.length * 8 +
      average +
      (parentHint ? 10 : 0) +
      (repeated ? 8 : 0) +
      itemHints * 2 +
      visualHints +
      pagedHints * 2;
    if (!best || groupScore > best.score) {
      best = { slides: candidates, score: groupScore };
    }
  }

  const globalSlides = inferForcedDeckSlidesFromAll(root);
  if (best?.slides.length) {
    return forcedSlidesShouldReplaceExisting(globalSlides, best.slides) ? globalSlides : best.slides;
  }
  if (globalSlides.length) return globalSlides;

  const body = ownerDocument?.body;
  if (body && meaningfulForcedSlideElement(body)) return [body];
  return [];
}

export function collectDeckSlides(root: ParentNode, options: { force?: boolean } = {}) {
  const seen = new Set<Element>();
  const slides: Element[] = [];

  function addSlide(element: Element) {
    if ((element as HTMLElement).dataset?.wysiwygEditor === "true") return;
    if (element.closest('[data-wysiwyg-editor="true"]')) return;
    if (isRevealStackElement(element)) return;
    if (isSlidePartElement(element)) return;
    if (seen.has(element)) return;
    seen.add(element);
    slides.push(element);
  }

  for (const selector of deckSlideSelectorList()) {
    root.querySelectorAll(selector).forEach(addSlide);
  }

  if (!slides.length) {
    inferStructuralDeckSlides(root).forEach(addSlide);
  }

  if (options.force) {
    const forcedSlides = inferForcedDeckSlides(root);
    if (forcedSlidesShouldReplaceExisting(forcedSlides, slides)) {
      slides.length = 0;
      seen.clear();
      forcedSlides.forEach(addSlide);
    }
  }

  return slides
    .filter((candidate) => {
      const parentSlide = slides.find((other) => other !== candidate && other.contains(candidate));
      if (!parentSlide) return true;
      return parentSlide.matches(".reveal .slides > section");
    })
    .sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
}

export function installKeyboardFence(win: CosmicWindow = window as CosmicWindow, sessionToken = "") {
  if (win.__cosmicFenceInstalled) return;
  win.__cosmicFenceInstalled = true;
  win.__cosmicFenceState = win.__cosmicFenceState || { mode: "text" };

  const navigationKeys = new Set([
    " ",
    "Spacebar",
    "Backspace",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ]);
  const editorKeys = new Set([
    "Escape",
    "Delete",
    "Backspace",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ]);

  function eventTargetElement(event: Event): Element | null {
    const target = event.target;
    return target instanceof win.Element ? target : null;
  }

  function shortcutAction(event: KeyboardEvent, typing: boolean) {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return "";
    const key = event.key.toLowerCase();
    if (key === "s") return "save";
    if (event.key === "Enter") return "apply-source";
    if (!typing && key === "z" && !event.shiftKey) return "undo";
    if (!typing && ((key === "z" && event.shiftKey) || key === "y")) return "redo";
    return "";
  }

  function postShortcut(action: string) {
    win.parent?.postMessage({
      type: "wysiwyg-shortcut",
      action,
      ...(sessionToken ? { sessionToken } : {}),
    }, "*");
  }

  function onKey(event: KeyboardEvent) {
    const state = win.__cosmicFenceState || { mode: "text" };
    const target = eventTargetElement(event);
    const typing =
      inTypingContextForElement(win.document.activeElement) ||
      inTypingContextForElement(target);

    if (event.type === "keydown") {
      const action = shortcutAction(event, typing);
      if (action) {
        event.preventDefault();
        event.stopImmediatePropagation();
        postShortcut(action);
        return;
      }
    }

    if (state.mode === "preview") return;

    if (event.type === "keydown") {
      win.__cosmicHandleEditorKey?.(event, { typing });
    }

    if (typing) {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopImmediatePropagation();
      }
      return;
    }

    if (navigationKeys.has(event.key) || editorKeys.has(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  ["keydown", "keypress", "keyup"].forEach((type) => {
    win.addEventListener(type, onKey as EventListener, true);
  });
}

export function installEditorBridge(win: CosmicWindow = window as CosmicWindow, sessionToken = "") {
  const document = win.document;
  const SLIDE_SELECTOR = deckSlideSelector();
  let mode = "text";
  let idCounter = 1;
  let selectedElement: Element | null = null;
  let editingElement: Element | null = null;
  let hoveredElement: Element | null = null;
  let inputTimer = 0;
  let deckTimer = 0;
  let outlineTimer = 0;
  let activeScrollFrame = 0;
  let operationCounter = 0;
  let activeSlideId = "";
  let forceTimeline = false;
  let manualDeckSelector = "";
  let manualSiblingPath: number[] = [];
  let manualMarkedPaths: number[][] = [];
  let dragState: {
    element: HTMLElement;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
    baseRect: DOMRect;
    parentRect: DOMRect | null;
  } | null = null;
  let resizeState: {
    element: HTMLElement;
    startX: number;
    startY: number;
    baseWidth: number;
    baseHeight: number;
  } | null = null;
  let chip: HTMLDivElement | null = null;
  let chipLabel: HTMLSpanElement | null = null;
  let resizeHandle: HTMLButtonElement | null = null;
  let verticalGuide: HTMLDivElement | null = null;
  let horizontalGuide: HTMLDivElement | null = null;
  let deckObserver: MutationObserver | null = null;
  let slideVisibilityObserver: IntersectionObserver | null = null;
  let observedSlideSignature = "";
  const thumbnailCache = new WeakMap<Element, string>();
  const editorMutatedElements = new WeakSet<Element>();
  const lastPublishedText = new WeakMap<Element, string>();
  const metrics = win.__cosmicMetrics || (win.__cosmicMetrics = { thumbnailBuilds: [0] });

  function recordTiming(name: string, startedAt: number) {
    const values = metrics[name] || (metrics[name] = []);
    values.push(Math.max(0, win.performance.now() - startedAt));
    if (values.length > 200) values.shift();
  }

  const fenceState = win.__cosmicFenceState || (win.__cosmicFenceState = { mode });

  function syncFenceState() {
    fenceState.mode = mode;
  }

  function nextId() {
    return "el-" + idCounter++;
  }

  function ensureId(element: Element | null) {
    if (!element || (element as HTMLElement).dataset.wysiwygEditor === "true") return "";
    const htmlElement = element as HTMLElement;
    if (!htmlElement.dataset.wysiwygId) htmlElement.dataset.wysiwygId = nextId();
    return htmlElement.dataset.wysiwygId;
  }

  function serialize() {
    const startedAt = win.performance.now();
    const html = "<!doctype html>\n" + document.documentElement.outerHTML;
    recordTiming("serialization", startedAt);
    return html;
  }

  function post(type: string, payload: Record<string, unknown> = {}) {
    win.parent.postMessage({ type, ...payload, ...(sessionToken ? { sessionToken } : {}) }, "*");
  }

  function colorToHex(value: string) {
    if (!value || value === "transparent") return "";
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/i);
    if (!match) return "";
    if (match[4] !== undefined && Number(match[4]) === 0) return "";
    return "#" + [match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("");
  }

  function cssUrlValue(value: string) {
    if (!value || value === "none") return "";
    const match = value.match(/^url\((["']?)(.*)\1\)$/);
    return match ? match[2] : value;
  }

  function cssUrl(src: string) {
    return 'url("' + src.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
  }

  function imageFitMode(element: Element | null) {
    if (!element) return "";
    const fit = ((element as HTMLElement).style.objectFit || win.getComputedStyle(element).objectFit || "").trim();
    if (fit === "contain") return "fit";
    if (fit === "fill") return "fill";
    if (fit === "cover") return "crop";
    return "";
  }

  function eligibleManualSlide(element: Element) {
    const tag = element.tagName.toLowerCase();
    return !["script", "style", "meta", "link", "title"].includes(tag) &&
      (element as HTMLElement).dataset.wysiwygEditor !== "true";
  }

  function elementAtSourcePath(path: number[]) {
    let node: Element = document.documentElement;
    for (const index of path) {
      const children = Array.from(node.children).filter(eligibleManualSlide);
      if (!Number.isInteger(index) || index < 0 || index >= children.length) return null;
      node = children[index];
    }
    return node;
  }

  function slideCandidates() {
    if (manualDeckSelector) {
      try {
        return Array.from(document.querySelectorAll(manualDeckSelector)).filter(eligibleManualSlide);
      } catch (error) {
        post("wysiwyg-diagnostic", {
          diagnostic: {
            id: "deck-selector-invalid",
            code: "deck-selector-invalid",
            severity: "warning",
            title: "Page selector is invalid",
            message: "The custom page selector could not be applied.",
            detail: error instanceof Error ? error.message : String(error),
          },
        });
        return [];
      }
    }
    if (manualSiblingPath.length) {
      const parent = elementAtSourcePath(manualSiblingPath);
      return parent ? Array.from(parent.children).filter(eligibleManualSlide) : [];
    }
    if (manualMarkedPaths.length) {
      return manualMarkedPaths.map(elementAtSourcePath).filter((element): element is Element => Boolean(element));
    }
    return collectDeckSlides(document, { force: forceTimeline });
  }

  function textFrom(element: Element, selector: string) {
    const target = element.querySelector(selector);
    return target ? (target.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function slideTitle(element: Element, index: number) {
    return (
      element.getAttribute("data-title") ||
      element.getAttribute("data-section") ||
      element.getAttribute("aria-label") ||
      textFrom(element, "h1") ||
      textFrom(element, "h2") ||
      textFrom(element, "h3") ||
      "Slide " + (index + 1)
    ).slice(0, 80);
  }

  function scrubThumbnailElement(element: Element) {
    element.querySelectorAll("script, style, [data-wysiwyg-editor='true']").forEach((child) => child.remove());
    [element, ...Array.from(element.querySelectorAll("*"))].forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        if (
          attribute.name.startsWith("data-wysiwyg-") ||
          attribute.name.startsWith("on") ||
          attribute.name === "contenteditable" ||
          attribute.name === "spellcheck"
        ) {
          node.removeAttribute(attribute.name);
        }
      });
    });
  }

  function slideThumbnailHtml(slide: Element) {
    const cached = thumbnailCache.get(slide);
    if (cached !== undefined) return cached;
    metrics.thumbnailBuilds = metrics.thumbnailBuilds || [0];
    metrics.thumbnailBuilds[0] = (metrics.thumbnailBuilds[0] || 0) + 1;
    const thumbnailLog = win.__cosmicThumbnailLog || (win.__cosmicThumbnailLog = []);
    thumbnailLog.push(ensureId(slide));
    if (thumbnailLog.length > 500) thumbnailLog.shift();
    const startedAt = win.performance.now();
    const clone = slide.cloneNode(true) as Element;
    scrubThumbnailElement(clone);
    const html = clone.outerHTML.slice(0, 6000);
    thumbnailCache.set(slide, html);
    recordTiming("thumbnail", startedAt);
    recordTiming("thumbnailGeneration", startedAt);
    return html;
  }

  function invalidateThumbnail(slide: Element, reason: string) {
    thumbnailCache.delete(slide);
    const invalidations = win.__cosmicThumbnailInvalidations || (win.__cosmicThumbnailInvalidations = []);
    invalidations.push(`${ensureId(slide)}:${reason}`);
    if (invalidations.length > 500) invalidations.shift();
  }

  function observeSlideVisibility(slides: Element[]) {
    if (typeof win.IntersectionObserver !== "function") return;
    const signature = slides.map((slide) => ensureId(slide)).join("|");
    if (signature === observedSlideSignature) return;
    observedSlideSignature = signature;
    slideVisibilityObserver?.disconnect();
    slideVisibilityObserver = new win.IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible || ensureId(visible.target) === activeSlideId) return;
        markActiveSlide(visible.target);
        scheduleDeckPublish();
      },
      { threshold: [0.15, 0.35, 0.6, 0.85] },
    );
    slides.forEach((slide) => slideVisibilityObserver?.observe(slide));
  }

  function visibleArea(element: Element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, win.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function nearestSlide(slides: Element[]) {
    if (!slides.length) return null;
    const selectedSlide = selectedElement
      ? slides.find((slide) => slide === selectedElement || slide.contains(selectedElement)) || null
      : null;
    if (selectedSlide && slides.includes(selectedSlide)) return selectedSlide;
    const activeById = activeSlideId
      ? document.querySelector('[data-wysiwyg-id="' + win.CSS.escape(activeSlideId) + '"]')
      : null;
    if (activeById && slides.includes(activeById)) return activeById;
    return (
      slides
        .map((slide) => ({ slide, area: visibleArea(slide) }))
        .sort((a, b) => b.area - a.area)[0]?.slide || slides[0]
    );
  }

  function markActiveSlide(slide: Element | null) {
    document.querySelectorAll("[data-wysiwyg-current-slide]").forEach((element) => {
      element.removeAttribute("data-wysiwyg-current-slide");
    });
    if (!slide) return;
    activeSlideId = ensureId(slide);
    slide.setAttribute("data-wysiwyg-current-slide", "true");
  }

  function publishDeck() {
    const startedAt = win.performance.now();
    const slides = slideCandidates();
    if (!slides.length) {
      slideVisibilityObserver?.disconnect();
      observedSlideSignature = "";
      post("wysiwyg-deck", { slides: [], activeId: "" });
      recordTiming("deck", startedAt);
      recordTiming("deckDetection", startedAt);
      return;
    }
    const activeSlide = nearestSlide(slides);
    markActiveSlide(activeSlide);
    observeSlideVisibility(slides);
    post("wysiwyg-deck", {
      activeId: activeSlide ? (activeSlide as HTMLElement).dataset.wysiwygId : "",
      slides: slides.map((slide, index) => ({
        id: ensureId(slide),
        index,
        title: slideTitle(slide, index),
        section: slide.getAttribute("data-section") || slide.getAttribute("data-title") || "",
        thumbnailHtml: slideThumbnailHtml(slide),
      })),
    });
    recordTiming("deck", startedAt);
    recordTiming("deckDetection", startedAt);
  }

  function scheduleDeckPublish() {
    win.clearTimeout(deckTimer);
    deckTimer = win.setTimeout(publishDeck, 120);
  }

  function publishActiveFromViewport() {
    const slides = slideCandidates();
    const visible = slides
      .map((slide) => ({ slide, area: visibleArea(slide) }))
      .sort((a, b) => b.area - a.area)[0];
    if (!visible || visible.area <= 0 || ensureId(visible.slide) === activeSlideId) return;
    markActiveSlide(visible.slide);
    publishDeck();
  }

  function publishChange(reason = "edit") {
    const changedSlide = selectedElement?.closest(SLIDE_SELECTOR);
    if (changedSlide) invalidateThumbnail(changedSlide, `full:${reason}`);
    post("wysiwyg-document-change", {
      reason,
      html: serialize(),
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    });
    publishSelected();
    publishLayers();
    scheduleDeckPublish();
    publishAudit();
  }

  function operationLocator(element: Element) {
    return {
      path: sourcePath(element),
      tagName: element.tagName.toLowerCase(),
      domId: element.id || "",
      classes: Array.from(element.classList),
    };
  }

  function publishIncrementalChange(
    kind: "text" | "style" | "class",
    value: string,
    target: Element | null,
    reason: string,
  ) {
    if (!target) {
      publishChange(reason);
      return;
    }
    if (kind === "text") {
      if (lastPublishedText.get(target) === value) return;
      lastPublishedText.set(target, value);
    }
    const changedSlide = slideCandidates().find((slide) => slide === target || slide.contains(target));
    if (changedSlide) invalidateThumbnail(changedSlide, `incremental:${reason}`);
    editorMutatedElements.add(target);
    win.setTimeout(() => editorMutatedElements.delete(target), 0);
    post("wysiwyg-operation", {
      operation: {
        id: "op-" + ++operationCounter,
        kind,
        reason,
        locator: operationLocator(target),
        value,
      },
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    });
    publishSelected();
    scheduleDeckPublish();
  }

  function auditLabel(element: Element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) return tag + "#" + element.id;
    const firstClass = element.classList[0];
    return firstClass ? tag + "." + firstClass : tag;
  }

  function addAuditFinding(
    findings: Array<{ id: string; elementId: string; type: string; label: string; message: string }>,
    element: Element,
    type: string,
    message: string,
  ) {
    const elementId = ensureId(element);
    findings.push({
      id: `${type}-${elementId}`,
      elementId,
      type,
      label: auditLabel(element),
      message,
    });
  }

  function publishAudit() {
    const startedAt = win.performance.now();
    const findings: Array<{ id: string; elementId: string; type: string; label: string; message: string }> = [];
    document.querySelectorAll("img").forEach((image) => {
      if ((image as HTMLElement).dataset.wysiwygEditor === "true") return;
      const src = image.getAttribute("src") || "";
      if (!src.trim() || (image as HTMLElement).dataset.cosmicImageError === "true") {
        addAuditFinding(findings, image, "broken-image", "Image source is empty or failed to load.");
      }
      if (!image.hasAttribute("alt") || !(image.getAttribute("alt") || "").trim()) {
        addAuditFinding(findings, image, "missing-alt", "Image is missing alt text.");
      }
    });

    document.querySelectorAll("script[data-wysiwyg-preserved-script]").forEach((script) => {
      addAuditFinding(findings, script, "inert-script", "External or inline script is inert while editing.");
    });

    document.querySelectorAll("body *").forEach((element) => {
      if ((element as HTMLElement).dataset.wysiwygEditor === "true") return;
      if (element.closest('[data-wysiwyg-editor="true"]')) return;
      const htmlElement = element as HTMLElement;
      if (htmlElement.scrollWidth > htmlElement.clientWidth + 1 || htmlElement.scrollHeight > htmlElement.clientHeight + 1) {
        addAuditFinding(findings, element, "overflow", "Content appears clipped or overflowing.");
      }
      const fontSize = Number.parseFloat(win.getComputedStyle(element).fontSize || "0");
      if (fontSize > 0 && fontSize < 12) {
        addAuditFinding(findings, element, "tiny-font", "Text is smaller than 12px.");
      }
    });

    post("wysiwyg-audit", { findings });
    recordTiming("auditScan", startedAt);
  }

  function elementLabel(element: Element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) return tag + "#" + element.id;
    const firstClass = element.classList[0];
    return firstClass ? tag + "." + firstClass : tag;
  }

  function breadcrumb(element: Element) {
    const trail: Array<{ id: string; label: string }> = [];
    let node: Element | null = element;
    while (node && node !== document.documentElement) {
      if ((node as HTMLElement).dataset && (node as HTMLElement).dataset.wysiwygEditor === "true") break;
      trail.unshift({ id: ensureId(node), label: elementLabel(node) });
      node = node.parentElement;
    }
    return trail;
  }

  function sourcePath(element: Element) {
    const path: number[] = [];
    let node: Element | null = element;
    while (node && node !== document.documentElement) {
      const parent: Element | null = node.parentElement;
      if (!parent) return [];
      const siblings = Array.from(parent.children).filter(
        (sibling) => (sibling as HTMLElement).dataset?.wysiwygEditor !== "true",
      );
      const index = siblings.indexOf(node);
      if (index < 0) return [];
      path.unshift(index);
      node = parent;
    }
    return path;
  }

  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement("div");
    chip.className = "wysiwyg-chip";
    chip.dataset.wysiwygEditor = "true";
    chipLabel = document.createElement("span");
    chip.append(chipLabel);
    const addButton = (text: string, title: string, onClick: () => void, danger: boolean) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.title = title;
      if (danger) button.className = "danger";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      chip?.append(button);
    };
    addButton("↖", "Select parent", selectParent, false);
    addButton("⧉", "Duplicate", duplicateSelected, false);
    addButton("✕", "Delete", deleteSelected, true);
    document.body.append(chip);
    return chip;
  }

  function ensureResizeHandle() {
    if (resizeHandle) return resizeHandle;
    resizeHandle = document.createElement("button");
    resizeHandle.type = "button";
    resizeHandle.className = "wysiwyg-resize-handle";
    resizeHandle.dataset.wysiwygEditor = "true";
    resizeHandle.dataset.wysiwygResizeHandle = "se";
    resizeHandle.title = "Resize";
    resizeHandle.setAttribute("aria-label", "Resize selected element");
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (!selectedElement || mode === "preview") return;
      event.preventDefault();
      event.stopPropagation();
      const element = selectedElement as HTMLElement;
      const rect = element.getBoundingClientRect();
      const styles = win.getComputedStyle(element);
      const width = Number.parseFloat(element.style.width || "") || rect.width || Number.parseFloat(styles.width || "0");
      const height = Number.parseFloat(element.style.height || "") || rect.height || Number.parseFloat(styles.height || "0");
      resizeState = {
        element,
        startX: event.clientX,
        startY: event.clientY,
        baseWidth: width || 24,
        baseHeight: height || 24,
      };
      resizeHandle?.setPointerCapture?.(event.pointerId);
    });
    document.body.append(resizeHandle);
    return resizeHandle;
  }

  function ensureGuide(kind: "vertical" | "horizontal") {
    const current = kind === "vertical" ? verticalGuide : horizontalGuide;
    if (current) return current;
    const guide = document.createElement("div");
    guide.className = `wysiwyg-snap-guide wysiwyg-snap-guide-${kind}`;
    guide.dataset.wysiwygEditor = "true";
    guide.dataset.wysiwygSnapGuide = kind;
    guide.style.display = "none";
    document.body.append(guide);
    if (kind === "vertical") verticalGuide = guide;
    else horizontalGuide = guide;
    return guide;
  }

  function hideSnapGuides() {
    if (verticalGuide) verticalGuide.style.display = "none";
    if (horizontalGuide) horizontalGuide.style.display = "none";
  }

  function updateSnapGuides(dx: number, dy: number) {
    if (!dragState || !dragState.parentRect) {
      hideSnapGuides();
      return;
    }
    const tolerance = 2;
    const parentRect = dragState.parentRect;
    const rect = dragState.baseRect;
    const centerX = rect.left + rect.width / 2 + dx;
    const centerY = rect.top + rect.height / 2 + dy;
    const parentCenterX = parentRect.left + parentRect.width / 2;
    const parentCenterY = parentRect.top + parentRect.height / 2;
    const vertical = ensureGuide("vertical");
    const horizontal = ensureGuide("horizontal");

    if (Math.abs(centerX - parentCenterX) <= tolerance) {
      vertical.style.display = "block";
      vertical.style.left = parentCenterX + win.scrollX + "px";
      vertical.style.top = parentRect.top + win.scrollY + "px";
      vertical.style.height = parentRect.height + "px";
    } else {
      vertical.style.display = "none";
    }

    if (Math.abs(centerY - parentCenterY) <= tolerance) {
      horizontal.style.display = "block";
      horizontal.style.left = parentRect.left + win.scrollX + "px";
      horizontal.style.top = parentCenterY + win.scrollY + "px";
      horizontal.style.width = parentRect.width + "px";
    } else {
      horizontal.style.display = "none";
    }
  }

  function updateResizeHandle() {
    if (!selectedElement || mode === "preview" || selectedElement === document.body) {
      if (resizeHandle) resizeHandle.style.display = "none";
      return;
    }
    ensureResizeHandle();
    if (resizeHandle && !document.body.contains(resizeHandle)) document.body.append(resizeHandle);
    if (!resizeHandle) return;
    const rect = selectedElement.getBoundingClientRect();
    resizeHandle.style.display = "grid";
    resizeHandle.style.left = Math.max(4, rect.right + win.scrollX - 8) + "px";
    resizeHandle.style.top = Math.max(4, rect.bottom + win.scrollY - 8) + "px";
  }

  function updateChip() {
    if (!selectedElement || mode === "preview" || !document.body.contains(selectedElement)) {
      if (chip) chip.style.display = "none";
      if (resizeHandle) resizeHandle.style.display = "none";
      return;
    }
    ensureChip();
    if (chip && !document.body.contains(chip)) document.body.append(chip);
    if (!chip || !chipLabel) return;
    chipLabel.textContent = elementLabel(selectedElement);
    chip.style.display = "flex";
    const rect = selectedElement.getBoundingClientRect();
    chip.style.top = Math.max(win.scrollY + 4, rect.top + win.scrollY - 30) + "px";
    chip.style.left = Math.max(4, rect.left + win.scrollX) + "px";
    updateResizeHandle();
  }

  function publishSelected() {
    const startedAt = win.performance.now();
    updateChip();
    if (!selectedElement) {
      post("wysiwyg-selection", { selected: null });
      publishLayers();
      publishOutline();
      recordTiming("selection", startedAt);
      recordTiming("selectionPublication", startedAt);
      return;
    }

    const styles = win.getComputedStyle(selectedElement);
    const rect = selectedElement.getBoundingClientRect();
    const isImage = selectedElement.tagName.toLowerCase() === "img";
    const canHaveBackground = selectedElement === document.body || selectedElement.matches(SLIDE_SELECTOR);
    const textTarget = editableTextTarget(selectedElement);
    post("wysiwyg-selection", {
      selected: {
        id: ensureId(selectedElement),
        domId: selectedElement.id || "",
        tagName: selectedElement.tagName.toLowerCase(),
        text: textTarget?.textContent || "",
        childElementCount: selectedElement.childElementCount,
        editableText: Boolean(textTarget),
        editing: Boolean(textTarget && editingElement === textTarget),
        classes: Array.from(selectedElement.classList),
        ancestors: breadcrumb(selectedElement),
        sourcePath: sourcePath(selectedElement),
        isImage,
        imageSrc: isImage ? selectedElement.getAttribute("src") || "" : "",
        imageAlt: isImage ? selectedElement.getAttribute("alt") || "" : "",
        imageFit: isImage ? imageFitMode(selectedElement) : "",
        canHaveBackground,
        backgroundImage: canHaveBackground ? cssUrlValue(styles.backgroundImage) : "",
        styles: {
          color: colorToHex(styles.color),
          backgroundColor: colorToHex(styles.backgroundColor),
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          textAlign: styles.textAlign,
          padding: styles.padding,
          margin: styles.margin,
          width: Math.round(rect.width) + "px",
          height: Math.round(rect.height) + "px",
          borderRadius: styles.borderRadius,
        },
      },
    });
    publishLayers();
    publishOutline();
    recordTiming("selection", startedAt);
    recordTiming("selectionPublication", startedAt);
  }

  function publishLayers() {
    const parent = selectedElement?.parentElement || null;
    if (!parent) {
      post("wysiwyg-layers", { layers: [] });
      return;
    }
    const layers = Array.from(parent.children)
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        return htmlElement.dataset.wysiwygEditor !== "true" && element.tagName.toLowerCase() !== "script";
      })
      .map((element) => ({
        id: ensureId(element),
        label: elementLabel(element),
        active: element === selectedElement,
        zIndex: (element as HTMLElement).style.zIndex || win.getComputedStyle(element).zIndex || "auto",
      }))
      .reverse();
    post("wysiwyg-layers", { layers });
  }

  function eligibleOutlineElement(element: Element) {
    const tag = element.tagName.toLowerCase();
    return !["script", "style", "meta", "link", "title"].includes(tag) &&
      (element as HTMLElement).dataset.wysiwygEditor !== "true" &&
      !element.closest('[data-wysiwyg-editor="true"]');
  }

  function outlineDepth(element: Element) {
    let depth = 0;
    let parent = element.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (eligibleOutlineElement(parent)) depth += 1;
      parent = parent.parentElement;
    }
    return depth;
  }

  function publishOutline() {
    const all = document.body
      ? [document.body, ...Array.from(document.body.querySelectorAll("*"))].filter(eligibleOutlineElement)
      : [];
    const limited = all.slice(0, 5000);
    post("wysiwyg-outline", {
      truncated: all.length > limited.length,
      items: limited.map((element) => ({
        id: ensureId(element),
        parentId: element.parentElement && eligibleOutlineElement(element.parentElement)
          ? ensureId(element.parentElement)
          : "",
        label: elementLabel(element),
        depth: outlineDepth(element),
        hasChildren: Array.from(element.children).some(eligibleOutlineElement),
        active: element === selectedElement,
        hidden: element.getAttribute("data-wysiwyg-editor-hidden") === "true",
        locked: element.getAttribute("data-wysiwyg-editor-locked") === "true",
        pickThrough: element.getAttribute("data-wysiwyg-editor-pick-through") === "true",
      })),
    });
  }

  function scheduleOutlinePublish() {
    win.clearTimeout(outlineTimer);
    outlineTimer = win.setTimeout(publishOutline, 80);
  }

  function setOutlineFlag(data: Record<string, unknown>, attribute: string) {
    const element = selectedById(String(data.id || ""));
    if (!element) return;
    if (Boolean(data.enabled)) element.setAttribute(attribute, "true");
    else element.removeAttribute(attribute);
    if (attribute === "data-wysiwyg-editor-hidden" && element === selectedElement) updateChip();
    publishOutline();
  }

  function restoreContentEditable(element: Element | null) {
    if (!element) return;
    if (editingElement === element) editingElement = null;
    const original = element.getAttribute("data-wysiwyg-original-contenteditable");
    if (original !== null) {
      if (original === NONE) {
        element.removeAttribute("contenteditable");
      } else {
        element.setAttribute("contenteditable", original);
      }
      element.removeAttribute("data-wysiwyg-original-contenteditable");
    }
    const originalSpellcheck = element.getAttribute("data-wysiwyg-original-spellcheck");
    if (originalSpellcheck !== null) {
      if (originalSpellcheck === NONE) {
        element.removeAttribute("spellcheck");
      } else {
        element.setAttribute("spellcheck", originalSpellcheck);
      }
      element.removeAttribute("data-wysiwyg-original-spellcheck");
    }
    element.removeAttribute("data-wysiwyg-editing");
  }

  function makeEditable(element: Element | null) {
    if (!element || element === document.documentElement || element === document.head) return false;
    const target = editableTextTarget(element);
    if (!target) return false;
    if (!target.hasAttribute("data-wysiwyg-original-contenteditable")) {
      const original = target.hasAttribute("contenteditable")
        ? target.getAttribute("contenteditable") || ""
        : NONE;
      target.setAttribute("data-wysiwyg-original-contenteditable", original);
    }
    if (!target.hasAttribute("data-wysiwyg-original-spellcheck")) {
      const original = target.hasAttribute("spellcheck") ? target.getAttribute("spellcheck") || "" : NONE;
      target.setAttribute("data-wysiwyg-original-spellcheck", original);
    }
    target.setAttribute("contenteditable", "true");
    target.setAttribute("spellcheck", "true");
    target.setAttribute("data-wysiwyg-editing", "true");
    editingElement = target;
    lastPublishedText.set(target, target.textContent || "");
    (target as HTMLElement).focus({ preventScroll: true });
    return true;
  }

  function reportUnsupportedEditTarget(element: Element) {
    const tag = element.tagName.toLowerCase();
    const message = tag === "canvas"
      ? "Canvas pixels are not editable as HTML text. Select and style the canvas element instead."
      : tag === "iframe"
        ? "Nested iframe content cannot be edited from the parent document."
        : element.namespaceURI?.includes("svg")
          ? "This SVG structure has no directly editable text target. Select a text node from the Outline when available."
          : "This structured container has no safe direct text target. Select a text child from the Outline.";
    post("wysiwyg-diagnostic", {
      diagnostic: {
        id: "unsupported-edit-target-" + ensureId(element),
        code: "unsupported-edit-target",
        severity: "info",
        title: "Element cannot enter text editing",
        message,
      },
    });
  }

  function caretPositionToRange(position: CaretPosition | null | undefined) {
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  function placeCaretAtPoint(x: number, y: number, within: Element) {
    const docWithCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    };
    const range =
      docWithCaret.caretRangeFromPoint?.(x, y) ??
      caretPositionToRange(docWithCaret.caretPositionFromPoint?.(x, y));
    if (!range) {
      placeCaretAtEnd(within);
      return;
    }
    const container =
      range.startContainer.nodeType === win.Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    if (!container || (container !== within && !within.contains(container))) {
      placeCaretAtEnd(within);
      return;
    }
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function placeCaretAtEnd(within: Element) {
    const range = document.createRange();
    range.selectNodeContents(within);
    range.collapse(false);
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function pickElement(start: EventTarget | null) {
    if (!(start instanceof win.Element)) return null;
    if ((start as HTMLElement).dataset.wysiwygEditor === "true") return null;
    if (start.closest('[data-wysiwyg-editor="true"]')) return null;
    const locked = start.closest('[data-wysiwyg-editor-locked="true"]');
    if (locked) {
      const parent = locked.parentElement;
      return parent && parent !== document.documentElement ? parent : null;
    }
    if (start === document.documentElement || start === document.head) return null;
    return start === document.body ? document.body : start;
  }

  function selectElement(element: Element | null) {
    if (!element) return;
    ensureId(element);
    if (selectedElement && selectedElement !== element) {
      restoreContentEditable(editableTextTarget(selectedElement));
      selectedElement.removeAttribute("data-wysiwyg-selected");
      restoreContentEditable(selectedElement);
    }
    selectedElement = element;
    selectedElement.setAttribute("data-wysiwyg-selected", "true");
    const selectedSlide = selectedElement.closest(SLIDE_SELECTOR);
    if (selectedSlide) activeSlideId = ensureId(selectedSlide);
    if (mode !== "text") restoreContentEditable(selectedElement);
    publishSelected();
    scheduleDeckPublish();
  }

  function clearSelection() {
    if (!selectedElement) return;
    restoreContentEditable(editableTextTarget(selectedElement));
    selectedElement.removeAttribute("data-wysiwyg-selected");
    restoreContentEditable(selectedElement);
    selectedElement = null;
    publishSelected();
  }

  function setHover(element: Element | null) {
    if (hoveredElement && hoveredElement !== selectedElement) {
      hoveredElement.removeAttribute("data-wysiwyg-hover");
    }
    hoveredElement = element;
    if (hoveredElement && hoveredElement !== selectedElement && mode !== "preview") {
      hoveredElement.setAttribute("data-wysiwyg-hover", "true");
    }
  }

  function selectedById(id: string) {
    if (!id) return selectedElement;
    return document.querySelector('[data-wysiwyg-id="' + win.CSS.escape(id) + '"]');
  }

  function applyStyles(styles: Record<string, unknown> | undefined) {
    if (!selectedElement || !styles) return;
    for (const [key, value] of Object.entries(styles)) {
      if (value === null || value === undefined) continue;
      (selectedElement as HTMLElement).style[key as any] = String(value);
    }
    publishIncrementalChange("style", selectedElement.getAttribute("style") || "", selectedElement, "style");
  }

  function setText(text: string) {
    if (!selectedElement) return;
    const target = editableTextTarget(selectedElement);
    if (!target) return;
    target.textContent = text;
    publishIncrementalChange("text", target.textContent || "", target, "text");
  }

  function ancestorCycleTarget(target: Element) {
    const chain: Element[] = [];
    let node: Element | null = target;
    while (node && node !== document.documentElement) {
      if ((node as HTMLElement).dataset.wysiwygEditor !== "true") chain.push(node);
      node = node.parentElement;
    }
    if (!chain.length) return target;
    const currentIndex = selectedElement ? chain.indexOf(selectedElement) : -1;
    return currentIndex < 0 ? chain[0] : chain[(currentIndex + 1) % chain.length];
  }

  function selectParent() {
    if (!selectedElement) return;
    const parent = selectedElement.parentElement;
    const target = pickElement(parent);
    if (!target || target === selectedElement) return;
    selectElement(target);
  }

  function setClass(name: unknown, action: unknown) {
    if (!selectedElement || !name) return;
    const className = String(name).trim();
    if (!className) return;
    if (action === "add") selectedElement.classList.add(className);
    else if (action === "remove") selectedElement.classList.remove(className);
    else selectedElement.classList.toggle(className);
    publishIncrementalChange("class", selectedElement.getAttribute("class") || "", selectedElement, "class");
  }

  function replaceImage(src: unknown, alt: unknown) {
    if (!selectedElement || selectedElement.tagName.toLowerCase() !== "img") return;
    if (typeof src === "string" && src) selectedElement.setAttribute("src", src);
    selectedElement.removeAttribute("data-cosmic-image-error");
    if (typeof alt === "string") selectedElement.setAttribute("alt", alt);
    publishChange("image");
  }

  function setImageFit(fit: unknown) {
    if (!selectedElement || selectedElement.tagName.toLowerCase() !== "img") return;
    const image = selectedElement as HTMLElement;
    if (fit === "fit") image.style.objectFit = "contain";
    else if (fit === "fill") image.style.objectFit = "fill";
    else if (fit === "crop") image.style.objectFit = "cover";
    else return;
    image.style.objectPosition = "center";
    publishChange("image-fit");
  }

  function backgroundTarget() {
    if (selectedElement === document.body) return document.body;
    if (selectedElement?.matches(SLIDE_SELECTOR)) return selectedElement as HTMLElement;
    const selectedSlide = selectedElement?.closest(SLIDE_SELECTOR) as HTMLElement | null;
    if (selectedSlide) return selectedSlide;
    return (nearestSlide(slideCandidates()) as HTMLElement | null) || document.body;
  }

  function replaceBackground(src: unknown) {
    const target = backgroundTarget();
    const value = String(src || "").trim();
    if (!value) {
      target.style.backgroundImage = "";
      publishChange("background");
      return;
    }
    target.style.backgroundImage = cssUrl(value);
    target.style.backgroundSize = "cover";
    target.style.backgroundPosition = "center";
    publishChange("background");
  }

  function setThemeFont(fontFamily: unknown) {
    const family = String(fontFamily || "").trim();
    if (!family) return;
    document.documentElement.style.fontFamily = family;
    publishChange("theme-font");
  }

  function swapStyleAttribute(element: Element, from: string, to: string) {
    const raw = element.getAttribute("style");
    if (!raw || !raw.includes(from)) return false;
    element.setAttribute("style", raw.split(from).join(to));
    return true;
  }

  function swapThemeColor(fromValue: unknown, toValue: unknown) {
    const from = String(fromValue || "").trim();
    const to = String(toValue || "").trim();
    if (!from || !to || from === to) return;
    let changed = false;
    [document.documentElement, document.body, ...Array.from(document.querySelectorAll<HTMLElement>("[style]"))].forEach(
      (element) => {
        changed = swapStyleAttribute(element, from, to) || changed;
      },
    );
    if (changed) publishChange("theme-color");
  }

  function setSlideBackground(colorValue: unknown) {
    const color = String(colorValue || "").trim();
    if (!color) return;
    const target = backgroundTarget();
    target.style.backgroundColor = color;
    publishChange("slide-background");
  }

  function clearFindHighlights() {
    document.querySelectorAll("mark[data-wysiwyg-find]").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    });
  }

  function editableTextNodes() {
    const walker = document.createTreeWalker(document.body, win.NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        parent &&
        node.textContent &&
        !parent.closest("script, style, [data-wysiwyg-editor='true'], mark[data-wysiwyg-find]")
      ) {
        nodes.push(node as Text);
      }
      node = walker.nextNode();
    }
    return nodes;
  }

  function highlightFindText(queryValue: unknown) {
    clearFindHighlights();
    const query = String(queryValue || "");
    if (!query) {
      post("wysiwyg-find", { query, count: 0 });
      return;
    }
    let count = 0;
    const needle = query.toLowerCase();
    editableTextNodes().forEach((node) => {
      const text = node.textContent || "";
      const lower = text.toLowerCase();
      let index = 0;
      let match = lower.indexOf(needle, index);
      if (match < 0) return;
      const fragment = document.createDocumentFragment();
      while (match >= 0) {
        if (match > index) fragment.append(document.createTextNode(text.slice(index, match)));
        const mark = document.createElement("mark");
        mark.dataset.wysiwygFind = "true";
        mark.textContent = text.slice(match, match + query.length);
        fragment.append(mark);
        count += 1;
        index = match + query.length;
        match = lower.indexOf(needle, index);
      }
      if (index < text.length) fragment.append(document.createTextNode(text.slice(index)));
      node.replaceWith(fragment);
    });
    const first = document.querySelector("mark[data-wysiwyg-find]");
    first?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    post("wysiwyg-find", { query, count });
  }

  function replaceTextNodes(queryValue: unknown, replacementValue: unknown) {
    clearFindHighlights();
    const query = String(queryValue || "");
    if (!query) return;
    const replacement = String(replacementValue || "");
    let changed = false;
    editableTextNodes().forEach((node) => {
      const text = node.textContent || "";
      if (!text.includes(query)) return;
      node.textContent = text.split(query).join(replacement);
      changed = true;
    });
    if (changed) publishChange("replace-text");
    highlightFindText(replacement || query);
  }

  function duplicateSelected() {
    if (!selectedElement || !selectedElement.parentElement || selectedElement === document.body) return;
    const clone = selectedElement.cloneNode(true) as Element;
    clone.removeAttribute("data-wysiwyg-selected");
    clone.querySelectorAll("[data-wysiwyg-id]").forEach((element) => element.removeAttribute("data-wysiwyg-id"));
    selectedElement.after(clone);
    selectElement(clone);
    publishChange("duplicate");
  }

  function deleteSelected() {
    if (!selectedElement || selectedElement === document.body) return;
    const next = selectedElement.parentElement || document.body;
    selectedElement.remove();
    selectedElement = null;
    selectElement(next);
    publishChange("delete");
  }

  function baseTransform(element: HTMLElement) {
    if (element.dataset.wysiwygBaseTransform === undefined) {
      element.dataset.wysiwygBaseTransform = element.style.transform || "";
    }
    return element.dataset.wysiwygBaseTransform;
  }

  function currentTranslate(element: HTMLElement) {
    return {
      dx: Number(element.dataset.wysiwygTx || 0),
      dy: Number(element.dataset.wysiwygTy || 0),
    };
  }

  function setTranslate(element: HTMLElement, dx: number, dy: number) {
    const base = baseTransform(element);
    element.dataset.wysiwygTx = String(dx);
    element.dataset.wysiwygTy = String(dy);
    const next = ("translate(" + dx + "px, " + dy + "px) " + base).trim();
    element.style.transform = next;
  }

  function nudge(dx: number, dy: number) {
    if (!selectedElement) return;
    const htmlElement = selectedElement as HTMLElement;
    const current = currentTranslate(htmlElement);
    setTranslate(htmlElement, current.dx + dx, current.dy + dy);
    publishChange("move");
  }

  function layoutSelected(action: unknown) {
    if (!selectedElement || selectedElement === document.body) return;
    const element = selectedElement as HTMLElement;
    if (action === "align-left") {
      element.style.display = "block";
      element.style.marginLeft = "0";
      element.style.marginRight = "auto";
      publishChange("layout");
      return;
    }
    if (action === "align-center") {
      element.style.display = "block";
      element.style.marginLeft = "auto";
      element.style.marginRight = "auto";
      publishChange("layout");
      return;
    }
    if (action === "align-right") {
      element.style.display = "block";
      element.style.marginLeft = "auto";
      element.style.marginRight = "0";
      publishChange("layout");
      return;
    }
    if (action === "distribute-horizontal") {
      const parent = selectedElement.parentElement as HTMLElement | null;
      if (!parent) return;
      const siblings = Array.from(parent.children).filter((child) => {
        const htmlChild = child as HTMLElement;
        return htmlChild.dataset.wysiwygEditor !== "true" && child.tagName.toLowerCase() !== "script";
      });
      if (siblings.length < 2) return;
      parent.style.display = "flex";
      parent.style.justifyContent = "space-between";
      parent.style.alignItems = parent.style.alignItems || "stretch";
      parent.style.gap = parent.style.gap || "16px";
      publishChange("layout");
    }
  }

  function siblingZValues(element: HTMLElement) {
    const parent = element.parentElement;
    if (!parent) return [0];
    return Array.from(parent.children)
      .filter((child) => child !== element && (child as HTMLElement).dataset.wysiwygEditor !== "true")
      .map((child) => Number.parseInt((child as HTMLElement).style.zIndex || win.getComputedStyle(child).zIndex || "0", 10))
      .filter((value) => Number.isFinite(value));
  }

  function setZOrder(action: unknown) {
    if (!selectedElement || selectedElement === document.body) return;
    const element = selectedElement as HTMLElement;
    if (!element.style.position || element.style.position === "static") element.style.position = "relative";
    const current = Number.parseInt(element.style.zIndex || win.getComputedStyle(element).zIndex || "0", 10) || 0;
    const siblings = siblingZValues(element);
    const min = Math.min(0, ...siblings);
    const max = Math.max(0, ...siblings);
    if (action === "bring-forward") element.style.zIndex = String(Math.max(current + 1, max + 1));
    else if (action === "send-backward") element.style.zIndex = String(Math.min(current - 1, min - 1));
    else if (action === "bring-to-front") element.style.zIndex = String(max + 1);
    else if (action === "send-to-back") element.style.zIndex = String(min - 1);
    else return;
    publishChange("z-order");
  }

  function goToSlide(payload: Record<string, unknown>) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : slides[Number(payload?.index || 0)];
    if (!slide) return;
    clearSelection();
    markActiveSlide(slide);
    slide.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishDeck();
  }

  function slideFromPayload(payload: Record<string, unknown>) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : nearestSlide(slides);
    return { slides, slide };
  }

  function clearEditorState(element: Element) {
    element.removeAttribute("data-wysiwyg-current-slide");
    element.removeAttribute("data-wysiwyg-selected");
    element.removeAttribute("data-wysiwyg-hover");
    element.removeAttribute("data-wysiwyg-id");
    element
      .querySelectorAll("[data-wysiwyg-id], [data-wysiwyg-selected], [data-wysiwyg-hover], [data-wysiwyg-current-slide]")
      .forEach((child) => {
        child.removeAttribute("data-wysiwyg-current-slide");
        child.removeAttribute("data-wysiwyg-selected");
        child.removeAttribute("data-wysiwyg-hover");
        child.removeAttribute("data-wysiwyg-id");
      });
  }

  function replaceFirstText(element: Element, selector: string, text: string) {
    const target = element.querySelector(selector);
    if (!target) return false;
    target.textContent = text;
    return true;
  }

  function prepareNewSlide(slide: Element) {
    clearEditorState(slide);
    slide.setAttribute("data-title", "New slide");
    if (slide.classList.length === 0) slide.classList.add("slide");
    if (!replaceFirstText(slide, "h1, h2, h3", "New slide")) {
      const heading = document.createElement("h2");
      heading.textContent = "New slide";
      slide.prepend(heading);
    }
    if (!replaceFirstText(slide, "p", "Add your main point here.")) {
      const paragraph = document.createElement("p");
      paragraph.textContent = "Add your main point here.";
      slide.append(paragraph);
    }
  }

  function clearSlideContents(slide: Element) {
    while (slide.firstChild) slide.firstChild.remove();
  }

  function textElement(tagName: string, text: string, className = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function templateImage() {
    const image = document.createElement("img");
    image.src = placeholderImageSrc();
    image.alt = "Placeholder image";
    image.style.maxWidth = "100%";
    image.style.height = "auto";
    return image;
  }

  function replaceSlideWithTemplate(slide: Element, template: unknown) {
    const kind = String(template || "").trim();
    clearEditorState(slide);
    clearSlideContents(slide);

    if (kind === "title") {
      slide.setAttribute("data-title", "Presentation title");
      slide.append(
        textElement("p", "Subtitle or presenter", "eyebrow"),
        textElement("h1", "Presentation title"),
        textElement("p", "A concise setup for the story this deck will tell.", "summary"),
      );
      return true;
    }

    if (kind === "section") {
      slide.setAttribute("data-title", "Section divider");
      slide.append(
        textElement("p", "Section", "eyebrow"),
        textElement("h2", "Section divider"),
        textElement("p", "Frame the next group of slides in one sentence.", "summary"),
      );
      return true;
    }

    if (kind === "quote") {
      slide.setAttribute("data-title", "Quote");
      const figure = document.createElement("figure");
      figure.append(textElement("blockquote", "A sharp quote or customer signal belongs here."));
      figure.append(textElement("figcaption", "Source or attribution"));
      slide.append(figure);
      return true;
    }

    if (kind === "image-text") {
      slide.setAttribute("data-title", "Image and text");
      const layout = document.createElement("div");
      layout.className = "media-layout";
      layout.style.display = "grid";
      layout.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr)";
      layout.style.gap = "28px";
      layout.style.alignItems = "center";
      const copy = document.createElement("div");
      copy.append(
        textElement("h2", "Image and text"),
        textElement("p", "Pair one visual with the decision, insight, or example it supports."),
      );
      layout.append(templateImage(), copy);
      slide.append(layout);
      return true;
    }

    if (kind === "metrics") {
      slide.setAttribute("data-title", "Metrics");
      slide.append(textElement("h2", "Key metrics"));
      const metrics = document.createElement("section");
      metrics.className = "metrics";
      [
        ["42%", "Primary result"],
        ["18", "Adoption signal"],
        ["3", "Open decisions"],
      ].forEach(([value, label]) => {
        const card = document.createElement("div");
        card.className = "metric";
        card.append(textElement("strong", value), textElement("span", label));
        metrics.append(card);
      });
      slide.append(metrics);
      return true;
    }

    if (kind === "agenda") {
      slide.setAttribute("data-title", "Agenda");
      slide.append(textElement("h2", "Agenda"));
      const list = document.createElement("ol");
      ["Context", "Evidence", "Recommendation", "Next steps"].forEach((item) => {
        list.append(textElement("li", item));
      });
      slide.append(list);
      return true;
    }

    if (kind === "closing") {
      slide.setAttribute("data-title", "Closing");
      slide.append(
        textElement("p", "Next steps", "eyebrow"),
        textElement("h2", "Closing"),
        textElement("p", "End with the decision, owner, and date that moves this forward.", "summary"),
      );
      return true;
    }

    return false;
  }

  function duplicateSlide(payload: Record<string, unknown>) {
    const slides = slideCandidates();
    const slide = payload?.id
      ? slides.find((candidate) => ensureId(candidate) === payload.id)
      : nearestSlide(slides);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(true) as Element;
    clearEditorState(clone);
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("duplicate-slide");
  }

  function insertSlide(payload: Record<string, unknown>) {
    const { slide } = slideFromPayload(payload);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(true) as Element;
    prepareNewSlide(clone);
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-slide");
  }

  function insertSlideTemplate(payload: Record<string, unknown>) {
    const { slide } = slideFromPayload(payload);
    if (!slide || !slide.parentElement) return;
    const clone = slide.cloneNode(false) as Element;
    if (!replaceSlideWithTemplate(clone, payload.template)) return;
    slide.after(clone);
    clearSelection();
    markActiveSlide(clone);
    clone.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-slide-template");
    publishDeck();
  }

  function renameSlide(payload: Record<string, unknown>) {
    const { slide } = slideFromPayload(payload);
    const title = String(payload.title || "").trim();
    if (!slide || !title) return;
    slide.setAttribute("data-title", title);
    const heading = slide.querySelector("h1, h2, h3");
    if (heading) {
      heading.textContent = title;
    } else {
      const fallbackHeading = document.createElement("h2");
      fallbackHeading.textContent = title;
      slide.prepend(fallbackHeading);
    }
    markActiveSlide(slide);
    publishChange("rename-slide");
    publishDeck();
  }

  function deleteSlide(payload: Record<string, unknown>) {
    const { slides, slide } = slideFromPayload(payload);
    if (!slide || !slide.parentElement) return;
    const index = slides.indexOf(slide);
    const next = slides[index + 1] || slides[index - 1] || null;
    if (selectedElement && slide.contains(selectedElement)) {
      selectedElement.removeAttribute("data-wysiwyg-selected");
      restoreContentEditable(editableTextTarget(selectedElement));
      restoreContentEditable(selectedElement);
      selectedElement = null;
    }
    slide.remove();
    if (next && document.body.contains(next)) {
      markActiveSlide(next);
      next.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } else {
      activeSlideId = "";
    }
    publishChange("delete-slide");
    publishDeck();
  }

  function moveSlide(payload: Record<string, unknown>) {
    const { slides, slide } = slideFromPayload(payload);
    const offset = Math.trunc(Number(payload.offset || 0));
    if (!slide || !slide.parentElement || offset === 0) return;
    const currentIndex = slides.indexOf(slide);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= slides.length) return;
    const target = slides[targetIndex];
    if (offset > 0) {
      target.after(slide);
    } else {
      target.before(slide);
    }
    markActiveSlide(slide);
    slide.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("move-slide");
    publishDeck();
  }

  function ensureDataTableStyle() {
    if (document.getElementById("cosmic-canvas-data-style")) return;
    const style = document.createElement("style");
    style.id = "cosmic-canvas-data-style";
    style.textContent = [
      ".cosmic-data-block{width:100%;margin:24px 0;color:#1f2933;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
      ".cosmic-data-block figcaption{margin:0 0 10px;color:#0f766e;font-size:14px;font-weight:800;letter-spacing:0;}",
      ".cosmic-data-table{width:100%;border:1px solid #d7dde5;border-collapse:separate;border-spacing:0;border-radius:8px;overflow:hidden;background:#fff;font-size:14px;box-shadow:0 12px 30px rgba(31,41,51,.08);}",
      ".cosmic-data-table th,.cosmic-data-table td{padding:11px 13px;border-bottom:1px solid #e5e9ee;text-align:left;vertical-align:top;}",
      ".cosmic-data-table th{color:#26323f;background:#eef8f6;font-weight:800;}",
      ".cosmic-data-table tr:last-child td{border-bottom:0;}",
    ].join("");
    document.head.append(style);
  }

  function textValue(value: unknown) {
    return String(value ?? "").trim();
  }

  function payloadCells(values: unknown) {
    return Array.isArray(values) ? values.map((value) => textValue(value)) : [];
  }

  function appendCell(row: HTMLTableRowElement, tagName: string, text: string) {
    const cell = document.createElement(tagName);
    cell.textContent = text;
    row.append(cell);
  }

  function numericValue(value: string) {
    const parsed = Number.parseFloat(String(value || "").replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function chartData(payload: Record<string, unknown>) {
    const columns = payloadCells(payload?.columns);
    const rows = Array.isArray(payload?.rows) ? payload.rows.map((row) => payloadCells(row)) : [];
    if (columns.length < 2 || !rows.length) return null;
    const valueIndex = columns.findIndex((_, index) => index > 0 && rows.some((row) => numericValue(row[index] || "") !== 0));
    const metricIndex = valueIndex > 0 ? valueIndex : 1;
    const points = rows
      .map((row) => ({
        label: row[0] || "",
        value: numericValue(row[metricIndex] || ""),
      }))
      .filter((point) => point.label || point.value !== 0);
    if (!points.length) return null;
    return {
      labelName: columns[0] || "Label",
      valueName: columns[metricIndex] || "Value",
      points,
    };
  }

  function svgElement(tagName: string) {
    return document.createElementNS("http://www.w3.org/2000/svg", tagName);
  }

  function setSvgAttrs(element: Element, attrs: Record<string, string | number>) {
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  }

  function appendSvgText(svg: SVGElement, x: number, y: number, text: string, attrs: Record<string, string | number> = {}) {
    const node = svgElement("text");
    setSvgAttrs(node, { x, y, fill: "#52606d", "font-size": 13, "font-family": "Inter, Arial, sans-serif", ...attrs });
    node.textContent = text;
    svg.append(node);
  }

  function buildBarChart(data: { labelName: string; valueName: string; points: Array<{ label: string; value: number }> }) {
    const svg = svgElement("svg") as SVGElement;
    setSvgAttrs(svg, { viewBox: "0 0 720 420", role: "img", "aria-label": data.valueName + " by " + data.labelName });
    const max = Math.max(...data.points.map((point) => point.value), 1);
    const chartX = 74;
    const chartY = 54;
    const chartWidth = 590;
    const chartHeight = 250;
    const gap = 18;
    const barWidth = Math.max(22, (chartWidth - gap * (data.points.length - 1)) / data.points.length);

    const axis = svgElement("path");
    setSvgAttrs(axis, {
      d: `M${chartX} ${chartY}V${chartY + chartHeight}H${chartX + chartWidth}`,
      fill: "none",
      stroke: "#8795a1",
      "stroke-width": 2,
    });
    svg.append(axis);

    data.points.forEach((point, index) => {
      const height = Math.round((point.value / max) * chartHeight);
      const x = chartX + index * (barWidth + gap);
      const y = chartY + chartHeight - height;
      const rect = svgElement("rect");
      rect.classList.add("cosmic-chart-bar");
      setSvgAttrs(rect, {
        x,
        y,
        width: Math.round(barWidth),
        height,
        rx: 5,
        fill: "#0f766e",
        "data-label": point.label,
        "data-value": point.value,
      });
      svg.append(rect);
      appendSvgText(svg, x + barWidth / 2, chartY + chartHeight + 24, point.label, {
        "text-anchor": "middle",
      });
      appendSvgText(svg, x + barWidth / 2, y - 8, String(point.value), {
        "text-anchor": "middle",
        fill: "#26323f",
        "font-weight": 800,
      });
    });

    appendSvgText(svg, chartX + chartWidth / 2, 386, data.labelName, { "text-anchor": "middle", "font-weight": 800 });
    appendSvgText(svg, 22, chartY + chartHeight / 2, data.valueName, {
      transform: `rotate(-90 22 ${chartY + chartHeight / 2})`,
      "text-anchor": "middle",
      "font-weight": 800,
    });
    return svg;
  }

  function buildLineChart(data: { labelName: string; valueName: string; points: Array<{ label: string; value: number }> }) {
    const svg = svgElement("svg") as SVGElement;
    setSvgAttrs(svg, { viewBox: "0 0 720 420", role: "img", "aria-label": data.valueName + " by " + data.labelName });
    const max = Math.max(...data.points.map((point) => point.value), 1);
    const chartX = 74;
    const chartY = 54;
    const chartWidth = 590;
    const chartHeight = 250;
    const step = data.points.length <= 1 ? chartWidth : chartWidth / (data.points.length - 1);
    const points = data.points.map((point, index) => {
      const x = chartX + index * step;
      const y = chartY + chartHeight - (point.value / max) * chartHeight;
      return { ...point, x, y };
    });
    const axis = svgElement("path");
    setSvgAttrs(axis, {
      d: `M${chartX} ${chartY}V${chartY + chartHeight}H${chartX + chartWidth}`,
      fill: "none",
      stroke: "#8795a1",
      "stroke-width": 2,
    });
    svg.append(axis);
    const polyline = svgElement("polyline");
    polyline.classList.add("cosmic-chart-line");
    setSvgAttrs(polyline, {
      points: points.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(" "),
      fill: "none",
      stroke: "#0f766e",
      "stroke-width": 4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    svg.append(polyline);
    points.forEach((point) => {
      const circle = svgElement("circle");
      setSvgAttrs(circle, { cx: point.x, cy: point.y, r: 5, fill: "#d97706" });
      svg.append(circle);
      appendSvgText(svg, point.x, chartY + chartHeight + 24, point.label, { "text-anchor": "middle" });
    });
    appendSvgText(svg, chartX + chartWidth / 2, 386, data.labelName, { "text-anchor": "middle", "font-weight": 800 });
    appendSvgText(svg, 22, chartY + chartHeight / 2, data.valueName, {
      transform: `rotate(-90 22 ${chartY + chartHeight / 2})`,
      "text-anchor": "middle",
      "font-weight": 800,
    });
    return svg;
  }

  function piePath(cx: number, cy: number, radius: number, start: number, end: number) {
    const startX = cx + radius * Math.cos(start);
    const startY = cy + radius * Math.sin(start);
    const endX = cx + radius * Math.cos(end);
    const endY = cy + radius * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    return `M${cx} ${cy}L${startX} ${startY}A${radius} ${radius} 0 ${large} 1 ${endX} ${endY}Z`;
  }

  function buildPieChart(data: { labelName: string; valueName: string; points: Array<{ label: string; value: number }> }) {
    const svg = svgElement("svg") as SVGElement;
    setSvgAttrs(svg, { viewBox: "0 0 720 420", role: "img", "aria-label": data.valueName + " by " + data.labelName });
    const total = Math.max(data.points.reduce((sum, point) => sum + Math.max(0, point.value), 0), 1);
    const colors = ["#0f766e", "#d97706", "#2563eb", "#7c3aed", "#cf513d", "#52606d"];
    let angle = -Math.PI / 2;
    data.points.forEach((point, index) => {
      const next = angle + (Math.max(0, point.value) / total) * Math.PI * 2;
      const path = svgElement("path");
      path.classList.add("cosmic-chart-slice");
      setSvgAttrs(path, {
        d: piePath(250, 200, 132, angle, next),
        fill: colors[index % colors.length],
        "data-label": point.label,
        "data-value": point.value,
      });
      svg.append(path);
      const legendY = 96 + index * 28;
      const swatch = svgElement("rect");
      setSvgAttrs(swatch, { x: 440, y: legendY - 13, width: 14, height: 14, rx: 3, fill: colors[index % colors.length] });
      svg.append(swatch);
      appendSvgText(svg, 464, legendY, `${point.label} (${point.value})`, { fill: "#26323f" });
      angle = next;
    });
    appendSvgText(svg, 250, 370, data.valueName + " by " + data.labelName, {
      "text-anchor": "middle",
      "font-weight": 800,
    });
    return svg;
  }

  function buildChartSvg(type: string, data: { labelName: string; valueName: string; points: Array<{ label: string; value: number }> }) {
    if (type === "line") return buildLineChart(data);
    if (type === "pie") return buildPieChart(data);
    return buildBarChart(data);
  }

  function dataInsertionPoint() {
    const slide = nearestSlide(slideCandidates());
    if (slide) return { element: slide, placement: "append" };
    if (selectedElement && selectedElement !== document.body && selectedElement.parentElement) {
      return { element: selectedElement, placement: "after" };
    }
    return { element: document.body, placement: "append" };
  }

  function elementInsertionPoint() {
    if (selectedElement && selectedElement !== document.body && selectedElement.parentElement) {
      if (selectedElement.closest(SLIDE_SELECTOR)) {
        return { element: selectedElement, placement: "after" };
      }
      if (selectedElement === nearestSlide(slideCandidates())) {
        return { element: selectedElement, placement: "append" };
      }
      return { element: selectedElement, placement: "after" };
    }
    const slide = nearestSlide(slideCandidates());
    if (slide) return { element: slide, placement: "append" };
    return { element: document.body, placement: "append" };
  }

  function placeholderImageSrc() {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">',
      '<rect width="960" height="540" rx="24" fill="#eef2f7"/>',
      '<path d="M160 380l180-180 120 120 90-90 250 250H160z" fill="#cbd5e1"/>',
      '<circle cx="690" cy="155" r="54" fill="#94a3b8"/>',
      '<text x="480" y="485" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" fill="#475569">Image</text>',
      "</svg>",
    ].join("");
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function createInsertedElement(kind: unknown) {
    const normalizedKind = String(kind || "").trim();
    if (normalizedKind === "heading") {
      const heading = document.createElement("h2");
      heading.textContent = "New heading";
      return heading;
    }
    if (normalizedKind === "paragraph") {
      const paragraph = document.createElement("p");
      paragraph.textContent = "Add your text here.";
      return paragraph;
    }
    if (normalizedKind === "image") {
      const image = document.createElement("img");
      image.src = placeholderImageSrc();
      image.alt = "Placeholder image";
      image.style.maxWidth = "100%";
      image.style.height = "auto";
      return image;
    }
    if (normalizedKind === "button") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Button";
      return button;
    }
    if (normalizedKind === "box") {
      const box = document.createElement("div");
      box.textContent = "New box";
      box.style.padding = "24px";
      box.style.border = "1px solid #cbd2d9";
      box.style.borderRadius = "8px";
      return box;
    }
    return null;
  }

  function insertElement(payload: Record<string, unknown>) {
    const element = createInsertedElement(payload.kind);
    if (!element) return;
    const insertion = elementInsertionPoint();
    if (insertion.placement === "after") {
      insertion.element.after(element);
    } else {
      insertion.element.append(element);
    }
    selectElement(element);
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-element");
  }

  function insertDataTable(payload: Record<string, unknown>) {
    let columns = payloadCells(payload?.columns);
    const rows = Array.isArray(payload?.rows)
      ? payload.rows.map((row) => payloadCells(row)).filter((row) => row.some((cell) => cell !== ""))
      : [];
    if (!columns.length || !rows.length) return;
    columns = columns.map((column, index) => column || "Column " + (index + 1));

    ensureDataTableStyle();

    const figure = document.createElement("figure");
    figure.className = "cosmic-data-block";
    figure.setAttribute("data-cosmic-artifact", "data-table");

    const title = textValue(payload?.title);
    if (title) {
      const caption = document.createElement("figcaption");
      caption.textContent = title;
      figure.append(caption);
    }

    const table = document.createElement("table");
    table.className = "cosmic-data-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    columns.forEach((column) => appendCell(headerRow, "th", column));
    thead.append(headerRow);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      columns.forEach((_, index) => appendCell(tableRow, "td", row[index] || ""));
      tbody.append(tableRow);
    });

    table.append(thead, tbody);
    figure.append(table);

    const insertion = dataInsertionPoint();
    if (insertion.placement === "after") {
      insertion.element.after(figure);
    } else {
      insertion.element.append(figure);
    }

    selectElement(figure);
    figure.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-table");
  }

  function insertDataChart(payload: Record<string, unknown>) {
    const data = chartData(payload);
    if (!data) return;
    const type = String(payload.chartType || "bar");
    const figure = document.createElement("figure");
    figure.className = "cosmic-chart-block";
    figure.setAttribute("data-cosmic-artifact", "chart");
    figure.setAttribute("data-chart-type", type === "line" || type === "pie" ? type : "bar");

    const title = textValue(payload?.title);
    if (title) {
      const caption = document.createElement("figcaption");
      caption.textContent = title;
      figure.append(caption);
    }

    figure.append(buildChartSvg(type, data));

    const insertion = dataInsertionPoint();
    if (insertion.placement === "after") {
      insertion.element.after(figure);
    } else {
      insertion.element.append(figure);
    }

    selectElement(figure);
    figure.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    publishChange("insert-chart");
  }

  function exitEditing() {
    if (!selectedElement) return;
    const active = document.activeElement;
    if (active instanceof win.HTMLElement) active.blur();
    restoreContentEditable(editableTextTarget(selectedElement));
    restoreContentEditable(selectedElement);
    publishSelected();
  }

  function insertPlainTextAtSelection(text: string) {
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function nodeWithin(node: Node, root: Element) {
    if (node === root) return true;
    const element = node.nodeType === win.Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return Boolean(element && (element === root || root.contains(element)));
  }

  function selectionRangeInsideSelected(fallback: "contents" | "end") {
    if (!selectedElement) return null;
    const target = editableTextTarget(selectedElement);
    if (!target) return null;
    const root = target;
    const selection = win.getSelection();
    if (selection && selection.rangeCount > 0) {
      const current = selection.getRangeAt(0);
      if (nodeWithin(current.startContainer, root) && nodeWithin(current.endContainer, root)) {
        if (!current.collapsed || fallback === "end") return { root, range: current, selection };
      }
    }

    const range = document.createRange();
    if (fallback === "end") {
      range.selectNodeContents(root);
      range.collapse(false);
    } else {
      range.selectNodeContents(root);
    }
    return { root, range, selection };
  }

  function selectRange(range: Range) {
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function closestTagFromNode(node: Node, tagName: string, root: Element) {
    let element = node.nodeType === win.Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    while (element && element !== root) {
      if (element.tagName.toLowerCase() === tagName) return element;
      element = element.parentElement;
    }
    return null;
  }

  function unwrapElement(element: Element) {
    const parent = element.parentNode;
    if (!parent) return false;
    const range = document.createRange();
    range.setStartBefore(element);
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    range.setEndBefore(element);
    element.remove();
    selectRange(range);
    return true;
  }

  function wrapRangeWithTag(range: Range, tagName: string, attributes: Record<string, string> = {}) {
    const wrapper = document.createElement(tagName);
    Object.entries(attributes).forEach(([key, value]) => wrapper.setAttribute(key, value));
    const fragment = range.extractContents();
    wrapper.append(fragment);
    if (!wrapper.textContent && !wrapper.querySelector("img, br")) return null;
    range.insertNode(wrapper);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selectRange(nextRange);
    return wrapper;
  }

  function toggleInlineTag(tagName: "strong" | "em") {
    const current = selectionRangeInsideSelected("contents");
    if (!current) return false;
    const { root, range } = current;
    const startTag = closestTagFromNode(range.startContainer, tagName, root);
    const endTag = closestTagFromNode(range.endContainer, tagName, root);
    if (startTag && startTag === endTag) return unwrapElement(startTag);
    return Boolean(wrapRangeWithTag(range, tagName));
  }

  function safeHref(raw: unknown) {
    const href = String(raw || "").trim();
    if (!href) return "";
    const compact = href.replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
    if (compact.startsWith("javascript:")) return "";
    return href;
  }

  function createOrUpdateLink(hrefValue: unknown) {
    const href = safeHref(hrefValue);
    if (!href) return false;
    const current = selectionRangeInsideSelected("contents");
    if (!current) return false;
    const { root, range } = current;
    const startLink = closestTagFromNode(range.startContainer, "a", root);
    const endLink = closestTagFromNode(range.endContainer, "a", root);
    if (startLink && startLink === endLink) {
      startLink.setAttribute("href", href);
      return true;
    }
    return Boolean(wrapRangeWithTag(range, "a", { href }));
  }

  function removeLink() {
    if (!selectedElement) return false;
    const current = selectionRangeInsideSelected("contents");
    if (!current) return false;
    const { root, range } = current;
    const startLink = closestTagFromNode(range.startContainer, "a", root);
    const endLink = closestTagFromNode(range.endContainer, "a", root);
    if (startLink && startLink === endLink) return unwrapElement(startLink);
    const links = Array.from(root.querySelectorAll("a"));
    let changed = false;
    links.forEach((link) => {
      if (range.intersectsNode(link)) changed = unwrapElement(link) || changed;
    });
    return changed;
  }

  function listForSelectedElement() {
    if (!selectedElement) return null;
    if (selectedElement.matches("ul, ol")) return selectedElement;
    const parent = selectedElement.parentElement;
    if (selectedElement.tagName.toLowerCase() === "li" && parent?.matches("ul, ol")) return parent;
    return null;
  }

  function unwrapList(list: Element) {
    const replacements: Element[] = [];
    Array.from(list.children).forEach((child) => {
      if (child.tagName.toLowerCase() !== "li") return;
      const paragraph = document.createElement("p");
      while (child.firstChild) paragraph.append(child.firstChild);
      if (!paragraph.textContent && !paragraph.querySelector("img, br")) paragraph.append(document.createElement("br"));
      replacements.push(paragraph);
    });
    if (!replacements.length) return false;
    list.replaceWith(...replacements);
    selectElement(replacements[0]);
    return true;
  }

  function toggleList() {
    if (!selectedElement || selectedElement === document.body) return false;
    const existingList = listForSelectedElement();
    if (existingList) return unwrapList(existingList);
    const target = editableTextTarget(selectedElement);
    if (!target) return false;
    const list = document.createElement("ul");
    const item = document.createElement("li");
    while (target.firstChild) item.append(target.firstChild);
    if (!item.textContent && !item.querySelector("img, br")) item.append(document.createElement("br"));
    list.append(item);
    target.replaceWith(list);
    selectElement(item);
    return true;
  }

  function formatInline(payload: Record<string, unknown>) {
    let changed = false;
    if (payload.action === "bold") changed = toggleInlineTag("strong");
    if (payload.action === "italic") changed = toggleInlineTag("em");
    if (payload.action === "create-link") changed = createOrUpdateLink(payload.href);
    if (payload.action === "remove-link") changed = removeLink();
    if (payload.action === "toggle-list") changed = toggleList();
    if (changed) publishChange("format-inline");
  }

  function insertLineBreakAtSelection() {
    const current = selectionRangeInsideSelected("end");
    if (!current) return false;
    const { range } = current;
    range.deleteContents();
    const br = document.createElement("br");
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    selectRange(range);
    return true;
  }

  function handleEditorKey(event: KeyboardEvent, context: EditorKeyContext) {
    if (mode === "preview" || !selectedElement) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      if (context.typing) {
        exitEditing();
      } else {
        clearSelection();
      }
      return true;
    }

    if (context.typing && event.key === "Enter") {
      event.preventDefault();
      if (insertLineBreakAtSelection()) publishChange("line-break");
      return true;
    }

    if (!context.typing && mode === "text" && event.key === "Enter") {
      const textTarget = editableTextTarget(selectedElement);
      if (!textTarget) return true;
      event.preventDefault();
      if (makeEditable(selectedElement)) placeCaretAtEnd(textTarget);
      publishSelected();
      return true;
    }

    if (context.typing) return false;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return true;
    }

    if (event.key.indexOf("Arrow") === 0) {
      event.preventDefault();
      if (mode !== "move" && !(mode === "select" && event.altKey)) return true;
      const step = event.shiftKey ? 1 : 8;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (dx === 0 && dy === 0) return true;
      nudge(dx, dy);
      return true;
    }

    return false;
  }

  win.__cosmicHandleEditorKey = handleEditorKey;

  document.addEventListener(
    "mouseover",
    (event) => {
      if (mode === "preview") return;
      setHover(pickElement(event.target));
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    () => {
      if (hoveredElement && hoveredElement !== selectedElement) hoveredElement.removeAttribute("data-wysiwyg-hover");
      hoveredElement = null;
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (mode !== "move") return;
      const target = pickElement(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
      const htmlTarget = target as HTMLElement;
      const origin = currentTranslate(htmlTarget);
      dragState = {
        element: htmlTarget,
        startX: event.clientX,
        startY: event.clientY,
        baseDx: origin.dx,
        baseDy: origin.dy,
        baseRect: htmlTarget.getBoundingClientRect(),
        parentRect: htmlTarget.parentElement?.getBoundingClientRect() || null,
      };
      htmlTarget.setPointerCapture?.(event.pointerId);
    },
    true,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (resizeState) {
        event.preventDefault();
        const width = Math.max(24, Math.round(resizeState.baseWidth + event.clientX - resizeState.startX));
        const height = Math.max(24, Math.round(resizeState.baseHeight + event.clientY - resizeState.startY));
        resizeState.element.style.width = width + "px";
        resizeState.element.style.height = height + "px";
        publishSelected();
        return;
      }
      if (!dragState) return;
      event.preventDefault();
      const dx = Math.round(event.clientX - dragState.startX);
      const dy = Math.round(event.clientY - dragState.startY);
      updateSnapGuides(dx, dy);
      setTranslate(dragState.element, dragState.baseDx + dx, dragState.baseDy + dy);
      publishSelected();
    },
    true,
  );

  document.addEventListener(
    "pointerup",
    () => {
      if (resizeState) {
        resizeState = null;
        publishChange("resize");
        return;
      }
      if (!dragState) return;
      dragState = null;
      hideSnapGuides();
      publishChange("move");
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (mode === "preview") return;
      const target = pickElement(event.target);
      if (!target) return;
      if (mode === "text" && selectedElement === target && inTypingContextForElement(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectElement(event.altKey ? ancestorCycleTarget(target) : target);
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      if (mode !== "text") return;
      const target = pickElement(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
      const textTarget = editableTextTarget(target);
      if (!textTarget) {
        reportUnsupportedEditTarget(target);
        return;
      }
      if (textTarget && editingElement === textTarget) return;
      if (textTarget && makeEditable(target)) {
        placeCaretAtPoint(event.clientX, event.clientY, textTarget);
        publishSelected();
      }
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      const immediateTarget = pickElement(event.target);
      if (immediateTarget) editorMutatedElements.add(immediateTarget);
      win.clearTimeout(inputTimer);
      inputTimer = win.setTimeout(() => {
        const target = editingElement || editableTextTarget(selectedElement);
        publishIncrementalChange("text", target?.textContent || "", target, "input");
      }, 250);
    },
    true,
  );

  document.addEventListener(
    "paste",
    (event) => {
      if (mode !== "text") return;
      if (!inTypingContextForElement(document.activeElement) && !inTypingContextForElement(pickElement(event.target))) return;
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return;
      event.preventDefault();
      if (insertPlainTextAtSelection(text)) {
        const target = editingElement || editableTextTarget(selectedElement);
        publishIncrementalChange("text", target?.textContent || "", target, "paste");
      }
    },
    true,
  );

  document.addEventListener(
    "focusin",
    (event) => {
      const target = pickElement(event.target);
      if (target && target === selectedElement && target.getAttribute("contenteditable") === "true") {
        target.setAttribute("data-wysiwyg-editing", "true");
      }
    },
    true,
  );

  document.addEventListener(
    "focusout",
    (event) => {
      const target = pickElement(event.target);
      target?.removeAttribute("data-wysiwyg-editing");
    },
    true,
  );

  document.addEventListener("blur", () => {
    if (!editingElement) return;
    win.clearTimeout(inputTimer);
    publishIncrementalChange("text", editingElement.textContent || "", editingElement, "blur");
  }, true);

  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof win.HTMLImageElement) {
        target.dataset.cosmicImageError = "true";
        publishAudit();
      }
      if (target instanceof win.Element) {
        const tag = target.tagName.toLowerCase();
        const attribute = tag === "link" ? "href" : tag === "video" ? "poster" : "src";
        const url = target.getAttribute(attribute) || "";
        const resolvedUrl = attribute in target && typeof (target as any)[attribute] === "string"
          ? String((target as any)[attribute])
          : url;
        if (url && ["img", "script", "link", "source", "video", "audio"].includes(tag)) {
          const resourceId = ensureId(target) || `${tag}-${url}`;
          const blocked = /^(?:file|javascript):/i.test(url);
          const offline = win.navigator.onLine === false || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::9)?\//i.test(resolvedUrl);
          const external = /^https?:\/\//i.test(resolvedUrl);
          const code = blocked
            ? "resource-blocked"
            : offline
              ? "resource-offline"
              : external
                ? "resource-cors-or-network"
                : "resource-unavailable";
          const title = blocked
            ? "Unsafe resource path blocked"
            : offline
              ? "Resource unavailable offline"
              : external
                ? "External resource blocked by CORS or network policy"
                : "Resource unavailable";
          post("wysiwyg-diagnostic", {
            diagnostic: {
              id: `${code}-${resourceId}`,
              code,
              severity: "warning",
              title,
              message: `${tag} resource failed to load: ${url}`,
              detail: resolvedUrl,
            },
          });
        }
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      handleEditorKey(event, {
        typing: inTypingContextForElement(document.activeElement),
      });
    },
    true,
  );

  win.addEventListener("message", (event) => {
    if (event.source !== win.parent) return;
    if (!isBridgeCommand(event.data)) {
      if ((event.data as Record<string, unknown> | null)?.type === "wysiwyg-command") {
        post("wysiwyg-diagnostic", {
          diagnostic: {
            id: "bridge-message-rejected",
            code: "bridge-message-rejected",
            severity: "warning",
            title: "Malformed editor command rejected",
            message: "A parent command failed strict payload validation and was ignored.",
          },
        });
      }
      return;
    }
    const data = event.data;
    if (sessionToken && data.sessionToken !== sessionToken) {
      post("wysiwyg-diagnostic", {
        diagnostic: {
          id: "bridge-session-rejected",
          code: "bridge-session-rejected",
          severity: "warning",
          title: "Stale editor command rejected",
          message: "A parent command did not carry the current preview token and was ignored.",
        },
      });
      return;
    }

    if (data.command === "set-mode") {
      mode = typeof data.mode === "string" ? data.mode : "text";
      syncFenceState();
      document.documentElement.setAttribute("data-wysiwyg-mode", mode);
      if (mode !== "text") {
        restoreContentEditable(editableTextTarget(selectedElement));
        restoreContentEditable(selectedElement);
      }
      publishSelected();
    }

    if (data.command === "set-force-timeline") {
      forceTimeline = Boolean(data.enabled);
      manualDeckSelector = "";
      manualSiblingPath = [];
      manualMarkedPaths = [];
      publishDeck();
    }

    if (data.command === "set-deck-selector") {
      manualDeckSelector = typeof data.selector === "string" ? data.selector.trim().slice(0, 500) : "";
      manualSiblingPath = [];
      manualMarkedPaths = [];
      forceTimeline = false;
      publishDeck();
    }

    if (data.command === "set-deck-from-selection") {
      const requestedPath = Array.isArray(data.siblingPath)
        ? data.siblingPath.filter((part): part is number => Number.isInteger(part) && Number(part) >= 0).slice(0, 64)
        : [];
      const parent = requestedPath.length
        ? elementAtSourcePath(requestedPath)
        : selectedElement?.parentElement || null;
      if (parent) {
        manualSiblingPath = sourcePath(parent);
        manualDeckSelector = "";
        manualMarkedPaths = [];
        forceTimeline = false;
        post("wysiwyg-deck-preference", { siblingPath: manualSiblingPath });
      }
      publishDeck();
    }

    if (data.command === "clear-deck-override") {
      manualDeckSelector = "";
      manualSiblingPath = [];
      manualMarkedPaths = [];
      forceTimeline = false;
      publishDeck();
    }

    if (data.command === "set-deck-marked") {
      manualMarkedPaths = Array.isArray(data.paths)
        ? data.paths.filter((path): path is number[] => Array.isArray(path)).map((path) =>
            path.filter((part): part is number => Number.isInteger(part) && Number(part) >= 0).slice(0, 64),
          ).filter((path) => path.length > 0).slice(0, 500)
        : [];
      manualDeckSelector = "";
      manualSiblingPath = [];
      forceTimeline = false;
      publishDeck();
    }

    if (data.command === "set-outline-hidden") {
      setOutlineFlag(data, "data-wysiwyg-editor-hidden");
    }

    if (data.command === "set-outline-locked") {
      setOutlineFlag(data, "data-wysiwyg-editor-locked");
    }

    if (data.command === "set-picking-ignored") {
      setOutlineFlag(data, "data-wysiwyg-editor-pick-through");
    }

    if (data.command === "select" && data.id) {
      const element = selectedById(String(data.id));
      if (element) selectElement(element);
    }

    if (data.command === "select-parent") selectParent();
    if (data.command === "apply-style") applyStyles(data.styles as Record<string, unknown> | undefined);
    if (data.command === "set-text") setText(String(data.text || ""));
    if (data.command === "set-class") setClass(data.className, data.action);
    if (data.command === "replace-image") replaceImage(data.src, data.alt);
    if (data.command === "set-image-fit") setImageFit(data.fit);
    if (data.command === "replace-background") replaceBackground(data.src);
    if (data.command === "set-theme-font") setThemeFont(data.fontFamily);
    if (data.command === "swap-theme-color") swapThemeColor(data.from, data.to);
    if (data.command === "set-slide-background") setSlideBackground(data.color);
    if (data.command === "find-text") highlightFindText(data.query);
    if (data.command === "replace-text") replaceTextNodes(data.query, data.replacement);
    if (data.command === "z-order") setZOrder(data.action);
    if (data.command === "duplicate") duplicateSelected();
    if (data.command === "duplicate-slide") duplicateSlide(data);
    if (data.command === "insert-slide") insertSlide(data);
    if (data.command === "insert-slide-template") insertSlideTemplate(data);
    if (data.command === "rename-slide") renameSlide(data);
    if (data.command === "delete-slide") deleteSlide(data);
    if (data.command === "move-slide") moveSlide(data);
    if (data.command === "insert-element") insertElement(data);
    if (data.command === "format-inline") formatInline(data);
    if (data.command === "insert-table") insertDataTable(data);
    if (data.command === "insert-chart") insertDataChart(data);
    if (data.command === "delete") deleteSelected();
    if (data.command === "go-slide") goToSlide(data);
    if (data.command === "nudge") nudge(Number(data.dx || 0), Number(data.dy || 0));
    if (data.command === "layout") layoutSelected(data.action);
    if (data.command === "scroll-to") win.scrollTo(Number(data.x || 0), Number(data.y || 0));
    if (data.command === "request-audit") publishAudit();
    if (data.command === "request-html") publishChange("request");
  });

  win.addEventListener(
    "scroll",
    () => {
      win.cancelAnimationFrame(activeScrollFrame);
      activeScrollFrame = win.requestAnimationFrame(publishActiveFromViewport);
      updateChip();
    },
    true,
  );
  win.addEventListener("resize", () => {
    scheduleDeckPublish();
    updateChip();
  });

  if (document.body && typeof win.MutationObserver === "function") {
    deckObserver = new win.MutationObserver((records) => {
      const impact = combineMutationImpacts(records.map((record) => classifyBridgeMutation(record, SLIDE_SELECTOR, activeSlideId)));
      if (impact === "irrelevant") return;
      const handledEditorTargets = new Set<Element>();
      if (impact === "deck-structural" || impact === "thumbnail-affecting") records.forEach((record) => {
        const target = record.target instanceof win.Element ? record.target : record.target.parentElement;
        let editorTarget: Element | null = target || null;
        while (editorTarget && !editorMutatedElements.has(editorTarget)) editorTarget = editorTarget.parentElement;
        if (editorTarget) {
          handledEditorTargets.add(editorTarget);
          return;
        }
        const slide = target?.closest(SLIDE_SELECTOR);
        if (slide) invalidateThumbnail(slide, `observer:${record.type}:${record.attributeName || ""}`);
      });
      handledEditorTargets.forEach((target) => editorMutatedElements.delete(target));
      if (selectedElement && !document.documentElement.contains(selectedElement)) {
        selectedElement = null;
        publishSelected();
      }
      scheduleDeckPublish();
      if (impact === "deck-structural") scheduleOutlinePublish();
    });
    deckObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: [
        "id",
        "class",
        "style",
        "data-title",
        "data-section",
        "data-slide",
        "data-slide-id",
        "data-page",
        "data-page-id",
        "aria-label",
        "aria-roledescription",
        "aria-current",
        "data-active",
        "hidden",
      ],
    });
  }

  syncFenceState();
  document.documentElement.setAttribute("data-wysiwyg-mode", mode);
  post("wysiwyg-ready", {
    title: document.title || "",
    bodyTextStart: (document.body ? document.body.textContent || "" : "").trim().slice(0, 180),
  });
  publishDeck();
  publishAudit();
  publishOutline();
}
