import { toPng } from "html-to-image";

export type RasterizedImageData = {
  data: string;
  format: "png" | "svg-foreignobject";
};

function encodeBase64(value: string): string {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(unescape(encodeURIComponent(value)));
  }
  return Buffer.from(value, "utf8").toString("base64");
}

function collectDocumentStyles(doc: Document): string {
  return Array.from(doc.querySelectorAll("style"))
    .map((style) => style.textContent || "")
    .join("\n");
}

function stripDataPrefix(value: string): string {
  return value.replace(/^data:/, "");
}

function canUseCanvas() {
  try {
    if (typeof document === "undefined") return false;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("2d"));
  } catch {
    return false;
  }
}

function elementHasLiveLayout(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 && Boolean(element.ownerDocument.defaultView);
}

async function withCleanEditorMarkers<T>(element: HTMLElement, action: () => Promise<T>): Promise<T> {
  const changed: Array<{ element: Element; name: string; value: string | null }> = [];
  const selector = [
    "[data-wysiwyg-hover]",
    "[data-wysiwyg-selected]",
    "[data-wysiwyg-editing]",
    "[data-wysiwyg-current-slide]",
  ].join(",");
  const candidates = [element, ...Array.from(element.querySelectorAll(selector))];
  for (const candidate of candidates) {
    for (const name of [
      "data-wysiwyg-hover",
      "data-wysiwyg-selected",
      "data-wysiwyg-editing",
      "data-wysiwyg-current-slide",
    ]) {
      if (candidate.hasAttribute(name)) {
        changed.push({ element: candidate, name, value: candidate.getAttribute(name) });
        candidate.removeAttribute(name);
      }
    }
  }
  try {
    return await action();
  } finally {
    for (const item of changed) {
      if (item.value === null) {
        item.element.removeAttribute(item.name);
      } else {
        item.element.setAttribute(item.name, item.value);
      }
    }
  }
}

async function withHiddenChildren<T>(element: HTMLElement, action: () => Promise<T>): Promise<T> {
  const changed = Array.from(element.children).map((child) => ({
    element: child as HTMLElement,
    visibility: (child as HTMLElement).style.visibility,
  }));
  for (const item of changed) {
    item.element.style.visibility = "hidden";
  }
  try {
    return await action();
  } finally {
    for (const item of changed) {
      item.element.style.visibility = item.visibility;
    }
  }
}

export function elementToForeignObjectSvgData(element: HTMLElement, width: number, height: number): string {
  const doc = element.ownerDocument;
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-wysiwyg-editor='true']").forEach((child) => child.remove());
  clone.removeAttribute("data-wysiwyg-selected");
  clone.removeAttribute("data-wysiwyg-hover");
  clone.removeAttribute("data-wysiwyg-editing");
  clone.removeAttribute("data-wysiwyg-current-slide");
  clone.querySelectorAll("[data-wysiwyg-id], [data-wysiwyg-selected], [data-wysiwyg-hover], [data-wysiwyg-editing], [data-wysiwyg-current-slide]").forEach((child) => {
    child.removeAttribute("data-wysiwyg-id");
    child.removeAttribute("data-wysiwyg-selected");
    child.removeAttribute("data-wysiwyg-hover");
    child.removeAttribute("data-wysiwyg-editing");
    child.removeAttribute("data-wysiwyg-current-slide");
  });
  const styles = collectDocumentStyles(doc);
  const html = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8" /><style>${styles}</style></head><body style="margin:0">${clone.outerHTML}</body></html>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(width))}" height="${Math.max(1, Math.round(height))}" viewBox="0 0 ${Math.max(1, Math.round(width))} ${Math.max(1, Math.round(height))}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  return `image/svg+xml;base64,${encodeBase64(svg)}`;
}

export async function rasterizeElementToImageData(
  element: HTMLElement,
  width: number,
  height: number,
  backgroundColor?: string,
): Promise<RasterizedImageData> {
  if (canUseCanvas() && elementHasLiveLayout(element)) {
    try {
      const dataUrl = await withCleanEditorMarkers(element, () =>
        toPng(element, {
          cacheBust: true,
          pixelRatio: 1,
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          canvasWidth: Math.max(1, Math.round(width)),
          canvasHeight: Math.max(1, Math.round(height)),
          backgroundColor,
          filter: (node) => !node.closest?.("[data-wysiwyg-editor='true']"),
        }),
      );
      return { data: stripDataPrefix(dataUrl), format: "png" };
    } catch {
      // Fall through to the portable SVG snapshot below.
    }
  }

  return {
    data: elementToForeignObjectSvgData(element, width, height),
    format: "svg-foreignobject",
  };
}

export async function rasterizeElementBackgroundToImageData(
  element: HTMLElement,
  width: number,
  height: number,
  backgroundColor?: string,
): Promise<RasterizedImageData> {
  return withHiddenChildren(element, () => rasterizeElementToImageData(element, width, height, backgroundColor));
}

export function normalizeImageData(src: string): { data?: string; path?: string } {
  if (src.startsWith("data:")) {
    return { data: src.replace(/^data:/, "") };
  }
  if (/^https?:\/\//i.test(src) || src.startsWith("/") || src.startsWith("./")) {
    return { path: src };
  }
  return {};
}
