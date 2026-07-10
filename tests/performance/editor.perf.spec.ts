import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";

type Measurements = Record<string, number[]>;
const measurements: Measurements = {};
let browserVersion = "";
const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version as string;

function record(name: string, value: number) {
  (measurements[name] ||= []).push(value);
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function fixtureFile(name: string) {
  return readFileSync(resolve("fixtures", "compatibility", name, "index.html"));
}

test.afterAll(() => {
  const summary = Object.fromEntries(Object.entries(measurements).map(([name, values]) => [name, {
    runs: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
  }]));
  const report = {
    generatedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model || "unknown",
    logicalCpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
    vscodeVersion: "not-applicable-browser-harness",
    browser: browserVersion,
    runCount: Math.max(0, ...Object.values(measurements).map((values) => values.length)),
    measurements: summary,
  };
  const output = resolve("tmp", "verification", "performance");
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "latest.json"), JSON.stringify(report, null, 2));
});

test("coalesces ten keystrokes into one history transaction and one host range edit", async ({ page }) => {
  const hostHtml = '<!doctype html><html><head><title>Host burst</title></head><body><p id="typing-target">Typing</p></body></html>';
  await page.addInitScript(({ html, version }) => {
    (window as any).__hostMessages = [];
    (window as any).acquireVsCodeApi = () => ({
      getState: () => undefined,
      setState: () => undefined,
      postMessage(message: unknown) {
        (window as any).__hostMessages.push(message);
        if ((message as any)?.type === "ready") {
          setTimeout(() => window.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "cosmicCanvas.document",
              html,
              fileName: "burst.html",
              uri: "file:///burst.html",
              extensionVersion: version,
              vscodeVersion: "test-host",
              baseUri: "",
              resources: {},
            },
          })), 0);
        }
      },
    });
  }, { html: hostHtml, version: packageVersion });
  await page.goto("/");
  const target = page.frameLocator("iframe").locator("#typing-target");
  await target.dblclick();
  await target.press("End");
  await target.pressSequentially("abcdefghij", { delay: 10 });
  await expect(target).toContainText("abcdefghij");
  await expect.poll(
    () => page.evaluate(() => (window as any).__hostMessages.filter((message: any) => message.type === "documentEdit").length),
    { timeout: 2500 },
  ).toBe(1);
  const shellMetrics = await page.evaluate(() => (window as any).__cosmicShellMetrics as Record<string, number[]>);
  expect(shellMetrics.sourceCleanup.length).toBeGreaterThan(0);
  expect(shellMetrics.hostUpdate.length).toBeGreaterThan(0);
  record("sourceCleanup", shellMetrics.sourceCleanup.at(-1) || 0);
  record("hostUpdate", shellMetrics.hostUpdate.at(-1) || 0);
  await page.getByTitle("Undo (Ctrl+Z)").click();
  await expect(page.frameLocator("iframe").locator("#typing-target")).toHaveText("Typing");
});

test("meets navigation, typing, mutation, thumbnail, and long-task budgets", async ({ page, browser }) => {
  browserVersion = browser.version();
  await page.addInitScript(() => {
    (window as any).__longTasks = [];
    window.addEventListener("message", (event) => {
      if (event.data?.type === "fixture-slide-inserted") {
        (window as any).__fixtureInsertedAt = performance.now();
      }
    });
    if (typeof PerformanceObserver === "function") {
      try {
        new PerformanceObserver((list) => {
          (window as any).__longTasks.push(...list.getEntries().map((entry) => entry.duration));
        }).observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
      } catch {
        // Long Task API is optional; other budgets still run.
      }
    }
  });

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "large-deck.html",
    mimeType: "text/html",
    buffer: fixtureFile("large-deck"),
  });
  await expect(page.locator(".navigator-slide-list")).toHaveAttribute("data-total-pages", "60");
  await page.evaluate(() => { (window as any).__longTasks = []; });

  const frame = page.frameLocator("iframe");
  await frame.locator("html").evaluate(() => { (window as any).__cosmicMetrics.selection = []; });
  for (let index = 0; index < 10; index += 1) {
    const heading = frame.locator("section.slide h1").nth(index);
    await heading.evaluate((element) => element.scrollIntoView());
    await heading.evaluate((element: HTMLElement) => element.click());
    await expect(page.locator(".canvas-breadcrumb .is-current")).toHaveText("h1");
  }
  const selectionTimings = await frame.locator("html").evaluate(() =>
    ((window as any).__cosmicMetrics.selection || []).slice(-10) as number[],
  );
  selectionTimings.forEach((duration) => record("selectionAcknowledgement", duration));
  expect(percentile(measurements.selectionAcknowledgement, 0.5)).toBeLessThanOrEqual(75);
  expect(percentile(measurements.selectionAcknowledgement, 0.95)).toBeLessThanOrEqual(150);

  const sessionToken = await frame.locator("script[data-wysiwyg-editor='true']").last().evaluate((script) =>
    script.textContent?.match(/[a-f0-9]{32}/)?.[0] || "",
  );
  expect(sessionToken).toHaveLength(32);
  await page.locator("iframe").evaluate((iframe: HTMLIFrameElement, token) => {
    iframe.contentWindow?.postMessage({ type: "wysiwyg-command", command: "request-html", sessionToken: token }, "*");
  }, sessionToken);
  await expect.poll(() => frame.locator("html").evaluate(() => ((window as any).__cosmicMetrics.serialization || []).length)).toBeGreaterThan(0);
  const bridgeMetrics = await frame.locator("html").evaluate(() => (window as any).__cosmicMetrics as Record<string, number[]>);
  for (const [reportName, metricName] of [
    ["deckDetection", "deckDetection"],
    ["thumbnailGeneration", "thumbnailGeneration"],
    ["selectionPublication", "selectionPublication"],
    ["auditScan", "auditScan"],
    ["serialization", "serialization"],
  ] as const) {
    expect(bridgeMetrics[metricName]?.length, `${metricName} timing samples`).toBeGreaterThan(0);
    record(reportName, bridgeMetrics[metricName].at(-1) || 0);
  }
  await page.waitForTimeout(200);

  const buildsBefore = await frame.locator("html").evaluate(() =>
    (window as any).__cosmicMetrics?.thumbnailBuilds?.[0] || 0,
  );
  const thumbnailLogBefore = await frame.locator("html").evaluate(() => (window as any).__cosmicThumbnailLog?.length || 0);
  const invalidationLogBefore = await frame.locator("html").evaluate(() => (window as any).__cosmicThumbnailInvalidations?.length || 0);
  const firstHeading = frame.locator("section.slide h1").first();
  await firstHeading.dblclick();
  await firstHeading.press("End");
  await firstHeading.press("x");
  await page.waitForTimeout(400);
  const buildsAfter = await frame.locator("html").evaluate(() =>
    (window as any).__cosmicMetrics?.thumbnailBuilds?.[0] || 0,
  );
  const thumbnailLog = await frame.locator("html").evaluate((start) => ((window as any).__cosmicThumbnailLog || []).slice(start), thumbnailLogBefore);
  const invalidationLog = await frame.locator("html").evaluate((start) => ((window as any).__cosmicThumbnailInvalidations || []).slice(start), invalidationLogBefore);
  expect(buildsAfter - buildsBefore, `rebuilt slide ids: ${thumbnailLog.join(", ")}; invalidations: ${invalidationLog.join(", ")}`).toBeLessThanOrEqual(1);

  const longTasks = await page.evaluate(() => (window as any).__longTasks as number[]);
  if (longTasks.length) expect(Math.max(...longTasks)).toBeLessThanOrEqual(200);

  const largeDocument = [
    "<!doctype html>", "<html>", "<head><title>Large document</title></head>", "<body>",
    '<p id="typing-target">Typing</p>',
    ...Array.from({ length: 99_992 }, (_, index) => `<!-- line ${index} -->`),
    "</body>", "</html>",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "large-document.html",
    mimeType: "text/html",
    buffer: Buffer.from(largeDocument),
  });
  const target = frame.locator("#typing-target");
  await target.dblclick();
  for (const character of "abcdefghij") {
    const duration = await target.evaluate((element, nextCharacter) => new Promise<number>((resolvePromise) => {
      const started = performance.now();
      element.textContent = (element.textContent || "") + nextCharacter;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: nextCharacter }));
      requestAnimationFrame(() => resolvePromise(performance.now() - started));
    }), character);
    record("typingAcknowledgement", duration);
  }
  await expect(target).toContainText("abcdefghij");
  expect(percentile(measurements.typingAcknowledgement, 0.5)).toBeLessThanOrEqual(50);
  expect(percentile(measurements.typingAcknowledgement, 0.95)).toBeLessThanOrEqual(100);

  const delayed = readFileSync(resolve("fixtures", "compatibility", "delayed-deck", "index.html"), "utf8");
  const dataUrl = `data:text/html,${encodeURIComponent(delayed)}`;
  await page.goto(`/?trusted=1&load=${encodeURIComponent(dataUrl)}`);
  await expect(page.locator(".navigator-slide-list")).toHaveAttribute("data-total-pages", "2");
  const afterInsertion = await page.evaluate(() => performance.now() - Number((window as any).__fixtureInsertedAt || 0));
  record("asynchronousSlideInsertion", afterInsertion);
  expect(afterInsertion).toBeLessThanOrEqual(750);
});
