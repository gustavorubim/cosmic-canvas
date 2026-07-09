export type PptxExportMode = "hybrid" | "editable" | "image";

export type PptxWarningCode =
  | "asset-fetch-failed"
  | "css-animation"
  | "css-backdrop-filter"
  | "css-blend-mode"
  | "css-clip-path"
  | "css-filter"
  | "css-fixed-position"
  | "css-mask"
  | "css-pseudo-content"
  | "css-unsupported-transform"
  | "empty-slide"
  | "font-unavailable"
  | "image-mode-foreignobject"
  | "layout-fallback"
  | "raster-fallback"
  | "svg-rasterized"
  | "unsupported-element";

export type PptxExportWarning = {
  slideIndex: number;
  elementPath: string;
  code: PptxWarningCode;
  message: string;
};

export type PptxExportReport = {
  mode: PptxExportMode;
  slideCount: number;
  editableObjectCount: number;
  rasterObjectCount: number;
  skippedObjectCount: number;
  warnings: PptxExportWarning[];
};

export type PptxSlideSource = {
  id: string;
  title: string;
  index: number;
  element: HTMLElement;
  section: string;
};

export type PptxLayerPlan =
  | { kind: "text"; elementId: string; confidence: number; reason: string }
  | { kind: "shape"; elementId: string; confidence: number; reason: string }
  | { kind: "image"; elementId: string; confidence: number; reason: string }
  | { kind: "table"; elementId: string; confidence: number; reason: string }
  | { kind: "svg"; elementId: string; confidence: number; reason: string }
  | { kind: "raster"; elementId: string; confidence: number; reason: string }
  | { kind: "skip"; elementId: string; confidence: 0; reason: string };

export type PptxMeasuredSlide = PptxSlideSource & {
  widthPx: number;
  heightPx: number;
  rect: DOMRect;
  hasLiveLayout: boolean;
};

export type PptxExportResult = {
  blob: Blob;
  fileName: string;
  report: PptxExportReport;
};

export type PptxExportSource = {
  document?: Document | null;
  html: string;
  mode: PptxExportMode;
  fileBaseName?: string;
};

export const PPTX_SLIDE_WIDTH_IN = 13.333;
export const PPTX_SLIDE_HEIGHT_IN = 7.5;
