import type { PptxExportMode, PptxExportReport, PptxExportWarning, PptxWarningCode } from "./types";

export function createPptxExportReport(mode: PptxExportMode, slideCount: number): PptxExportReport {
  return {
    mode,
    slideCount,
    editableObjectCount: 0,
    rasterObjectCount: 0,
    skippedObjectCount: 0,
    warnings: [],
  };
}

export function addWarning(
  report: PptxExportReport,
  slideIndex: number,
  elementPath: string,
  code: PptxWarningCode,
  message: string,
) {
  const warning: PptxExportWarning = { slideIndex, elementPath, code, message };
  const duplicate = report.warnings.some(
    (item) => item.slideIndex === warning.slideIndex && item.elementPath === warning.elementPath && item.code === warning.code,
  );
  if (!duplicate) report.warnings.push(warning);
}

export function summarizePptxExportReport(report: PptxExportReport): string {
  const warningText = report.warnings.length
    ? `, ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}`
    : "";
  return `PowerPoint ${report.mode}: ${report.slideCount} slide${report.slideCount === 1 ? "" : "s"}, ${report.editableObjectCount} editable object${report.editableObjectCount === 1 ? "" : "s"}, ${report.rasterObjectCount} image fallback${report.rasterObjectCount === 1 ? "" : "s"}${warningText}`;
}

