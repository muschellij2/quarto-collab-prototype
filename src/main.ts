import { Repo, isValidAutomergeUrl } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { WebR } from "webr";
import "./style.css";

type QDoc = {
  path: string;
  text: string;
  updatedAt: number;
};

const DEFAULT_QMD = `---
title: "Collaborative Quarto"
format: html
---

# Hello

This file is edited through Automerge and remains ordinary Quarto source.

\`\`\`{r}
x <- rnorm(100)
mean(x)
\`\`\`
`;

const syncUrl =
  import.meta.env.VITE_SYNC_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync`;
const repo = new Repo({
  storage: new IndexedDBStorageAdapter("quarto-collab"),
  network: [
    new BroadcastChannelNetworkAdapter(),
    new WebSocketClientAdapter(syncUrl),
  ],
});

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header>
    <div><strong>Quarto Collab</strong><span class="tag">Automerge + CodeMirror + webR</span></div>
    <div id="status">connecting…</div>
  </header>
  <main>
    <section class="editor-pane">
      <div class="toolbar">
        <button id="share">Copy collaboration URL</button>
        <button id="run-r">Run R chunks locally</button>
        <select id="file"></select>
        <span id="doc-id"></span>
      </div>
      <div id="editor"></div>
    </section>
    <section class="preview-pane">
      <div class="toolbar"><strong>Quarto preview</strong><a href="/preview/" target="_blank">open in new tab</a></div>
      <iframe id="preview" src="/preview/" title="Quarto preview"></iframe>
    </section>
    <aside>
      <h3>Local R output</h3>
      <p class="hint">Runs compatible <code>{r}</code> chunks in this browser with webR. This is optional; canonical renders should run in the repo's container/Codespace.</p>
      <pre id="output">Not run yet.</pre>
    </aside>
  </main>`;

// Files the server bridges to disk, each with its Automerge document URL.
const files: { path: string; url: string }[] = await fetch("/api/files").then((r) => r.json());
const fileSelect = document.querySelector<HTMLSelectElement>("#file")!;
fileSelect.innerHTML = files.map((f) => `<option value="${f.url}">${f.path}</option>`).join("");
fileSelect.onchange = () => {
  location.hash = encodeURIComponent(fileSelect.value);
  location.reload();
};

async function getHandle() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && isValidAutomergeUrl(hash)) {
    return repo.find<QDoc>(hash);
  }
  const file = files.find((f) => f.path === "index.qmd") ?? files[0];
  if (file) {
    location.hash = encodeURIComponent(file.url);
    return repo.find<QDoc>(file.url);
  }
  const handle = repo.create<QDoc>({ path: "index.qmd", text: DEFAULT_QMD, updatedAt: Date.now() });
  location.hash = encodeURIComponent(handle.url);
  return handle;
}

const handle = await getHandle();
await handle.whenReady();
const initial = handle.doc();
if (!initial) throw new Error("Automerge document failed to load");

fileSelect.value = handle.url;
document.querySelector("#doc-id")!.textContent = handle.url;
document.querySelector("#status")!.textContent = "local-first • sync enabled";

const view = new EditorView({
  doc: initial.text,
  extensions: [
    basicSetup,
    keymap.of(defaultKeymap),
    markdown(),
    EditorView.lineWrapping,
    automergeSyncPlugin({ handle, path: ["text"] }),
  ],
  parent: document.querySelector("#editor")!,
});

handle.on("change", () => {
  const status = document.querySelector("#status")!;
  status.textContent = "synced " + new Date().toLocaleTimeString();
});

document.querySelector<HTMLButtonElement>("#share")!.onclick = async () => {
  await navigator.clipboard.writeText(location.href);
  document.querySelector<HTMLButtonElement>("#share")!.textContent = "Copied";
  setTimeout(() => (document.querySelector<HTMLButtonElement>("#share")!.textContent = "Copy collaboration URL"), 1200);
};

function extractRChunks(qmd: string): string[] {
  const chunks: string[] = [];
  const re = /```\{r[^}]*\}\s*\n([\s\S]*?)\n```/g;
  for (const match of qmd.matchAll(re)) chunks.push(match[1]);
  return chunks;
}

let webR: WebR | undefined;
document.querySelector<HTMLButtonElement>("#run-r")!.onclick = async () => {
  const output = document.querySelector<HTMLPreElement>("#output")!;
  const button = document.querySelector<HTMLButtonElement>("#run-r")!;
  button.disabled = true;
  output.textContent = "Starting webR…";
  try {
    if (!webR) {
      webR = new WebR();
      await webR.init();
    }
    const chunks = extractRChunks(view.state.doc.toString());
    if (!chunks.length) {
      output.textContent = "No {r} chunks found.";
      return;
    }
    const lines: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const shelter = await new webR.Shelter();
      try {
        const result = await shelter.captureR(chunks[i], { withAutoprint: true });
        lines.push(`## R chunk ${i + 1}`);
        lines.push(...result.output.map((x: any) => x.data));
      } finally {
        shelter.purge();
      }
    }
    output.textContent = lines.join("\n") || "Chunk completed with no text output.";
  } catch (e) {
    output.textContent = `webR error:\n${e instanceof Error ? e.message : String(e)}`;
  } finally {
    button.disabled = false;
  }
};

window.addEventListener("beforeunload", () => view.destroy());
