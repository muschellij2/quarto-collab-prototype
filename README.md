# Quarto Collab Prototype

A deliberately small “Overleaf for Quarto” proof-of-concept:

- **CodeMirror 6** edits ordinary Quarto Markdown.
- **Automerge Repo** holds the live collaborative state.
- **IndexedDB** keeps local/offline state.
- **WebSocket + BroadcastChannel** synchronize peers.
- **webR** can execute simple R chunks in-browser for fast feedback.
- **Quarto + R in a devcontainer/Codespace** remains the canonical reproducible execution environment.
- **GitHub** remains the durable project/version-review layer.

## Layout

- `paper/`: the Quarto project (`_quarto.yml`, `index.qmd`). These are the real, Git-tracked files.
- `src/`, `index.html`: the browser editor (Vite).
- `server/`: the Automerge sync server and the filesystem bridge.

The Quarto project lives in its own folder because a Quarto website at the repository root would treat the editor's `index.html` as rendered output of `index.qmd` and delete it.

## Run

```bash
npm install
npm run dev:all   # sync server + filesystem bridge, Vite, and quarto preview
```

`quarto` must be on your PATH. On macOS with RStudio you can use the bundled copy: `export PATH="/Applications/RStudio.app/Contents/Resources/app/quarto/bin:$PATH"`.

Open `http://localhost:5173`. The editor opens `paper/index.qmd`, and the middle pane shows the rendered preview (also at `/preview/`). Copy the collaboration URL and open it in another browser to edit together.

## What happens when you type

1. Every keystroke is an Automerge change, synced to other browsers through the server.
2. About 200 ms after typing pauses, the server writes the text to `paper/index.qmd`. It writes a temp file and renames it, so readers never see a half-written file.
3. `quarto preview` sees the file change, re-renders, and the preview reloads.
4. `git diff` shows ordinary changes to `paper/index.qmd`. Commit them as usual; nothing is committed automatically.

You can also edit `paper/index.qmd` in VS Code (or `git checkout` it) while people are typing in the browser. The server merges the file change into the Automerge document as a concurrent edit, so neither side's work is lost. Edits made while the server was stopped are merged the same way on the next start.

During a session, the Automerge document is authoritative and the file is kept in step with it. The server's state lives in `paper/.automerge-data/` and `paper/.automerge-bridge.json` (both ignored by Git). Deleting them is safe: the server re-imports from the `.qmd` files, but open browser tabs must then be reloaded without the old `#automerge:` URL.

## Tests

```bash
npm test           # filesystem bridge: concurrent edits, restarts, CRLF/BOM
npm run test:e2e   # two browsers, webR, and live Quarto preview (first: npx playwright install chromium)
```

The e2e tests start their own servers on ports 5174/3031/4201 against a scratch copy in `e2e-root/`, so they don't touch a running session. The preview test is skipped if `quarto` is not on PATH, and the webR test needs network access.

## Run in GitHub Codespaces

Only port **5173** is exposed. The browser talks HTTPS/WSS to Vite, which proxies `/sync` to the sync server (`127.0.0.1:3030`) and `/preview/` to `quarto preview` (`127.0.0.1:4200`, mounted at `/proxy/4200/` because Quarto's live-reload understands that prefix). Ports 3030 and 4200 are never forwarded.

1. **Code → Codespaces → Create codespace on this branch.** The devcontainer installs R, Node, Quarto and runs `npm install`.
2. In the Codespace terminal: `npm run dev:all`
3. Open the **Ports** tab and open the forwarded address for 5173 (`https://<codespace>-5173.app.github.dev`).
4. Click **Copy collaboration URL** (it includes `#automerge:...`) and open it in a second browser.

Port visibility matters for the second browser. Forwarded ports are **private** by default, which means only you, signed in to GitHub, can open them. To let someone else join, right-click port 5173 → **Port Visibility** → **Public** (anyone with the URL) or **Private to Organization**. The sync server has no authentication of its own, so treat a public URL as a write-access link and switch it back to private when you're done.

## Recommended document model

For a first production version, use **one Automerge document per text file**:

```ts
{
  path: "analysis.qmd",
  text: "...",
  metadata: { language: "quarto" }
}
```

Maintain a separate project/root document containing file references, users, comments, and settings. Do not put an entire large repository in one Automerge document.

## Execution model

Use two paths:

### Fast local path

Run compatible R cells using webR. Similar support can be added with Pyodide for Python. This is for low-latency exploration, not canonical reproducibility.

### Canonical path

Run the actual repository in a Codespace/devcontainer with pinned R packages (`renv`), Python packages (`uv`/`requirements.lock`), Quarto, extensions, system dependencies, and data mounts. A “Render” button can call a small authenticated service inside that environment and stream the rendered preview/logs back to the browser.

## Missing production features

- authentication / authorization and per-document ACLs;
- presence, cursors, comments, suggestions;
- new or deleted `.qmd` files while the server runs (files are discovered at startup);
- Quarto syntax services and visual/source reconciliation;
- canonical render service and preview streaming;
- secrets and data-access isolation;
- large binary asset handling (Git/LFS/object storage rather than CRDT text);
- conflict UX for changes made outside the collaborative editor.

## Security note

The included sync server has no authentication and is for local/prototype use only.
