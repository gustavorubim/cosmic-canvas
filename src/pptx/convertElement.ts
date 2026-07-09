import type PptxGenJS from "pptxgenjs";
import { addWarning } from "./exportReport";
import { elementRectRelativeToSlide, fallbackPosition, toSlidePosition } from "./measureDom";
import { normalizeImageData, rasterizeElementBackgroundToImageData, rasterizeElementToImageData } from "./rasterize";
import type { PptxExportMode, PptxExportReport, PptxMeasuredSlide, PptxWarningCode } from "./types";
import { PPTX_SLIDE_HEIGHT_IN, PPTX_SLIDE_WIDTH_IN } from "./types";

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

type ConvertContext = {
  mode: PptxExportMode;
  slideSource: PptxMeasuredSlide;
  pptxSlide: PptxSlide;
  report: PptxExportReport;
  fallbackIndex: number;
};

const TEXT_TAGS = new Set([
  "A",
  "BLOCKQUOTE",
  "BUTTON",
  "CODE",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "SMALL",
  "SPAN",
  "STRONG",
]);

const CONTAINER_TAGS = new Set(["ARTICLE", "ASIDE", "DIV", "FIGURE", "FOOTER", "HEADER", "MAIN", "NAV", "SECTION"]);

function isHTMLElement(value: Element | null): value is HTMLElement {
  return Boolean(value && value.nodeType === Node.ELEMENT_NODE && "tagName" in value);
}

function cleanText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function elementPath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
    const id = current.id ? `#${current.id}` : "";
    const className = current.classList.length ? `.${Array.from(current.classList).slice(0, 2).join(".")}` : "";
    parts.unshift(`${current.tagName.toLowerCase()}${id}${className}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function rgbToHexPart(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
}

export function cssColorToHex(value: string | null | undefined): { color: string; transparency: number } | null {
  const raw = (value || "").trim();
  if (!raw || raw === "transparent" || raw === "rgba(0, 0, 0, 0)") return null;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, r, g, b] = raw;
    return { color: `${r}${r}${g}${g}${b}${b}`.toUpperCase(), transparency: 0 };
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) return { color: raw.slice(1).toUpperCase(), transparency: 0 };
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const parts = rgb[1].split(",").map((part) => part.trim());
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
  if ([r, g, b].some((part) => Number.isNaN(part)) || Number.isNaN(alpha) || alpha <= 0) return null;
  return {
    color: `${rgbToHexPart(r)}${rgbToHexPart(g)}${rgbToHexPart(b)}`,
    transparency: Math.max(0, Math.min(100, Math.round((1 - alpha) * 100))),
  };
}

function parsePx(value: string | null | undefined) {
  const match = String(value || "").match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : 0;
}

function computedStyle(element: HTMLElement): CSSStyleDeclaration | null {
  return element.ownerDocument.defaultView?.getComputedStyle(element) || null;
}

function isVisible(element: HTMLElement, style: CSSStyleDeclaration | null) {
  if (!style) return true;
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
}

type UnsupportedCssEntry = {
  code: PptxWarningCode;
  message: string;
  requiresRaster: boolean;
};

function cssValue(element: HTMLElement, style: CSSStyleDeclaration | null, property: string) {
  const computed = style?.getPropertyValue(property) || element.style.getPropertyValue(property);
  if (computed) return computed;
  const inline = element.getAttribute("style") || "";
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = inline.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function hasPseudoContent(element: HTMLElement, pseudo: "::before" | "::after") {
  try {
    const content = element.ownerDocument.defaultView?.getComputedStyle(element, pseudo).content;
    return Boolean(content && content !== "none" && content !== "normal" && content !== '""' && content !== "''");
  } catch {
    return false;
  }
}

function unsupportedCssEntries(element: HTMLElement, style: CSSStyleDeclaration | null): UnsupportedCssEntry[] {
  const entries: UnsupportedCssEntry[] = [];
  const clipPath = cssValue(element, style, "clip-path");
  const filter = cssValue(element, style, "filter");
  const backdropFilter = cssValue(element, style, "backdrop-filter");
  const mixBlendMode = cssValue(element, style, "mix-blend-mode");
  const maskImage = cssValue(element, style, "mask-image");
  const position = cssValue(element, style, "position") || style?.position;
  const animationName = cssValue(element, style, "animation-name");
  const transform = cssValue(element, style, "transform") || style?.transform;

  if (clipPath && clipPath !== "none") {
    entries.push({
      code: "css-clip-path",
      message: "clip-path cannot be represented as editable PowerPoint geometry.",
      requiresRaster: true,
    });
  }
  if (filter && filter !== "none") {
    entries.push({
      code: "css-filter",
      message: "CSS filter effects may be flattened or approximated.",
      requiresRaster: true,
    });
  }
  if (backdropFilter && backdropFilter !== "none") {
    entries.push({
      code: "css-backdrop-filter",
      message: "backdrop-filter has no editable PowerPoint equivalent.",
      requiresRaster: true,
    });
  }
  if (mixBlendMode && mixBlendMode !== "normal") {
    entries.push({
      code: "css-blend-mode",
      message: "blend modes have no direct editable PowerPoint equivalent.",
      requiresRaster: true,
    });
  }
  if (maskImage && maskImage !== "none") {
    entries.push({
      code: "css-mask",
      message: "CSS masks are not editable PowerPoint objects.",
      requiresRaster: true,
    });
  }
  if (position === "fixed") {
    entries.push({
      code: "css-fixed-position",
      message: "Fixed positioning is converted to a slide-relative position.",
      requiresRaster: false,
    });
  }
  if (animationName && animationName !== "none") {
    entries.push({
      code: "css-animation",
      message: "CSS animations are not exported to PowerPoint.",
      requiresRaster: false,
    });
  }
  if (transform && transform !== "none" && !/^matrix\(1, 0, 0, 1, [-0-9.]+, [-0-9.]+\)$/i.test(transform)) {
    entries.push({
      code: "css-unsupported-transform",
      message: "Complex transforms are not represented as editable PowerPoint geometry.",
      requiresRaster: true,
    });
  }
  if (hasPseudoContent(element, "::before") || hasPseudoContent(element, "::after")) {
    entries.push({
      code: "css-pseudo-content",
      message: "CSS pseudo-element content is not exported as an editable PowerPoint object.",
      requiresRaster: true,
    });
  }

  return entries;
}

function warnUnsupportedCss(ctx: ConvertContext, element: HTMLElement, style: CSSStyleDeclaration | null) {
  const slideIndex = ctx.slideSource.index;
  const path = elementPath(element);
  const entries = unsupportedCssEntries(element, style);
  for (const entry of entries) {
    addWarning(ctx.report, slideIndex, path, entry.code, entry.message);
  }
  return entries;
}

function positionForElement(ctx: ConvertContext, element: HTMLElement, depth: number) {
  const relative = elementRectRelativeToSlide(element, ctx.slideSource);
  if (relative) return toSlidePosition(relative, ctx.slideSource);
  if (!ctx.slideSource.hasLiveLayout) {
    addWarning(
      ctx.report,
      ctx.slideSource.index,
      elementPath(element),
      "layout-fallback",
      "No live iframe layout was available; object positions use a readable fallback flow.",
    );
  }
  return fallbackPosition(ctx.fallbackIndex++, depth);
}

function hasVisualBox(element: HTMLElement, style: CSSStyleDeclaration | null) {
  if (!CONTAINER_TAGS.has(element.tagName) && !TEXT_TAGS.has(element.tagName)) return false;
  if (!style) return false;
  const fill = cssColorToHex(style.backgroundColor);
  const borderWidth = parsePx(style.borderTopWidth) + parsePx(style.borderRightWidth) + parsePx(style.borderBottomWidth) + parsePx(style.borderLeftWidth);
  const backgroundImage = style.getPropertyValue("background-image") || element.style.getPropertyValue("background-image");
  return Boolean(fill || borderWidth > 0 || (backgroundImage && backgroundImage !== "none"));
}

function backgroundFallbackColor(element: HTMLElement, style: CSSStyleDeclaration | null) {
  const fill = cssColorToHex(style?.backgroundColor);
  if (fill) return fill;
  const background = style?.getPropertyValue("background") || element.style.getPropertyValue("background");
  const backgroundImage = style?.getPropertyValue("background-image") || element.style.getPropertyValue("background-image");
  if (element.classList.contains("hero-band")) {
    return { color: "2F6FED", transparency: 0 };
  }
  if (element.classList.contains("stamp")) {
    return { color: "263B5B", transparency: 0 };
  }
  if (element.classList.contains("dark") || /#(?:0f172a|111827|172033|101826|21314b)\b/i.test(`${background} ${backgroundImage}`)) {
    return { color: "172033", transparency: 0 };
  }
  if (backgroundImage && backgroundImage !== "none") {
    return { color: "EAF1FF", transparency: 0 };
  }
  return null;
}

function cssColorString(fill: { color: string; transparency: number } | null) {
  if (!fill || fill.transparency >= 100) return undefined;
  return `#${fill.color}`;
}

function shapeNameForElement(element: HTMLElement, style: CSSStyleDeclaration | null) {
  if (!style) return "rect" as const;
  const radius = Math.max(
    parsePx(style.borderTopLeftRadius),
    parsePx(style.borderTopRightRadius),
    parsePx(style.borderBottomRightRadius),
    parsePx(style.borderBottomLeftRadius),
  );
  const relativeRadius = radius / Math.max(1, element.getBoundingClientRect().height || 1);
  if (relativeRadius > 0.45) return "ellipse" as const;
  if (radius > 2) return "roundRect" as const;
  return "rect" as const;
}

function addVisualShape(ctx: ConvertContext, element: HTMLElement, style: CSSStyleDeclaration | null, depth: number) {
  if (!style || !hasVisualBox(element, style)) return;
  const position = positionForElement(ctx, element, depth);
  const fill = backgroundFallbackColor(element, style);
  const lineColor = cssColorToHex(style.borderTopColor);
  const borderWidth = Math.max(parsePx(style.borderTopWidth), parsePx(style.borderRightWidth), parsePx(style.borderBottomWidth), parsePx(style.borderLeftWidth));
  ctx.pptxSlide.addShape(shapeNameForElement(element, style), {
    ...position,
    fill: fill ? { color: fill.color, transparency: fill.transparency } : { color: "FFFFFF", transparency: 100 },
    line: borderWidth > 0 && lineColor ? { color: lineColor.color, transparency: lineColor.transparency, width: Math.max(0.5, borderWidth * 0.75) } : { color: "FFFFFF", transparency: 100 },
  });
  ctx.report.editableObjectCount += 1;
}

function textAlign(style: CSSStyleDeclaration | null) {
  const align = style?.textAlign;
  if (align === "center" || align === "right" || align === "justify") return align;
  return "left";
}

function addText(ctx: ConvertContext, element: HTMLElement, style: CSSStyleDeclaration | null, depth: number) {
  const text = cleanText(element.textContent);
  if (!text) return;
  const position = positionForElement(ctx, element, depth);
  const color = cssColorToHex(style?.color) || { color: "172033", transparency: 0 };
  const fontSize = Math.max(8, Math.min(60, parsePx(style?.fontSize) * 0.75 || (element.tagName.startsWith("H") ? 24 : 13)));
  const bold = Number(style?.fontWeight || 400) >= 600 || ["STRONG", "B", "H1", "H2", "H3", "H4", "H5", "H6"].includes(element.tagName);
  const italic = style?.fontStyle === "italic" || ["EM", "I"].includes(element.tagName);
  const line = cssColorToHex(style?.borderTopColor);
  const background = backgroundFallbackColor(element, style);
  const href = element.tagName === "A" ? element.getAttribute("href") || "" : "";
  const safeHref = /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? href : "";
  if (href && !safeHref) {
    addWarning(ctx.report, ctx.slideSource.index, elementPath(element), "unsupported-element", "Unsafe or unsupported link URL was not exported.");
  }
  ctx.pptxSlide.addText(text, {
    ...position,
    align: textAlign(style),
    breakLine: false,
    color: color.color,
    fit: "shrink",
    fontFace: style?.fontFamily?.split(",")[0]?.replace(/["']/g, "") || "Aptos",
    fontSize,
    bold,
    italic,
    margin: 0.04,
    valign: "middle",
    hyperlink: safeHref ? { url: safeHref } : undefined,
    fill: background ? { color: background.color, transparency: background.transparency } : undefined,
    line: line && hasVisualBox(element, style) ? { color: line.color, transparency: line.transparency, width: 0.5 } : { color: "FFFFFF", transparency: 100 },
  });
  ctx.report.editableObjectCount += 1;
}

function directTextElement(element: HTMLElement) {
  if (!TEXT_TAGS.has(element.tagName)) return false;
  return cleanText(element.textContent).length > 0;
}

function tableRows(table: HTMLTableElement) {
  return Array.from(table.rows).map((row, rowIndex) =>
    Array.from(row.cells).map((cell) => ({
      text: cleanText(cell.textContent),
      options: {
        bold: rowIndex === 0 || cell.tagName === "TH",
        color: rowIndex === 0 ? "2F6FED" : "172033",
        fill: { color: rowIndex === 0 ? "EAF1FF" : "FFFFFF" },
        margin: 0.06,
      },
    })),
  );
}

function addTable(ctx: ConvertContext, table: HTMLTableElement, depth: number) {
  const rows = tableRows(table);
  if (!rows.length || !rows[0]?.length) return;
  ctx.pptxSlide.addTable(rows, {
    ...positionForElement(ctx, table, depth),
    border: { color: "D9E1EC", pt: 0.5 },
    color: "172033",
    fontFace: "Aptos",
    fontSize: 9,
  });
  ctx.report.editableObjectCount += 1;
}

function addImage(ctx: ConvertContext, element: HTMLImageElement, depth: number) {
  const image = normalizeImageData(element.currentSrc || element.src);
  if (!image.data && !image.path) {
    addWarning(ctx.report, ctx.slideSource.index, elementPath(element), "asset-fetch-failed", "Image source could not be embedded or referenced.");
    ctx.report.skippedObjectCount += 1;
    return;
  }
  ctx.pptxSlide.addImage({
    ...image,
    ...positionForElement(ctx, element, depth),
    altText: element.alt || undefined,
  });
  ctx.report.rasterObjectCount += 1;
}

async function addRasterFallback(
  ctx: ConvertContext,
  element: HTMLElement,
  depth: number,
  code: PptxWarningCode,
  message: string,
) {
  const position = positionForElement(ctx, element, depth);
  const rect = element.getBoundingClientRect();
  const width = rect.width > 1 ? rect.width : Math.max(1, (position.w / PPTX_SLIDE_WIDTH_IN) * ctx.slideSource.widthPx);
  const height = rect.height > 1 ? rect.height : Math.max(1, (position.h / PPTX_SLIDE_HEIGHT_IN) * ctx.slideSource.heightPx);
  const image = await rasterizeElementToImageData(element, width, height);
  ctx.pptxSlide.addImage({
    data: image.data,
    ...position,
  });
  ctx.report.rasterObjectCount += 1;
  addWarning(ctx.report, ctx.slideSource.index, elementPath(element), code, message);
  if (image.format === "svg-foreignobject") {
    addWarning(
      ctx.report,
      ctx.slideSource.index,
      elementPath(element),
      "image-mode-foreignobject",
      "Raster fallback used an SVG foreignObject snapshot because a live canvas capture was unavailable.",
    );
  }
}

async function addSvg(ctx: ConvertContext, element: SVGElement, depth: number) {
  await addRasterFallback(
    ctx,
    element as unknown as HTMLElement,
    depth,
    "svg-rasterized",
    "Inline SVG was exported as a raster image; vector geometry is not editable in this PowerPoint export.",
  );
}

async function addExactImage(ctx: ConvertContext) {
  const slideBackground = cssColorString(backgroundFallbackColor(ctx.slideSource.element, computedStyle(ctx.slideSource.element))) || "#ffffff";
  const image = await rasterizeElementToImageData(ctx.slideSource.element, ctx.slideSource.widthPx, ctx.slideSource.heightPx, slideBackground);
  ctx.pptxSlide.addImage({
    data: image.data,
    x: 0,
    y: 0,
    w: PPTX_SLIDE_WIDTH_IN,
    h: PPTX_SLIDE_HEIGHT_IN,
  });
  ctx.report.rasterObjectCount += 1;
  if (image.format === "svg-foreignobject") {
    addWarning(
      ctx.report,
      ctx.slideSource.index,
      elementPath(ctx.slideSource.element),
      "image-mode-foreignobject",
      "Exact-image mode used an SVG foreignObject snapshot because a live canvas capture was unavailable.",
    );
  }
}

function shouldRasterizeSlideBackground(element: HTMLElement, style: CSSStyleDeclaration | null, entries: UnsupportedCssEntry[]) {
  const backgroundImage = cssValue(element, style, "background-image");
  return Boolean(
    backgroundImage && backgroundImage !== "none" || entries.some((entry) => entry.code === "css-pseudo-content" || entry.requiresRaster),
  );
}

async function addSlideBackgroundRaster(ctx: ConvertContext, style: CSSStyleDeclaration | null) {
  const slideBackground = cssColorString(backgroundFallbackColor(ctx.slideSource.element, style)) || "#ffffff";
  const image = await rasterizeElementBackgroundToImageData(
    ctx.slideSource.element,
    ctx.slideSource.widthPx,
    ctx.slideSource.heightPx,
    slideBackground,
  );
  ctx.pptxSlide.addImage({
    data: image.data,
    x: 0,
    y: 0,
    w: PPTX_SLIDE_WIDTH_IN,
    h: PPTX_SLIDE_HEIGHT_IN,
  });
  ctx.report.rasterObjectCount += 1;
  addWarning(
    ctx.report,
    ctx.slideSource.index,
    elementPath(ctx.slideSource.element),
    "raster-fallback",
    "Hybrid mode rasterized the slide background while keeping supported foreground objects editable.",
  );
  if (image.format === "svg-foreignobject") {
    addWarning(
      ctx.report,
      ctx.slideSource.index,
      elementPath(ctx.slideSource.element),
      "image-mode-foreignobject",
      "Slide background raster fallback used an SVG foreignObject snapshot because a live canvas capture was unavailable.",
    );
  }
}

function handleUnsupportedRegion(ctx: ConvertContext, element: HTMLElement, entries: UnsupportedCssEntry[], depth: number) {
  if (!entries.some((entry) => entry.requiresRaster)) return null;
  if (ctx.mode === "editable") {
    ctx.report.skippedObjectCount += 1;
    addWarning(
      ctx.report,
      ctx.slideSource.index,
      elementPath(element),
      "unsupported-element",
      "Editable mode skipped this complex region instead of flattening it into an image.",
    );
    return Promise.resolve(true);
  }
  if (ctx.mode === "hybrid") {
    return addRasterFallback(
      ctx,
      element,
      depth,
      "raster-fallback",
      "Hybrid mode rasterized this complex region to preserve browser fidelity.",
    ).then(() => true);
  }
  return null;
}

function shouldStopAtText(element: HTMLElement) {
  if (!directTextElement(element)) return false;
  return !element.querySelector("table, svg, img, h1, h2, h3, h4, h5, h6, p, li, blockquote");
}

async function convertElement(ctx: ConvertContext, element: HTMLElement, depth: number): Promise<void> {
  if (element === ctx.slideSource.element) {
    for (const child of Array.from(element.children).filter(isHTMLElement)) {
      await convertElement(ctx, child, depth + 1);
    }
    return;
  }

  const style = computedStyle(element);
  if (!isVisible(element, style)) return;
  const unsupported = warnUnsupportedCss(ctx, element, style);
  const fallbackHandled = await handleUnsupportedRegion(ctx, element, unsupported, depth);
  if (fallbackHandled) return;

  if (element.tagName === "TABLE") {
    addTable(ctx, element as HTMLTableElement, depth);
    return;
  }
  if (element.tagName === "IMG") {
    addImage(ctx, element as HTMLImageElement, depth);
    return;
  }
  if (element.namespaceURI === "http://www.w3.org/2000/svg" && element.tagName.toLowerCase() === "svg") {
    await addSvg(ctx, element as unknown as SVGElement, depth);
    return;
  }

  addVisualShape(ctx, element, style, depth);
  if (directTextElement(element)) {
    addText(ctx, element, style, depth);
    if (shouldStopAtText(element)) return;
  }

  for (const child of Array.from(element.children).filter(isHTMLElement)) {
    await convertElement(ctx, child, depth + 1);
  }
}

export async function convertSlideElements(
  pptxSlide: PptxSlide,
  slideSource: PptxMeasuredSlide,
  mode: PptxExportMode,
  report: PptxExportReport,
) {
  const ctx: ConvertContext = {
    mode,
    slideSource,
    pptxSlide,
    report,
    fallbackIndex: 0,
  };

  const slideStyle = computedStyle(slideSource.element);
  const slideUnsupported = warnUnsupportedCss(ctx, slideSource.element, slideStyle);
  const slideBackground = backgroundFallbackColor(slideSource.element, slideStyle);
  pptxSlide.background = { color: slideBackground?.color || "FBFBF6", transparency: slideBackground?.transparency || 0 };

  if (mode === "image") {
    await addExactImage(ctx);
    return;
  }

  if (mode === "hybrid" && shouldRasterizeSlideBackground(slideSource.element, slideStyle, slideUnsupported)) {
    await addSlideBackgroundRaster(ctx, slideStyle);
  }

  if (!slideSource.element.children.length) {
    addWarning(report, slideSource.index, elementPath(slideSource.element), "empty-slide", "Slide has no exportable child elements.");
    report.skippedObjectCount += 1;
    return;
  }

  await convertElement(ctx, slideSource.element, 0);
}
