import type { PptxMeasuredSlide, PptxSlideSource } from "./types";
import { PPTX_SLIDE_HEIGHT_IN, PPTX_SLIDE_WIDTH_IN } from "./types";

const FALLBACK_SLIDE_WIDTH_PX = 1600;
const FALLBACK_SLIDE_HEIGHT_PX = 900;

function zeroRect(width = FALLBACK_SLIDE_WIDTH_PX, height = FALLBACK_SLIDE_HEIGHT_PX): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

export function hasUsableRect(rect: DOMRect | ClientRect | null | undefined) {
  return Boolean(rect && rect.width > 1 && rect.height > 1);
}

export function measurePptxSlides(slides: PptxSlideSource[]): PptxMeasuredSlide[] {
  return slides.map((slide) => {
    const rect = slide.element.getBoundingClientRect();
    const hasLiveLayout = hasUsableRect(rect);
    const measured = hasLiveLayout ? rect : zeroRect();
    return {
      ...slide,
      rect: measured as DOMRect,
      widthPx: measured.width || FALLBACK_SLIDE_WIDTH_PX,
      heightPx: measured.height || FALLBACK_SLIDE_HEIGHT_PX,
      hasLiveLayout,
    };
  });
}

export function elementRectRelativeToSlide(element: Element, slide: PptxMeasuredSlide): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (!hasUsableRect(rect) || !slide.hasLiveLayout) return null;
  return {
    x: rect.left - slide.rect.left,
    y: rect.top - slide.rect.top,
    width: rect.width,
    height: rect.height,
    top: rect.top - slide.rect.top,
    right: rect.right - slide.rect.left,
    bottom: rect.bottom - slide.rect.top,
    left: rect.left - slide.rect.left,
    toJSON: () => ({}),
  } as DOMRect;
}

export function toSlidePosition(rect: DOMRect, slide: PptxMeasuredSlide) {
  const widthPx = slide.widthPx || FALLBACK_SLIDE_WIDTH_PX;
  const heightPx = slide.heightPx || FALLBACK_SLIDE_HEIGHT_PX;
  return {
    x: Math.max(0, (rect.x / widthPx) * PPTX_SLIDE_WIDTH_IN),
    y: Math.max(0, (rect.y / heightPx) * PPTX_SLIDE_HEIGHT_IN),
    w: Math.max(0.05, (rect.width / widthPx) * PPTX_SLIDE_WIDTH_IN),
    h: Math.max(0.05, (rect.height / heightPx) * PPTX_SLIDE_HEIGHT_IN),
  };
}

export function fallbackPosition(index: number, depth = 0) {
  const x = 0.72 + Math.min(depth, 3) * 0.18;
  const y = 0.72 + index * 0.48;
  return {
    x,
    y: Math.min(y, PPTX_SLIDE_HEIGHT_IN - 0.65),
    w: PPTX_SLIDE_WIDTH_IN - x - 0.72,
    h: 0.38,
  };
}

