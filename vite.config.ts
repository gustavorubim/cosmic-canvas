import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json";

export default defineConfig({
  plugins: [react()],
  server: {
    // VS Code's test host creates and locks transient profile files. Watching
    // them can crash a concurrently running Vite server with EBUSY on Windows.
    watch: { ignored: ["**/.vscode-test/**", "**/tmp/**", "**/test-results/**"] },
  },
  // The iframe bridge is assembled from Function#toString output. Identifier
  // transforms can otherwise rename or wrap referenced helpers independently,
  // which only fails in packaged builds.
  define: {
    __COSMIC_CANVAS_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    // Full identifier minification is incompatible with
    // serializing mutually dependent functions into the iframe at runtime.
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/@lezer/")) return "lezer";
          if (
            normalized.includes("/node_modules/@codemirror/") ||
            normalized.includes("/node_modules/codemirror/")
          ) {
            return "codemirror";
          }
          return undefined;
        },
      },
    },
  },
});
