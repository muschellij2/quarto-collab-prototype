import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
  ],

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