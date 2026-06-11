import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "public", "stress-fixtures");

function padLines(lines, targetLineCount) {
  while (lines.length < targetLineCount - 1) {
    lines.push(`<!-- filler line ${lines.length} -->`);
  }
}

function buildCssFixture(lineCount) {
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>CSS Stress Fixture</title>",
    "<style>",
    "body { margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #1f2933; }",
    ".hero { position: sticky; top: 0; z-index: 2; padding: 24px; background: #ffffff; border-bottom: 1px solid #d7dde5; }",
    ".grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; padding: 16px; }",
    ".tile { min-height: 52px; border-radius: 8px; padding: 10px; background: linear-gradient(135deg, #ffffff, #eef8f6); border: 1px solid #d7dde5; animation: pulse 2.5s ease-in-out infinite; }",
    "@keyframes pulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }",
    "</style>",
    "</head>",
    "<body>",
    '<main id="stress-css-ready">',
    '<section class="hero">',
    "<h1>CSS stress fixture ready</h1>",
    "<p>Ten thousand lines with many rendered elements and CSS animation.</p>",
    "</section>",
    '<section class="grid">',
  ];

  for (let index = 0; index < 3200; index += 1) {
    lines.push(`<article class="tile"><strong>Card ${index + 1}</strong><span> Animated tile ${index + 1}</span></article>`);
  }

  lines.push("</section>", "</main>");
  padLines(lines, lineCount);
  lines.push("</body>", "</html>");
  return `${lines.join("\n")}\n`;
}

function buildScriptedFixture(lineCount) {
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Scripted Stress Fixture</title>",
    "<style>",
    "body { margin: 0; min-height: 100vh; overflow: hidden; font-family: system-ui, sans-serif; background: #101820; color: #f8fafc; }",
    ".stage { position: relative; min-height: 100vh; padding: 28px; }",
    ".orb { position: absolute; width: 14px; height: 14px; border-radius: 999px; background: #24c6dc; box-shadow: 0 0 18px #24c6dc; }",
    ".panel { position: relative; z-index: 1; width: min(760px, calc(100vw - 56px)); padding: 24px; border: 1px solid rgba(255,255,255,.24); border-radius: 8px; background: rgba(16, 24, 32, .74); }",
    "</style>",
    "</head>",
    "<body>",
    '<main class="stage">',
    '<section class="panel">',
    '<h1 id="stress-script-ready">Script fixture waiting</h1>',
    "<p>This document only becomes visibly active when trusted scripts are enabled.</p>",
    "</section>",
  ];

  for (let index = 0; index < 18000; index += 1) {
    lines.push(`<span class="orb" style="left:${index % 100}vw;top:${index % 100}vh"></span>`);
  }

  lines.push(
    "</main>",
    "<script>",
    "document.body.dataset.stressReady = 'scripted';",
    "document.getElementById('stress-script-ready').textContent = 'Script animation active';",
    "const orbs = Array.from(document.querySelectorAll('.orb')).slice(0, 480);",
    "let frame = 0;",
    "function tick() {",
    "  frame += 1;",
    "  for (let index = 0; index < orbs.length; index += 1) {",
    "    const x = Math.sin((frame + index) / 23) * 34;",
    "    const y = Math.cos((frame + index) / 29) * 28;",
    "    orbs[index].style.transform = `translate(${x}px, ${y}px)`;",
    "  }",
    "  requestAnimationFrame(tick);",
    "}",
    "tick();",
    "</script>",
  );

  padLines(lines, lineCount);
  lines.push("</body>", "</html>");
  return `${lines.join("\n")}\n`;
}

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "large-css-10000.html"), buildCssFixture(10000));
await writeFile(join(outputDir, "large-scripted-100000.html"), buildScriptedFixture(100000));

console.log("Generated stress fixtures:");
console.log("  public/stress-fixtures/large-css-10000.html");
console.log("  public/stress-fixtures/large-scripted-100000.html");
