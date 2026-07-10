import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };

function fixtureUrl(name: string, trusted = false) {
  const html = readFileSync(resolve("fixtures", "compatibility", name, "index.html"), "utf8");
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  return `/?fixture=${encodeURIComponent(name)}#${trusted ? "trusted=1&" : ""}load=${encodeURIComponent(dataUrl)}`;
}

test("shows the running version and a ready bridge status", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(`v${packageJson.version}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Status" }).click();
  const panel = page.locator(".diagnostics-panel");
  await expect(panel.getByText("Ready", { exact: true })).toBeVisible();
  await expect(panel.getByText(packageJson.version, { exact: true })).toBeVisible();
  await expect(panel.getByText("Browser", { exact: true })).toBeVisible();
  await expect(panel.getByText("bridge-ready", { exact: true })).toBeVisible();
});

test("quarantines restrictive author CSP while preserving a visible warning", async ({ page }) => {
  await page.goto(fixtureUrl("restrictive-csp"));
  await page.getByRole("button", { name: "Status" }).click();
  const panel = page.locator(".diagnostics-panel");
  await expect(panel.getByText("Ready with warnings", { exact: true })).toBeVisible();
  await expect(panel.getByText("document-csp-detected", { exact: true })).toBeVisible();
  await expect(page.locator(".preview-failure")).toHaveCount(0);
});

test("reports an intentionally blocked bridge as failed with a diagnostic code", async ({ page }) => {
  await page.goto(fixtureUrl("blocked-bridge", true));
  await page.getByRole("button", { name: "Status" }).click();
  const panel = page.locator(".diagnostics-panel");
  await expect(panel.getByText("Failed", { exact: true })).toBeVisible({ timeout: 2000 });
  await expect(panel.getByText("bridge-runtime-error", { exact: true })).toBeVisible();
});

test("loads sibling CSS, image, and module resources from an HTTP document base", async ({ page }) => {
  const html = readFileSync(resolve("fixtures", "compatibility", "relative-assets", "index.html"), "utf8");
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const base = "/fixtures/compatibility/relative-assets/";
  await page.goto(`/?fixture=relative-assets#trusted=1&load=${encodeURIComponent(dataUrl)}&resourceBase=${encodeURIComponent(base)}`);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#module-status")).toHaveText("Module loaded");
  await expect(frame.locator("#module-status")).toHaveAttribute("data-font-loaded", "true");
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(238, 248, 246)");
  await expect(frame.locator("body")).not.toHaveCSS("background-image", "none");
  expect(await frame.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test("tracks the active explicit page promptly after scrolling", async ({ page }) => {
  await page.goto(fixtureUrl("explicit-deck"));
  await expect(page.locator(".navigator-slide-list")).toHaveAttribute("data-total-pages", "2");
  await expect(page.locator(".navigator-slide-list > button.is-active")).toContainText("First explicit page");
  await page.evaluate(() => {
    const list = document.querySelector(".navigator-slide-list");
    (window as any).__activePageTimestamp = 0;
    const observer = new MutationObserver(() => {
      if (list?.querySelector("button.is-active")?.textContent?.includes("Second explicit page")) {
        (window as any).__activePageTimestamp = performance.timeOrigin + performance.now();
        observer.disconnect();
      }
    });
    if (list) observer.observe(list, { attributes: true, childList: true, subtree: true, attributeFilter: ["class"] });
  });
  const scrolledAt = await page.frameLocator("iframe").locator("section.slide").nth(1).evaluate((element) => {
    element.scrollIntoView();
    return performance.timeOrigin + performance.now();
  });
  await expect(page.locator(".navigator-slide-list > button.is-active")).toContainText("Second explicit page", { timeout: 200 });
  const activeAt = await page.evaluate(() => (window as any).__activePageTimestamp as number);
  expect(activeAt - scrolledAt).toBeGreaterThanOrEqual(0);
  expect(activeAt - scrolledAt).toBeLessThanOrEqual(200);
});

test("separates element selection from explicit text editing", async ({ page }) => {
  await page.goto(fixtureUrl("plain-page"));
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("This fixture verifies ordinary bridge readiness.", { exact: true })).toBeVisible();
  const paragraph = frame.locator("p");
  await paragraph.click();
  await expect(paragraph).not.toHaveAttribute("contenteditable", "true");
  await paragraph.dblclick();
  await expect(paragraph).toHaveAttribute("contenteditable", "true");
});

test("supports the keyboard selection, edit, and two-stage Escape contract", async ({ page }) => {
  await page.goto(fixtureUrl("plain-page"));
  const paragraph = page.frameLocator("iframe").getByText("This fixture verifies ordinary bridge readiness.", { exact: true });
  await expect(paragraph).toBeVisible();
  await paragraph.click();
  await paragraph.press("Enter");
  await expect(paragraph).toHaveAttribute("contenteditable", "true");
  await paragraph.press("Escape");
  await expect(paragraph).not.toHaveAttribute("contenteditable", "true");
  await paragraph.press("Escape");
  await expect(page.getByText("No element selected", { exact: true })).toBeVisible();
});

test("keeps named navigation controls reachable at narrow 200-percent layout", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto(fixtureUrl("explicit-deck"));
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const navigator = page.getByRole("complementary", { name: "Document navigator" });
  await expect(navigator).toBeVisible();
  const collapse = navigator.getByRole("button", { name: "Collapse document navigator" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(navigator.getByRole("button", { name: "Expand document navigator" })).toBeVisible();
});

test("groups a typing burst into one incremental history transaction", async ({ page }) => {
  await page.goto(fixtureUrl("plain-page"));
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("This fixture verifies ordinary bridge readiness.", { exact: true })).toBeVisible();
  const paragraph = frame.locator("p");
  await paragraph.dblclick();
  await paragraph.press("End");
  await paragraph.pressSequentially("1234567890", { delay: 10 });
  await expect(paragraph).toContainText("1234567890");
  await page.waitForTimeout(550);

  await page.getByTitle("Undo (Ctrl+Z)").click();
  await expect(page.frameLocator("iframe").getByText("This fixture verifies ordinary bridge readiness.", { exact: true })).toBeVisible();
});

test("reacts to slides inserted after bridge startup without user interaction", async ({ page }) => {
  await page.goto(fixtureUrl("delayed-deck", true));
  await expect(page.locator(".deck-navigator:not(.is-collapsed)")).toBeVisible({ timeout: 1500 });
  await expect(page.locator(".navigator-slide-list > button")).toHaveCount(3);
});

test("clears a detached selection and republishes navigation after a framework rerender", async ({ page }) => {
  await page.goto(fixtureUrl("framework-rerender", true));
  const frame = page.frameLocator("iframe");
  await frame.getByText("Select this text", { exact: true }).click();
  await expect(page.getByText("No element selected", { exact: true })).toBeVisible({ timeout: 1200 });
  await expect(frame.getByText("Framework replacement complete", { exact: true })).toBeVisible();
  await expect(page.locator(".navigator-slide-list")).toHaveAttribute("data-total-pages", "2");
});

test("recovers an undetected deck with a user-supplied selector", async ({ page }) => {
  await page.goto(fixtureUrl("manual-deck"));
  await page.getByRole("button", { name: "Expand document navigator" }).click();
  await page.getByLabel("CSS selector").fill(".manual-surface");
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  await expect(page.locator(".deck-navigator:not(.is-collapsed)")).toBeVisible();
  await expect(page.locator(".navigator-slide-list")).toHaveAttribute("data-total-pages", "3");
  await expect(page.locator(".navigator-slide-list strong", { hasText: "Manual page three" })).toBeVisible();
});

test("virtualizes large page lists while retaining the total page count", async ({ page }) => {
  await page.goto(fixtureUrl("large-deck"));
  const list = page.locator(".navigator-slide-list");
  await expect(list).toHaveAttribute("data-total-pages", "60");
  expect(await list.locator(":scope > button").count()).toBeLessThan(30);
});

test("shows the full outline and cycles canvas ancestors with Alt-click", async ({ page }) => {
  await page.goto(fixtureUrl("plain-page"));
  const paragraph = page.frameLocator("iframe").getByText("This fixture verifies ordinary bridge readiness.", { exact: true });
  await paragraph.click();
  await paragraph.click({ modifiers: ["Alt"] });
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(page.locator(".outline-row.is-active .outline-select")).toHaveText("▾main");
});

test("maps repeated elements to the selected source line", async ({ page }) => {
  await page.goto(fixtureUrl("repeated-elements"));
  await page.frameLocator("iframe").getByText("Third value", { exact: true }).click();
  await expect(page.locator(".cm-source-sync-line")).toContainText("Third value");
});

test("can ignore a blocking overlay and select the content underneath", async ({ page }) => {
  await page.goto(fixtureUrl("overlay-hit-test"));
  const frame = page.frameLocator("iframe");
  await frame.getByLabel("Blocking overlay").click({ position: { x: 10, y: 10 } });
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  const activeOverlay = page.locator(".outline-row.is-active");
  await expect(activeOverlay).toContainText("div.overlay");
  await activeOverlay.getByRole("button", { name: /Ignore overlay/ }).click();
  await frame.getByText("Selectable card content", { exact: true }).click();
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(page.locator(".outline-row.is-active")).toContainText("h1");
});

test("separates blocked local and offline external resource diagnostics", async ({ page }) => {
  await page.goto(fixtureUrl("external-assets"));
  await page.getByRole("button", { name: "Status" }).click();
  const panel = page.locator(".diagnostics-panel");
  await expect(panel.getByText("resource-blocked", { exact: true })).toBeVisible();
  await expect(panel.getByText("resource-offline", { exact: true })).toBeVisible();
  expect(await page.frameLocator("iframe").locator("#allowed-data").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test("rejects bridge-shaped messages from trusted author scripts", async ({ page }) => {
  await page.goto(fixtureUrl("spoofed-bridge", true));
  await page.waitForTimeout(200);
  await expect(page.locator(".deck-navigator.is-collapsed")).toBeVisible();
  await expect(page.getByText("Spoofed Page", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Status" }).click();
  await expect(page.locator(".diagnostics-panel").getByText("bridge-session-rejected", { exact: true })).toBeVisible();
});
