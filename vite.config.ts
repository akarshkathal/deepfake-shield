/**
 * vite.config.ts
 *
 * Builds a Chrome Extension (Manifest V3) with multiple entry points:
 *  - background.ts  → background.js  (service worker)
 *  - content.ts     → content.js     (injected into Instagram)
 *  - popup.ts       → popup.js       (popup UI)
 *  - detector.worker.ts → detector.worker.js  (Web Worker for inference)
 *
 * The WASM files for ONNX Runtime (used by transformers.js) are copied
 * into the dist folder so they are accessible as chrome extension resources.
 *
 * Usage:
 *   npm run build       → builds to dist/
 *   npm run dev         → watch mode (no HMR for extensions, just rebuilds)
 */

import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "esnext",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content:    resolve(__dirname, "src/content.ts"),
        popup:      resolve(__dirname, "src/popup.ts"),
        offscreen:  resolve(__dirname, "src/offscreen.ts"),
        "detector.worker": resolve(__dirname, "src/detector.worker.ts"),
      },
      output: {
        // Each entry becomes a flat JS file at the root of dist/
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        // Extension files must NOT be ES modules (except the worker)
        // background.js and content.js are loaded as classic scripts by Chrome
        format: "es",
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        // Copy manifest and static assets from public/
        { src: "public/manifest.json",  dest: "." },
        { src: "public/popup.html",     dest: "." },
        { src: "public/popup.css",      dest: "." },
        { src: "public/content.css",    dest: "." },
        { src: "public/offscreen.html", dest: "." },
        { src: "public/icons/**",       dest: "icons" },

        // Copy ONNX Runtime files (both .wasm binaries AND .mjs loader helpers).
        // transformers.js loads the .mjs file dynamically at runtime, which
        // would normally come from a CDN — but Chrome MV3 CSP blocks that.
        // We copy them locally and point env.backends.onnx.wasm.wasmPaths
        // to chrome.runtime.getURL("") in the worker.
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: ".",
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.mjs",
          dest: ".",
        },
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
});
