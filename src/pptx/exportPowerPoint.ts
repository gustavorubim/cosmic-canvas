import pptxgen from "pptxgenjs";
import { cleanEditorHtml, normalizeHtmlInput } from "../htmlDocument";
import { convertSlideElements } from "./convertElement";
import { createPptxExportReport } from "./exportReport";
import { extractPptxSlides } from "./extractSlides";
import { measurePptxSlides } from "./measureDom";
import type { PptxExportResult, PptxExportSource } from "./types";
import { PPTX_SLIDE_HEIGHT_IN, PPTX_SLIDE_WIDTH_IN } from "./types";

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(normalizeHtmlInput(html), "text/html");
}

function safeBaseName(value?: string) {
  const base = (value || "cosmic-canvas").replace(/\.[^.]+$/, "");
  const clean = base.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return clean || "cosmic-canvas";
}

function ensureBlob(output: string | ArrayBuffer | Blob | Uint8Array): Blob {
  if (output instanceof Blob) return output;
  if (output instanceof Uint8Array) {
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    return new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
  if (output instanceof ArrayBuffer) {
    return new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
  return new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

function documentIsReadable(doc: Document | null | undefined) {
  try {
    return Boolean(doc?.body && doc.defaultView);
  } catch {
    return false;
  }
}

export async function exportPowerPoint(source: PptxExportSource): Promise<PptxExportResult> {
  const clean = cleanEditorHtml(source.html);
  const doc = documentIsReadable(source.document) ? (source.document as Document) : parseHtml(clean);
  const slides = extractPptxSlides(doc, true);
  const measuredSlides = measurePptxSlides(slides);
  const report = createPptxExportReport(source.mode, measuredSlides.length);

  const pptx = new pptxgen();
  pptx.author = "Cosmic Canvas";
  pptx.company = "Cosmic Canvas";
  pptx.subject = "HTML presentation export";
  pptx.title = doc.title || "Cosmic Canvas export";
  pptx.layout = "LAYOUT_WIDE";
  pptx.defineLayout({
    name: "COSMIC_CANVAS_WIDE",
    width: PPTX_SLIDE_WIDTH_IN,
    height: PPTX_SLIDE_HEIGHT_IN,
  });
  pptx.layout = "COSMIC_CANVAS_WIDE";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  for (const slideSource of measuredSlides) {
    const slide = pptx.addSlide();
    slide.addNotes(`Exported from Cosmic Canvas. Source slide: ${slideSource.title}`);
    await convertSlideElements(slide, slideSource, source.mode, report);
  }

  const blob = ensureBlob(await pptx.write({ outputType: "blob", compression: true }));
  const fileName = `${safeBaseName(source.fileBaseName)}-${source.mode}.pptx`;
  return { blob, fileName, report };
}
