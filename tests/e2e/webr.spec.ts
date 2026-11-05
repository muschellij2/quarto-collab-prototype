import { test, expect } from "@playwright/test";

// Downloads R.wasm from webr.r-wasm.org, so this needs network access.
test("runs R chunks in the browser with webR", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.locator("#doc-id")).toHaveText(/^automerge:/);
  await page.click("#run-r");
  await expect(page.locator("#output")).toContainText("## R chunk 1", { timeout: 150_000 });
  await expect(page.locator("#output")).toContainText("[1]");
});
