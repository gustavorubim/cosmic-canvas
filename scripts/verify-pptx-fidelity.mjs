#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const DEFAULT_HTML = "fixtures/pptx-export/cosmic-canvas-hairy-deck.html";
const DEFAULT_PPTX = "output/pptx/cosmic-canvas-hairy-deck-prototype.pptx";
const DEFAULT_OUT = "tmp/pptx/fidelity";
const DEFAULT_SELECTOR = "section.slide";
const DEFAULT_THRESHOLD = 0.15;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage:
  npm run pptx:fidelity -- --html fixtures/pptx-export/cosmic-canvas-hairy-deck.html --pptx output.pptx

Options:
  --html <path>       HTML fixture path. Default: ${DEFAULT_HTML}
  --pptx <path>       PPTX path to render. Default: ${DEFAULT_PPTX}
  --out <path>        Output directory. Default: ${DEFAULT_OUT}
  --selector <css>    Slide selector. Default: ${DEFAULT_SELECTOR}
  --threshold <num>   Max diff ratio per slide. Default: ${DEFAULT_THRESHOLD}
`);
}

function findCommand(name) {
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function ensureTools() {
  const soffice = findCommand("soffice");
  const pdftoppm = findCommand("pdftoppm");
  if (!soffice) throw new Error("LibreOffice 'soffice' was not found on PATH.");
  if (!pdftoppm) throw new Error("Poppler 'pdftoppm' was not found on PATH.");
  return { soffice, pdftoppm };
}

function sortedPngs(dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".png"))
    .sort((a, b) => {
      const aNumber = Number(a.match(/(\d+)\.png$/)?.[1] || 0);
      const bNumber = Number(b.match(/(\d+)\.png$/)?.[1] || 0);
      return aNumber - bNumber || a.localeCompare(b);
    })
    .map((file) => resolve(dir, file));
}

function resetDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function isBlank(png) {
  let min = 255;
  let max = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    min = Math.min(min, png.data[index], png.data[index + 1], png.data[index + 2]);
    max = Math.max(max, png.data[index], png.data[index + 1], png.data[index + 2]);
    if (max - min > 4) return false;
  }
  return true;
}

async function renderHtmlSlides({ htmlPath, selector, outDir }) {
  const htmlDir = resolve(outDir, "html");
  resetDir(htmlDir);
  const executablePath = findChromeExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    const count = await page.locator(selector).count();
    if (!count) {
      const output = resolve(htmlDir, "page-01.png");
      await page.screenshot({ path: output, fullPage: false, animations: "disabled" });
      return [output];
    }
    const outputs = [];
    for (let index = 0; index < count; index += 1) {
      const output = resolve(htmlDir, `page-${String(index + 1).padStart(2, "0")}.png`);
      await page.locator(selector).nth(index).screenshot({ path: output, animations: "disabled" });
      outputs.push(output);
    }
    return outputs;
  } finally {
    await browser.close();
  }
}

function renderPptxSlides({ pptxPath, outDir, soffice, pdftoppm }) {
  const pptxDir = resolve(outDir, "pptx");
  resetDir(pptxDir);
  execFileSync(
    soffice,
    [
      `-env:UserInstallation=file:///tmp/lo_profile_cosmic_canvas_${process.pid}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      pptxDir,
      pptxPath,
    ],
    { stdio: "inherit" },
  );
  const pdfName = `${basename(pptxPath, extname(pptxPath))}.pdf`;
  const pdfPath = resolve(pptxDir, pdfName);
  if (!existsSync(pdfPath)) throw new Error(`Expected rendered PDF at ${pdfPath}`);
  execFileSync(
    pdftoppm,
    ["-png", "-scale-to-x", "1600", "-scale-to-y", "900", pdfPath, resolve(pptxDir, "page")],
    { stdio: "inherit" },
  );
  return sortedPngs(pptxDir).filter((file) => !file.endsWith(`${pdfName}.png`));
}

function compareSlides({ htmlImages, pptxImages, outDir, threshold }) {
  const diffDir = resolve(outDir, "diffs");
  resetDir(diffDir);
  if (htmlImages.length !== pptxImages.length) {
    throw new Error(`Slide count mismatch: HTML ${htmlImages.length}, PPTX ${pptxImages.length}`);
  }

  const slides = htmlImages.map((htmlImage, index) => {
    const pptxImage = pptxImages[index];
    const html = PNG.sync.read(readFileSync(htmlImage));
    const pptx = PNG.sync.read(readFileSync(pptxImage));
    if (html.width !== pptx.width || html.height !== pptx.height) {
      throw new Error(
        `Slide ${index + 1} dimensions differ: HTML ${html.width}x${html.height}, PPTX ${pptx.width}x${pptx.height}`,
      );
    }
    if (isBlank(pptx)) throw new Error(`Slide ${index + 1} rendered blank from PPTX.`);
    const diff = new PNG({ width: html.width, height: html.height });
    const diffPixels = pixelmatch(html.data, pptx.data, diff.data, html.width, html.height, {
      threshold: 0.12,
      includeAA: false,
    });
    const diffPath = resolve(diffDir, `page-${String(index + 1).padStart(2, "0")}.png`);
    writeFileSync(diffPath, PNG.sync.write(diff));
    const diffRatio = diffPixels / (html.width * html.height);
    return {
      slide: index + 1,
      diffPixels,
      diffRatio: Number(diffRatio.toFixed(6)),
      pass: diffRatio <= threshold,
      htmlImage,
      pptxImage,
      diffPath,
    };
  });

  const summary = {
    threshold,
    slideCount: slides.length,
    maxDiffRatio: Math.max(...slides.map((slide) => slide.diffRatio)),
    failedSlides: slides.filter((slide) => !slide.pass).map((slide) => slide.slide),
    slides,
  };
  writeFileSync(resolve(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    usage();
    return;
  }

  const htmlPath = resolve(argValue("--html", DEFAULT_HTML));
  const pptxPath = resolve(argValue("--pptx", DEFAULT_PPTX));
  const outDir = resolve(argValue("--out", DEFAULT_OUT));
  const selector = argValue("--selector", DEFAULT_SELECTOR);
  const threshold = Number(argValue("--threshold", String(DEFAULT_THRESHOLD)));
  if (!existsSync(htmlPath)) throw new Error(`HTML fixture not found: ${htmlPath}`);
  if (!existsSync(pptxPath)) throw new Error(`PPTX file not found: ${pptxPath}`);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`Invalid threshold: ${threshold}`);
  }
  mkdirSync(outDir, { recursive: true });

  const tools = ensureTools();
  const htmlImages = await renderHtmlSlides({ htmlPath, selector, outDir });
  const pptxImages = renderPptxSlides({ pptxPath, outDir, ...tools });
  const summary = compareSlides({ htmlImages, pptxImages, outDir, threshold });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failedSlides.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
