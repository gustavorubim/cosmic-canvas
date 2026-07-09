import { collectDeckSlides } from "../bridge/editorBridge";
import type { PptxSlideSource } from "./types";

function isHTMLElement(value: Element | null): value is HTMLElement {
  return Boolean(value && value.nodeType === Node.ELEMENT_NODE && "tagName" in value);
}

function titleFromSlide(slide: HTMLElement, index: number): string {
  const explicit =
    slide.getAttribute("data-title") ||
    slide.getAttribute("data-section") ||
    slide.getAttribute("aria-label") ||
    slide.getAttribute("title");
  if (explicit?.trim()) return explicit.trim();
  const heading = slide.querySelector("h1, h2, h3");
  const headingText = heading?.textContent?.trim();
  return headingText || `Slide ${index}`;
}

function sectionFromSlide(slide: HTMLElement): string {
  return slide.getAttribute("data-section")?.trim() || "";
}

function ensureExportId(slide: HTMLElement, index: number): string {
  const existing =
    slide.getAttribute("data-wysiwyg-id") ||
    slide.getAttribute("data-slide-id") ||
    slide.getAttribute("data-page-id") ||
    slide.id;
  return existing || `pptx-slide-${index}`;
}

export function extractPptxSlides(doc: Document, includePageFallback = true): PptxSlideSource[] {
  const slides = collectDeckSlides(doc).filter(isHTMLElement);

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
