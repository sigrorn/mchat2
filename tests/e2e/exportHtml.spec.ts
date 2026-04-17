// E2E: right-click → Export to HTML calls fs.writeText — issue #17.
import { test, expect } from "@playwright/test";

test("Export to HTML appears in the conversation context menu and writes a file", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  // Send a message so the export has content.
  const composer = page.getByRole("textbox");
  await composer.fill("@mock hello [[MOCK: tokens=hi]]");
  await composer.press("Enter");
  await expect(page.getByText(/hello/)).toBeVisible({ timeout: 10_000 });

  const row = page.locator("aside").first().locator("ul li button").first();
  await row.click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: /Export to HTML/i });
  await expect(menuItem).toBeVisible();
  await menuItem.click();

  // The browser-mock fs.saveDialog returns a fixed path; the orchestrator
  // then calls fs.writeText against the same in-memory store. Surface a
  // success notice in the chat so we can observe completion.
  await expect(page.getByText(/exported to/i)).toBeVisible({ timeout: 10_000 });
});
