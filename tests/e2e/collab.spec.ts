import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";

const editorText = (page: Page) =>
  page.evaluate(() => document.querySelector(".cm-content")!.textContent ?? "");

// Two separate browser contexts share no IndexedDB or BroadcastChannel, so
// they can only converge through the WebSocket sync server behind /sync.
test("two browsers converge on concurrent edits", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));

  await a.goto("/");
  await expect(a.locator("#doc-id")).toHaveText(/^automerge:/);
  const url = a.url();
  expect(url).toContain("#automerge");

  await b.goto(url);
  await expect(b.locator(".cm-content")).toContainText("Collaborative Quarto");

  // A types at the end, B types at the start, at the same time.
  await a.locator(".cm-content").click();
  await b.locator(".cm-content").click();
  await Promise.all([
    a.keyboard.press("ControlOrMeta+End").then(() => a.keyboard.type("from-A")),
    b.keyboard.press("ControlOrMeta+Home").then(() => b.keyboard.type("from-B")),
  ]);

  for (const p of [a, b]) {
    await expect(p.locator(".cm-content")).toContainText("from-A");
    await expect(p.locator(".cm-content")).toContainText("from-B");
  }
  expect(await editorText(a)).toBe(await editorText(b));
  expect(errors).toEqual([]);

  // The filesystem bridge materializes the merged text into the real file.
  await expect
    .poll(() => fs.readFile("e2e-root/index.qmd", "utf8"))
    .toMatch(/^from-B---[\s\S]*from-A$/);
});
