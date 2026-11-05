import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import { Repo } from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { startFileBridge, type FileBridge } from "./fs-bridge.ts";

const port = Number(process.env.SYNC_PORT || 3030);
// Loopback only: browsers reach this through Vite's /sync proxy, and the
// server has no authentication.
const host = process.env.SYNC_HOST || "127.0.0.1";
// The Quarto project whose .qmd files are bridged (tests use a scratch copy).
const root = path.resolve(process.env.COLLAB_ROOT || "paper");

// .qmd files in the project, skipping dot dirs, Quarto output (_site,
// _freeze, ...) and node_modules.
async function findQmdFiles(dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (/^[._]/.test(entry.name) || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findQmdFiles(full)));
    else if (entry.name.endsWith(".qmd")) out.push(path.relative(root, full));
  }
  return out.sort();
}

const bridges = new Map<string, FileBridge>();

const server = http.createServer((req, res) => {
  if (req.url === "/api/files") {
    const files = [...bridges].map(([p, b]) => ({ path: p, url: b.handle.url }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(files));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("quarto-collab sync server\n");
});
const wss = new WebSocketServer({ server });

const repo = new Repo({
  storage: new NodeFSStorageAdapter(path.join(root, ".automerge-data")),
  network: [new WebSocketServerAdapter(wss)],
  // A production service needs an authorization-aware share policy.
});

for (const relPath of await findQmdFiles()) {
  try {
    bridges.set(relPath, await startFileBridge({ repo, root, relPath, statePath: path.join(root, ".automerge-bridge.json") }));
    console.log(`bridging ${relPath}`);
  } catch (e) {
    console.error(`not bridging ${relPath}:`, e instanceof Error ? e.message : e);
  }
}

server.listen(port, host, () => {
  console.log(`Automerge sync server listening on ws://${host}:${port}`);
});

async function shutdown() {
  for (const b of bridges.values()) await b.stop(); // flush pending writes
  await repo.shutdown();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
