import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repo } from "@automerge/automerge-repo";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { next as A } from "@automerge/automerge";
import { startFileBridge, type FileBridge } from "../server/fs-bridge.ts";

async function setup(initial: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-"));
  const file = path.join(dir, "paper.qmd");
  await fs.writeFile(file, initial);
  return { dir, file };
}

function open(dir: string) {
  const repo = new Repo({ storage: new NodeFSStorageAdapter(path.join(dir, ".am")) });
  return { repo, statePath: path.join(dir, "state.json") };
}

async function waitFor(cond: () => Promise<boolean> | boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting for condition");
}

const read = (f: string) => fs.readFile(f, "utf8");
const docText = (b: FileBridge) => b.handle.doc()!.text;

test("imports the file and writes browser edits back atomically", async () => {
  const { dir, file } = await setup("# Title\n\nbody\n");
  const { repo, statePath } = open(dir);
  const b = await startFileBridge({ repo, root: dir, relPath: "paper.qmd", statePath });
  assert.equal(docText(b), "# Title\n\nbody\n");

  b.handle.change((d) => A.splice(d, ["text"], 0, 0, "new line\n"));
  await waitFor(async () => (await read(file)) === "new line\n# Title\n\nbody\n");
  assert.deepEqual((await fs.readdir(dir)).filter((n) => n.startsWith(".paper.qmd.")), []);
  await b.stop();
  await repo.shutdown();
});

test("external edits flow into Automerge without an echo write", async () => {
  const { dir, file } = await setup("a\nb\n");
  const { repo, statePath } = open(dir);
  const b = await startFileBridge({ repo, root: dir, relPath: "paper.qmd", statePath });
  const writesBefore = b.stats.writes;

  await fs.writeFile(file, "a\nb\nc from vscode\n");
  await waitFor(() => docText(b) === "a\nb\nc from vscode\n");
  await new Promise((r) => setTimeout(r, 400)); // past the write debounce
  assert.equal(b.stats.writes, writesBefore);
  assert.equal(await read(file), "a\nb\nc from vscode\n");
  await b.stop();
  await repo.shutdown();
});

test("simultaneous browser and file edits are both kept", async () => {
  const { dir, file } = await setup("line1\nline2\nline3\n");
  const { repo, statePath } = open(dir);
  const b = await startFileBridge({ repo, root: dir, relPath: "paper.qmd", statePath });

  // Browser edit lands in the doc; before the debounced write, an editor saves the file.
  b.handle.change((d) => A.splice(d, ["text"], 0, 0, "BROWSER "));
  await fs.writeFile(file, "line1\nline2\nline3 EDITOR\n");

  const want = "BROWSER line1\nline2\nline3 EDITOR\n";
  await waitFor(async () => docText(b) === want && (await read(file)) === want);
  await b.stop();
  await repo.shutdown();
});

test("restart merges offline edits made to both the file and the doc", async () => {
  const { dir, file } = await setup("alpha\nbeta\n");
  let { repo, statePath } = open(dir);
  let b = await startFileBridge({ repo, root: dir, relPath: "paper.qmd", statePath });
  const url = b.handle.url;
  await b.stop();

  // While the bridge is down: a peer edits the doc, and someone edits the file.
  b.handle.change((d) => A.splice(d, ["text"], 0, 0, "peer "));
  await repo.flush();
  await repo.shutdown();
  await fs.writeFile(file, "alpha\nbeta\ngamma\n");

  ({ repo, statePath } = open(dir));
  b = await startFileBridge({ repo, root: dir, relPath: "paper.qmd", statePath });
  assert.equal(b.handle.url, url);
  const want = "peer alpha\nbeta\ngamma\n";
  await waitFor(async () => docText(b) === want && (await read(file)) === want);
  await b.stop();
  await repo.shutdown();
});

test("preserves CRLF line endings and a UTF-8 BOM", async () => {
  const { dir, file } = await setup("﻿one\r\ntwo\r\n");
  const { repo, statePath } = open(dir);
  const b = await startFileBridge({ repo, root: dir, relPath: "paper.qmd", statePath });
  assert.equal(docText(b), "one\ntwo\n");

  b.handle.change((d) => A.splice(d, ["text"], 8, 0, "three\n"));
  await waitFor(async () => (await read(file)) === "﻿one\r\ntwo\r\nthree\r\n");
  await b.stop();
  await repo.shutdown();
});
