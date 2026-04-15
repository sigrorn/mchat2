// E2E: inline rename of a conversation row — issue #1.
import { test, expect } from "@playwright/test";

test("double-click a conversation row to rename inline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();

  const row = page.getByRole("button", { name: "New conversation" }).nth(1);
  await expect(row).toBeVisible();
  await row.dblclick();

  const editor = page.getByRole("textbox", { name: /rename conversation/i });
  await expect(editor).toBeVisible();
  await editor.fill("My renamed chat");
  await editor.press("Enter");

  await expect(page.getByRole("button", { name: "My renamed chat" })).toBeVisible();
});
