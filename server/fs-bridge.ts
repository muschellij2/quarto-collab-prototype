// Keeps one Automerge document in sync with one text file on disk.
//
// The Automerge document is authoritative during a session; the file is its
// materialized form. The bridge remembers `baseHeads`: the document version
// whose text equals what is on disk. An external edit (VS Code, git checkout)
// is applied with changeAt(baseHeads, ...), i.e. as a change concurrent with
// whatever collaborators typed since, so Automerge merges both instead of one
// overwriting the other. The same rule reconciles offline edits on startup.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { next as A } from "@automerge/automerge";
import { decodeHeads, encodeHeads } from "@automerge/automerge-repo";
import type { DocHandle, Repo, UrlHeads, AutomergeUrl } from "@automerge/automerge-repo";

export type QDoc = { path: string; text: string; updatedAt: number };

type FileState = { url: AutomergeUrl; heads: UrlHeads };
type State = Record<string, FileState>;

export type FileBridge = {
  handle: DocHandle<QDoc>;
  stats: { writes: number; ingests: number };
  stop(): Promise<void>;
};

const WRITE_DEBOUNCE_MS = 200;
const WATCH_DEBOUNCE_MS = 50;

// Files keep their own BOM/line-ending style; Automerge always holds LF text
// without a BOM so that CodeMirror offsets line up across clients.
type Format = { bom: boolean; eol: "\n" | "\r\n" };

function decode(buf: Buffer): { text: string; format: Format } {
  let text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); // throws on non-UTF-8
  const bom = text.startsWith("﻿");
  if (bom) text = text.slice(1);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { text: text.replace(/\r\n/g, "\n"), format: { bom, eol } };
}

function encode(text: string, format: Format): string {
  const body = format.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return (format.bom ? "﻿" : "") + body;
}

async function readFile(file: string) {
  try {
    return decode(await fsp.readFile(file));
  } catch (e: any) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
}

async function loadState(statePath: string): Promise<State> {
  try {
    return JSON.parse(await fsp.readFile(statePath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

// Several bridges share one state file, so updates are serialized.
let stateQueue = Promise.resolve();
function saveState(statePath: string, relPath: string, entry: FileState) {
  stateQueue = stateQueue.then(async () => {
    const state = await loadState(statePath);
    state[relPath] = entry;
    await atomicWrite(statePath, JSON.stringify(state, null, 2) + "\n");
  });
  return stateQueue;
}

// Write to a temp file in the same directory, fsync, then rename over the
// target, so readers (quarto preview, git, editors) never see a partial file.
async function atomicWrite(file: string, contents: string) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  const fh = await fsp.open(tmp, "w");
  try {
    await fh.writeFile(contents, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

export async function startFileBridge(opts: {
  repo: Repo;
  root: string;
  relPath: string;
  statePath: string;
}): Promise<FileBridge> {
  const { repo, root, relPath, statePath } = opts;
  const file = path.join(root, relPath);
  const stats = { writes: 0, ingests: 0 };

  const disk = await readFile(file);
  let format: Format = disk?.format ?? { bom: false, eol: "\n" };
  const saved = (await loadState(statePath))[relPath];

  let handle: DocHandle<QDoc>;
  let baseHeads: UrlHeads;
  // Text known to be on disk (normalized). Used to recognize our own writes.
  let onDisk: string | undefined;

  if (saved) {
    handle = await repo.find<QDoc>(saved.url);
    baseHeads = saved.heads;
    onDisk = handle.view(baseHeads).doc()!.text;
  } else {
    handle = repo.create<QDoc>({ path: relPath, text: disk?.text ?? "", updatedAt: Date.now() });
    baseHeads = handle.heads();
    onDisk = disk?.text;
  }

  // Persist heads only after the document itself is in storage, so that after
  // a crash the saved heads always refer to changes we can load.
  async function recordBase(heads: UrlHeads) {
    baseHeads = heads;
    await repo.flush([handle.documentId]);
    await saveState(statePath, relPath, { url: handle.url, heads });
  }

  // Bring the file's current contents into the document.
  async function ingest() {
    const current = await readFile(file);
    if (!current || current.text === onDisk) return; // deleted, or our own write
    format = current.format;
    // Fork at baseHeads, apply the file there, and merge back. This is what
    // handle.changeAt() is for, but in @automerge/automerge 3.5.0 changeAt on
    // a document loaded from storage materializes the wrong text (e.g. the
    // concurrent insert is duplicated), so we do the fork/merge explicitly.
    // clone() gives the fork a fresh actor id.
    let fork = A.clone(A.view(handle.doc()!, decodeHeads(baseHeads)));
    fork = A.change(fork, (d) => A.updateText(d, ["text"], current.text));
    handle.update((doc) => A.merge(doc, fork));
    onDisk = current.text;
    stats.ingests++;
    await recordBase(encodeHeads(A.getHeads(fork)));
  }

  async function write() {
    await ingest(); // never overwrite an external edit we have not merged yet
    const text = handle.doc()!.text;
    const heads = handle.heads();
    if (text === onDisk) return;
    await atomicWrite(file, encode(text, format));
    onDisk = text;
    stats.writes++;
    await recordBase(heads);
  }

  // All disk I/O runs through one queue so ingest and write never interleave.
  let queue = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).catch((e) => console.error(`[bridge] ${relPath}:`, e));
    return queue;
  };

  let writeTimer: NodeJS.Timeout | undefined;
  const scheduleWrite = () => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => enqueue(write), WRITE_DEBOUNCE_MS);
  };

  // Startup reconciliation: merge any offline file edit, then materialize.
  await enqueue(async () => {
    if (!saved) await recordBase(baseHeads);
    await write();
  });

  handle.on("change", scheduleWrite);

  // Watch the directory, not the file: atomic renames (ours, and most
  // editors') replace the inode, which would silently end a file watch.
  let watchTimer: NodeJS.Timeout | undefined;
  const watcher = fs.watch(path.dirname(file), (_event, name) => {
    if (name !== path.basename(file)) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => enqueue(ingest).then(scheduleWrite), WATCH_DEBOUNCE_MS);
  });

  return {
    handle,
    stats,
    async stop() {
      watcher.close();
      handle.off("change", scheduleWrite);
      clearTimeout(watchTimer);
      if (writeTimer) {
        clearTimeout(writeTimer);
        await enqueue(write);
      }
      await queue;
    },
  };
}
