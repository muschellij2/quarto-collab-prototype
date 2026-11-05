import { defineConfig } from "@playwright/test";
import { spawnSync } from "node:child_process";

// Own ports and a scratch project copy (e2e-root), so tests never touch a
// running dev session or the repo's real paper/.
const env = { SYNC_PORT: "3031", QUARTO_PORT: "4201", COLLAB_ROOT: "e2e-root" };
export const hasQuarto = spawnSync("quarto", ["--version"]).status === 0;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1, // the specs share one scratch document
  timeout: 60_000,
  use: { baseURL: "http://localhost:5174" },
  webServer: [
    {
      command:
        "rm -rf e2e-root && mkdir e2e-root && cp paper/index.qmd paper/_quarto.yml e2e-root/ && tsx server/sync-server.ts",
      url: "http://127.0.0.1:3031/api/files",
      env,
    },
    {
      command: "vite --port 5174 --strictPort",
      url: "http://localhost:5174",
      env,
    },
    ...(hasQuarto
      ? [{ command: "quarto preview e2e-root --port 4201 --no-browser", url: "http://127.0.0.1:4201", env, timeout: 120_000 }]
      : []),
  ],
});
