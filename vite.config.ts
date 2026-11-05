import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

// @automerge/automerge's "browser" export imports its .wasm module directly
// (`import * as wasm from "./automerge_wasm_bg.wasm"`, the ESM-integration
// proposal), which Vite does not support natively. vite-plugin-wasm handles
// that import. The generated module uses top-level await, so we target
// ES2022 rather than down-levelling it. webR is unaffected: it fetches R.wasm
// at runtime inside its own worker.
export default defineConfig({
  plugins: [wasm()],

  build: {
    target: "es2022",
  },

  server: {
    host: "0.0.0.0",
    port: 5173,

    proxy: {
      "/sync": {
        target: "ws://127.0.0.1:3030",
        ws: true,
      },
    },
  },
});
