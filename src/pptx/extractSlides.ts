import type { PptxSlideSource } from "./types";

const SLIDE_SELECTORS = [
  "section.slide",
  "[data-slide]",
  ".reveal .slides > section",
  ".reveal .slides > section > section",
];

function isHTMLElement(value: Element | null): value is HTMLElement {
  return Boolean(value && value.nodeType === Node.ELEMENT_NODE && "tagName" in value);
}

function revealLeafSections(doc: Document): HTMLElement[] {
  const revealSections = Array.from(doc.querySelectorAll(".reveal .slides > section"));
  const leaves: HTMLElement[] = [];
  for (const section of revealSections) {
    if (!isHTMLElement(section)) continue;
    const nested = Array.from(section.querySelectorAll(":scope > section")).filter(isHTMLElement);
    if (nested.length) {
      leaves.push(...nested);
    } else {
      leaves.push(section);
    }
  }
  return leaves;
}

function titleFromSlide(slide: HTMLElement, index: number): string {
  const explicit = slide.getAttribute("data-title") || slide.getAttribute("data-section");
  if (explicit?.trim()) return explicit.trim();
  const heading = slide.querySelector("h1, h2, h3");
  const headingText = heading?.textContent?.trim();
  return headingText || `Slide ${index}`;
}

function sectionFromSlide(slide: HTMLElement): string {
  return slide.getAttribute("data-section")?.trim() || "";
}

function ensureExportId(slide: HTMLElement, index: number): string {
  const existing = slide.getAttribute("data-wysiwyg-id") || slide.id;
  return existing || `pptx-slide-${index}`;
}

function dedupeInDomOrder(doc: Document, slides: HTMLElement[]): HTMLElement[] {
  const unique = new Set<HTMLElement>();
  for (const slide of slides) unique.add(slide);
  return Array.from(unique).sort((a, b) => {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  });
}

function isNestedDuplicate(candidate: HTMLElement, allSlides: HTMLElement[]) {
  if (candidate.matches(".reveal .slides > section") && candidate.querySelector(":scope > section")) {
    return true;
  }
  const parentSlide = allSlides.find((other) => other !== candidate && other.contains(candidate));
  if (!parentSlide) return false;
  return !parentSlide.matches(".reveal .slides > section");
}

export function extractPptxSlides(doc: Document, includePageFallback = true): PptxSlideSource[] {
  const direct = SLIDE_SELECTORS.flatMap((selector) => Array.from(doc.querySelectorAll(selector))).filter(isHTMLElement);
  const all = dedupeInDomOrder(doc, direct.concat(revealLeafSections(doc)));
  const slides = all.filter((slide) => !isNestedDuplicate(slide, all));

  if (!slides.length && includePageFallback) {
    const fallback = doc.body || doc.documentElement;
    if (isHTMLElement(fallback)) {
      slides.push(fallback);
    }
  }

  return slides.map((element, index) => ({
    id: ensureExportId(element, index + 1),
    title: titleFromSlide(element, index + 1),
    index,
    element,
    section: sectionFromSlide(element),
  }));
}
