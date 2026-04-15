// Right-click context menu on conversation rows — issue #14.
import { test, expect } from "@playwright/test";

test("right-click opens menu with Rename and Delete; double-click does nothing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();

  const row = page.locator("aside ul li button").first();
  await expect(row).toBeVisible();

  // Double-click MUST NOT open the rename editor anymore.
  await row.dblclick();
  await expect(page.getByRole("textbox", { name: /rename conversation/i })).toHaveCount(0);

  // Right-click opens our menu.
  await row.click({ button: "right" });
  const menu = page.getByRole("menu", { name: /conversation actions/i });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();

  // Rename through the menu opens the inline editor.
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const editor = page.getByRole("textbox", { name: /rename conversation/i });
  await expect(editor).toBeVisible();
  await editor.press("Escape");
});

test("Delete needs a confirm step and removes the conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  await page.getByRole("button", { name: "New conversation" }).first().click();
  // Two rows now.
  // First aside is the sidebar; second is the persona panel which has
  // its own ul/li ('No personas yet.') that we don't want to count.
  const rows = page.locator("aside").first().locator("ul li");
  await expect(rows).toHaveCount(2);

  // Right-click the first row, choose Delete, then Cancel — count unchanged.
  const firstBtn = page.locator("aside ul li button").first();
  await firstBtn.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: /^Cancel$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await expect(rows).toHaveCount(2);

  // Now do it for real.
  await firstBtn.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await expect(rows).toHaveCount(1);
});
