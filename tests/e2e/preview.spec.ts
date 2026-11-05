import { test, expect } from "@playwright/test";
import { hasQuarto } from "../../playwright.config";

// Browser edit -> Automerge -> filesystem bridge -> quarto preview re-render
// -> live reload of the /preview/ iframe, all through Vite's single port.
test("quarto preview re-renders collaborative edits", async ({ page }) => {
  test.skip(!hasQuarto, "quarto is not on PATH");
  test.setTimeout(120_000);
  await page.goto("/");
  const preview = page.frameLocator("#preview");
  await expect(preview.locator("h1").first()).toContainText("Collaborative Quarto", { timeout: 60_000 });

  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nRendered live from the browser.\n");

  await expect(preview.locator("body")).toContainText("Rendered live from the browser.", { timeout: 60_000 });
});
