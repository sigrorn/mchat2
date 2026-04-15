// E2E: inline rename of a conversation row — issue #1.
import { test, expect } from "@playwright/test";

test("right-click a conversation row → Rename → inline editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();

  const row = page.locator("aside ul li button").first();
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();

  const editor = page.getByRole("textbox", { name: /rename conversation/i });
  await expect(editor).toBeVisible();
  await editor.fill("My renamed chat");
  await editor.press("Enter");

  await expect(page.getByRole("button", { name: "My renamed chat" })).toBeVisible();
});
