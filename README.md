# Quarto Collab Prototype

A deliberately small “Overleaf for Quarto” proof-of-concept:

- **CodeMirror 6** edits ordinary Quarto Markdown.
- **Automerge Repo** holds the live collaborative state.
- **IndexedDB** keeps local/offline state.
- **WebSocket + BroadcastChannel** synchronize peers.
- **webR** can execute simple R chunks in-browser for fast feedback.
- **Quarto + R in a devcontainer/Codespace** remains the canonical reproducible execution environment.
- **GitHub** remains the durable project/version-review layer.

## Run

```bash
npm install
npm run dev:all
```

Open `http://localhost:5173`. Copy the collaboration URL and open it in another browser/profile. Edits should converge through Automerge.

## Why this is only the editor half

The Automerge document and `index.qmd` are intentionally separate in this prototype. The production design should add a **Git/file bridge** that:

1. imports a `.qmd` file into an Automerge document;
2. watches the Automerge document and atomically materializes its text to the working tree;
3. watches external filesystem/Git changes and applies them back to Automerge as text splices;
4. creates explicit checkpoints/commits instead of committing keystrokes;
5. detects destructive rewrites and asks for reconciliation rather than silently replacing live state.

That bridge is the most important next component.

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
- filesystem ↔ Automerge bridge;
- Quarto syntax services and visual/source reconciliation;
- canonical render service and preview streaming;
- secrets and data-access isolation;
- large binary asset handling (Git/LFS/object storage rather than CRDT text);
- conflict UX for changes made outside the collaborative editor.

## Security note

The included sync server has no authentication and is for local/prototype use only.
