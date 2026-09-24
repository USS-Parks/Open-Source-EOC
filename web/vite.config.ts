import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offlineShell } from "./src/offline/precache-plugin.js";

/**
 * Web build config. `vite build` (from the web package) bundles the app
 * from index.html into web/dist, which any static host serves alongside
 * the API (see deploy/README.md). The cop-demo E2E harness builds its own
 * root separately and does not use this config. The offline shell plugin
 * writes the service worker and its precache list into the bundle.
 */
export default defineConfig({
  plugins: [react(), offlineShell()],
  build: { outDir: "dist", emptyOutDir: true },
});
