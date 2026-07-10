import { moduleMessage } from "./module-helper.js";

const status = document.querySelector("#module-status");
status.textContent = moduleMessage;
try {
  await document.fonts.load('16px "CosmicFixture"', "A");
  status.dataset.fontLoaded = String(document.fonts.check('16px "CosmicFixture"', "A"));
} catch (error) {
  status.dataset.fontLoaded = "false";
  status.dataset.fontError = error instanceof Error ? error.name : "FontError";
}
