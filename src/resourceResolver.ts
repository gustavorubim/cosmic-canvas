export type ResourceKind = "image" | "stylesheet" | "script" | "source" | "media" | "font" | "css-url" | "module";
export type ResourceStatus = "inline" | "external" | "resolved-relative" | "unresolved-relative";

export type ResourceReference = {
  kind: ResourceKind;
  url: string;
  resolvedUrl: string;
  status: ResourceStatus;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MIME_BY_EXTENSION: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

function classify(url: string, baseUri: string): Pick<ResourceReference, "resolvedUrl" | "status"> {
  const clean = url.trim();
  if (!clean || clean.startsWith("#") || /^(?:data|blob):/i.test(clean)) {
    return { resolvedUrl: clean, status: "inline" };
  }
  if (/^(?:https?:)?\/\//i.test(clean)) return { resolvedUrl: clean, status: "external" };
  if (/^[a-z][a-z\d+.-]*:/i.test(clean)) return { resolvedUrl: clean, status: "external" };
  if (!baseUri) return { resolvedUrl: "", status: "unresolved-relative" };
  try {
    return { resolvedUrl: new URL(clean, baseUri).toString(), status: "resolved-relative" };
  } catch {
    return { resolvedUrl: "", status: "unresolved-relative" };
  }
}

function cssUrls(css: string) {
  const values: string[] = [];
  const pattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) values.push(match[2]);
  return values;
}

function moduleImports(source: string) {
  const values: string[] = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) values.push(match[1] || match[2]);
  return values;
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
) {
  const matches = Array.from(input.matchAll(pattern));
  if (!matches.length) return input;
  const replacements = await Promise.all(matches.map(replacer));
  let output = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    const offset = match.index || 0;
    output += input.slice(cursor, offset) + replacements[index];
    cursor = offset + match[0].length;
  });
  return output + input.slice(cursor);
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Fetch and recursively self-contain browser-preview resources from the outer
 * app, where normal same-origin/CORS policy applies. The opaque srcdoc iframe
 * then never has to resolve relative CSS, font, or module dependencies itself. */
export async function buildBrowserResourceMap(
  html: string,
  baseUri: string,
  fetcher: FetchLike = fetch,
) {
  if (!baseUri) return {} as Record<string, string>;
  const resources: Record<string, string> = {};
  const cache = new Map<string, string>();
  let totalBytes = 0;

  const bundle = async (url: URL, stack: Set<string>): Promise<string> => {
    const key = url.toString();
    if (cache.has(key)) return cache.get(key)!;
    if (stack.has(key)) throw new Error("Circular preview resource dependency");
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported preview resource protocol");
    const extension = url.pathname.split(".").pop()?.toLowerCase() || "";
    const preferredMime = MIME_BY_EXTENSION[extension] || "*/*";
    const response = await fetcher(url, { headers: { Accept: preferredMime } });
    if (!response.ok) throw new Error(`Resource fetch failed with ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 5_000_000 || totalBytes + bytes.byteLength > 12_000_000) {
      throw new Error("Preview resource exceeds size limit");
    }
    totalBytes += bytes.byteLength;
    const responseMime = (response.headers.get("content-type") || "").split(";")[0].trim();
    const mime = MIME_BY_EXTENSION[extension] || responseMime || "application/octet-stream";
    const nextStack = new Set(stack).add(key);
    let outputBytes = bytes;

    if (mime === "text/css") {
      let css = new TextDecoder().decode(bytes);
      css = await replaceAsync(css, /url\(\s*(["']?)(.*?)\1\s*\)/gi, async (match) => {
        try {
          return `url("${await bundle(new URL(match[2], url), nextStack)}")`;
        } catch {
          return match[0];
        }
      });
      css = await replaceAsync(css, /@import\s+(["'])(.*?)\1/gi, async (match) => {
        try {
          return `@import url("${await bundle(new URL(match[2], url), nextStack)}")`;
        } catch {
          return match[0];
        }
      });
      outputBytes = new TextEncoder().encode(css);
    } else if (mime === "text/javascript" || /(?:java|ecma)script/i.test(mime)) {
      let source = new TextDecoder().decode(bytes);
      source = await replaceAsync(
        source,
        /((?:import|export)\s+(?:[^"']*?\s+from\s+)?|import\(\s*)(["'])([^"']+)\2/g,
        async (match) => {
          try {
            const dependency = await bundle(new URL(match[3], url), nextStack);
            return `${match[1]}${match[2]}${dependency}${match[2]}`;
          } catch {
            return match[0];
          }
        },
      );
      outputBytes = new TextEncoder().encode(source);
    }

    const dataUrl = bytesToDataUrl(outputBytes, mime);
    cache.set(key, dataUrl);
    return dataUrl;
  };

  const references = resolveDocumentResources(html, baseUri)
    .filter((resource) => resource.status === "resolved-relative")
    .map((resource) => resource.url);
  for (const reference of new Set(references)) {
    try {
      resources[reference] = await bundle(new URL(reference, baseUri), new Set());
    } catch {
      // Runtime/preflight diagnostics retain the unresolved reference and explain it.
    }
  }
  return resources;
}

function srcsetUrls(value: string) {
  return value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

export function resolveDocumentResources(html: string, baseUri = ""): ResourceReference[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const raw: Array<{ kind: ResourceKind; url: string }> = [];
  doc.querySelectorAll("img[src]").forEach((element) => raw.push({ kind: "image", url: element.getAttribute("src") || "" }));
  doc.querySelectorAll("link[href]").forEach((element) => raw.push({
    kind: (element.getAttribute("rel") || "").toLowerCase().includes("stylesheet") ? "stylesheet" : "font",
    url: element.getAttribute("href") || "",
  }));
  doc.querySelectorAll("script[src]").forEach((element) => raw.push({
    kind: (element.getAttribute("type") || "").toLowerCase() === "module" ? "module" : "script",
    url: element.getAttribute("src") || "",
  }));
  doc.querySelectorAll("source[src]").forEach((element) => raw.push({ kind: "source", url: element.getAttribute("src") || "" }));
  doc.querySelectorAll("source[srcset], img[srcset]").forEach((element) => {
    srcsetUrls(element.getAttribute("srcset") || "").forEach((url) => raw.push({ kind: "source", url }));
  });
  doc.querySelectorAll("video[poster], video[src], audio[src]").forEach((element) => raw.push({
    kind: "media",
    url: element.getAttribute("poster") || element.getAttribute("src") || "",
  }));
  doc.querySelectorAll("[style]").forEach((element) => cssUrls(element.getAttribute("style") || "").forEach((url) => raw.push({ kind: "css-url", url })));
  doc.querySelectorAll("style").forEach((element) => cssUrls(element.textContent || "").forEach((url) => raw.push({
    kind: /@font-face/i.test(element.textContent || "") ? "font" : "css-url",
    url,
  })));
  doc.querySelectorAll('script[type="module"]:not([src])').forEach((element) => moduleImports(element.textContent || "").forEach((url) => raw.push({ kind: "module", url })));
  return raw.filter((item) => item.url).map((item) => ({ ...item, ...classify(item.url, baseUri) }));
}

export function applyPreviewResourceMap(html: string, resources: Record<string, string>) {
  if (!Object.keys(resources).length) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const originals = (element: Element) => {
    try {
      return JSON.parse(element.getAttribute("data-wysiwyg-original-resources") || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  };
  const remember = (element: Element, attribute: string, original: string) => {
    const values = originals(element);
    if (!(attribute in values)) values[attribute] = original;
    element.setAttribute("data-wysiwyg-original-resources", JSON.stringify(values));
  };
  const rewriteCss = (value: string) => value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, _quote, url) =>
    resources[url] ? `url("${resources[url]}")` : match,
  );

  doc.querySelectorAll("[src], [href], [poster], [srcset]").forEach((element) => {
    for (const attribute of ["src", "href", "poster", "srcset"]) {
      const original = element.getAttribute(attribute);
      if (!original) continue;
      if (attribute === "srcset") {
        let changed = false;
        const mapped = original.split(",").map((candidate) => {
          const parts = candidate.trim().split(/\s+/);
          if (!resources[parts[0]]) return candidate;
          changed = true;
          return [resources[parts[0]], ...parts.slice(1)].join(" ");
        }).join(", ");
        if (changed) {
          remember(element, attribute, original);
          element.setAttribute(attribute, mapped);
        }
      } else if (resources[original]) {
        remember(element, attribute, original);
        element.setAttribute(attribute, resources[original]);
      }
    }
  });
  doc.querySelectorAll("[style]").forEach((element) => {
    const original = element.getAttribute("style") || "";
    const mapped = rewriteCss(original);
    if (mapped !== original) {
      remember(element, "style", original);
      element.setAttribute("style", mapped);
    }
  });
  doc.querySelectorAll("style").forEach((element) => {
    const original = element.textContent || "";
    const mapped = rewriteCss(original);
    if (mapped !== original) {
      remember(element, "__text", original);
      element.textContent = mapped;
    }
  });
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
