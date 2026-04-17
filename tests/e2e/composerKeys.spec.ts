// Composer: Enter submits, Shift+Enter inserts newline — issue #5.
import { test, expect } from "@playwright/test";

test("Enter submits, Shift+Enter inserts newline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByRole("textbox");
  await expect(composer).toBeVisible();

  // Shift+Enter inserts a newline, stays in the composer.
  // Prefix with @mock so the eventual Enter actually targets a provider
  // (otherwise the no-targets hint restores the text and the test
  // would observe the restore rather than the submit).
  await composer.fill("@mock line one");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("line two");
  await expect(composer).toHaveValue("@mock line one\nline two");

  // Plain Enter submits; composer clears.
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
});
