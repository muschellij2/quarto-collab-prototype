import http from "node:http";
import { WebSocketServer } from "ws";
import { Repo } from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";

const port = Number(process.env.SYNC_PORT || 3030);
// Loopback only: browsers reach this through Vite's /sync proxy, and the
// server has no authentication.
const host = process.env.SYNC_HOST || "127.0.0.1";
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("quarto-collab sync server\n");
});
const wss = new WebSocketServer({ server });

new Repo({
  storage: new NodeFSStorageAdapter(".automerge-data"),
  network: [new WebSocketServerAdapter(wss)],
  // A production service needs an authorization-aware share policy.
});

server.listen(port, host, () => {
  console.log(`Automerge sync server listening on ws://${host}:${port}`);
});
