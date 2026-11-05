import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";

// @automerge/automerge's "browser" export imports its .wasm module directly
// (`import * as wasm from "./automerge_wasm_bg.wasm"`, the ESM-integration
// proposal), which Vite does not support natively. vite-plugin-wasm handles
// that import. The generated module uses top-level await, so we target
// ES2022 rather than down-levelling it. webR is unaffected: it fetches R.wasm
// at runtime inside its own worker.
const syncPort = process.env.SYNC_PORT || 3030;
const quartoPort = process.env.QUARTO_PORT || 4200;

// `quarto preview` is served under /proxy/<port>/ because that is a prefix
// its live-reload client already understands (code-server convention); under
// any other prefix a reload navigates to "/". /preview/ is the friendly alias.
const previewAlias: Plugin = {
  name: "preview-alias",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== "/preview" && req.url !== "/preview/") return next();
      res.writeHead(302, { location: `/proxy/${quartoPort}/` });
      res.end();
    });
  },
};

export default defineConfig({
  plugins: [wasm(), previewAlias],

  build: {
    target: "es2022",
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    // Codespaces forwards requests with Host: <codespace>-5173.app.github.dev,
    // which Vite's DNS-rebinding protection rejects by default.
    allowedHosts: [".app.github.dev"],

    proxy: {
      "/sync": {
        target: `ws://127.0.0.1:${syncPort}`,
        ws: true,
      },
      "/api": `http://127.0.0.1:${syncPort}`,
      [`/proxy/${quartoPort}`]: {
        target: `http://127.0.0.1:${quartoPort}`,
        ws: true,
        rewrite: (p) => p.slice(`/proxy/${quartoPort}`.length) || "/",
      },
    },
  },
});
