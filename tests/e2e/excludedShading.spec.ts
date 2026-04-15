// E2E: messages before the limit mark get a visible 'excluded' marker.
// Issue #9.
import { test, expect } from "@playwright/test";

test("//limit N marks earlier rows as excluded via data-excluded='true'", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await expect(composer).toBeVisible();

  for (const word of ["alpha", "beta", "gamma"]) {
    await composer.fill(`@mock ${word} [[MOCK: tokens=${word}]]`);
    await composer.press("Enter");
    // Assistant reply is the bubble whose entire text is exactly the word.
    await expect(page.getByText(word, { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  await composer.fill("//limit 3");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");

  // Two prior user rows + their assistant replies should be marked
  // excluded; the third user row and its reply should not.
  const excluded = page.locator("[data-excluded='true']");
  await expect(excluded).toHaveCount(4);
});
