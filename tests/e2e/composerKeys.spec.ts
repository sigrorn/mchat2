// Composer: Enter submits, Shift+Enter inserts newline — issue #5.
import { test, expect } from "@playwright/test";

test("Enter submits, Shift+Enter inserts newline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await expect(composer).toBeVisible();

  // Shift+Enter inserts a newline, stays in the composer.
  await composer.fill("line one");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("line two");
  await expect(composer).toHaveValue("line one\nline two");

  // Plain Enter submits; composer clears.
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
});
