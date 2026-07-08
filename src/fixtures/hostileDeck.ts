export const HOSTILE_DECK_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hostile Deck</title>
    <style>
      body { margin: 0; }
      section.slide { min-height: 100vh; scroll-snap-align: start; }
    </style>
    <script>
      window.__authorHeadScriptRan = true;
    </script>
  </head>
  <body>
    <section class="slide" data-title="One">
      <h2>Slide One</h2>
      <p id="editable">Alpha bravo charlie</p>
    </section>
    <section class="slide" data-title="Two">
      <h2>Slide Two</h2>
      <p>Second slide</p>
      <input id="deck-input" type="text" value="" />
      <a id="deck-link" href="https://example.com">Example</a>
    </section>
    <section class="slide" data-title="Three">
      <h2>Slide Three</h2>
      <p>Third slide</p>
    </section>
    <script>
      (function () {
        window.__deckKeysSeen = [];
        window.__deckSlideIndex = 0;
        function nav(event) {
          var keys = [" ", "Backspace", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
          if (keys.indexOf(event.key) === -1) return;
          event.preventDefault();
          window.__deckKeysSeen.push(event.key);
          if (event.key === " " || event.key === "ArrowRight" || event.key === "PageDown" || event.key === "End") {
            window.__deckSlideIndex = Math.min(2, window.__deckSlideIndex + 1);
          } else {
            window.__deckSlideIndex = Math.max(0, window.__deckSlideIndex - 1);
          }
        }
        window.addEventListener("keydown", nav, true);
        document.addEventListener("keydown", nav);
      })();
    </script>
  </body>
</html>`;

export function installHostileDeckNavigation(win: Window & typeof globalThis) {
  (win as any).__deckKeysSeen = [];
  (win as any).__deckSlideIndex = 0;
  function nav(event: KeyboardEvent) {
    const keys = [" ", "Backspace", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    (win as any).__deckKeysSeen.push(event.key);
    if (event.key === " " || event.key === "ArrowRight" || event.key === "PageDown" || event.key === "End") {
      (win as any).__deckSlideIndex = Math.min(2, (win as any).__deckSlideIndex + 1);
    } else {
      (win as any).__deckSlideIndex = Math.max(0, (win as any).__deckSlideIndex - 1);
    }
  }
  win.addEventListener("keydown", nav, true);
  win.document.addEventListener("keydown", nav);
}

export const REVEAL_DECK_HTML = `<!doctype html>
<html lang="en">
  <head><title>Reveal Deck</title></head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section>
          <h2>Horizontal One</h2>
        </section>
        <section>
          <section><h2>Vertical Two A</h2></section>
          <section><h2>Vertical Two B</h2></section>
        </section>
      </div>
    </div>
  </body>
</html>`;
