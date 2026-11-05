import http from "node:http";
import { WebSocketServer } from "ws";
import { Repo } from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";

const port = Number(process.env.SYNC_PORT || 3030);
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

server.listen(port, "0.0.0.0", () => {
  console.log(`Automerge sync server listening on ws://0.0.0.0:${port}`);
});
