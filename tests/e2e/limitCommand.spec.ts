// //limit command E2E — issue #8.
import { test, expect } from "@playwright/test";

test("//limit validates input, shows notice on error, restores text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await expect(composer).toBeVisible();

  // Get one user message on the record.
  await composer.fill("@mock hello [[MOCK: tokens=hi]]");
  await composer.press("Enter");
  await expect(page.getByText(/hello/)).toBeVisible({ timeout: 10_000 });

  // Out-of-range → notice appears, text is restored in composer.
  await composer.fill("//limit 99");
  await composer.press("Enter");
  await expect(page.getByText(/does not exist/i)).toBeVisible();
  await expect(composer).toHaveValue("//limit 99");

  // Valid limit → no notice, composer clears.
  await composer.fill("//limit 1");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
});

test("//limit without argument shows help", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await composer.fill("//limit");
  await composer.press("Enter");
  await expect(page.getByText(/specify the user message number/i)).toBeVisible();
  await expect(composer).toHaveValue("//limit");
});
