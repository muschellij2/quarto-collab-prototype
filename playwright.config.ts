import { defineConfig } from "@playwright/test";

// Own ports and a scratch project copy (.e2e-root), so tests never touch a
// running dev session or the repo's real index.qmd.
const env = { SYNC_PORT: "3031", COLLAB_ROOT: ".e2e-root" };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:5174" },
  webServer: [
    {
      command: "rm -rf .e2e-root && mkdir .e2e-root && cp index.qmd .e2e-root/ && tsx server/sync-server.ts",
      url: "http://127.0.0.1:3031/api/files",
      env,
    },
    {
      command: "vite --port 5174 --strictPort",
      url: "http://localhost:5174",
      env,
    },
  ],
});
