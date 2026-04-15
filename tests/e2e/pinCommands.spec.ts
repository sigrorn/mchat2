// E2E for //pin / //pins / //unpin and the pin marker — issue #11.
import { test, expect } from "@playwright/test";

test("//pin sends + pins, //pins lists, //unpin removes the pin", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await expect(composer).toBeVisible();

  // //pin sends and produces a user row that carries the pin marker.
  await composer.fill("//pin @mock remember the magic word [[MOCK: tokens=ok]]");
  await composer.press("Enter");

  // The pinned user row should be visible with a 📌 marker in its header.
  await expect(page.getByText(/remember the magic word/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-pinned='true']").first()).toBeVisible();

  // //pins lists it via a notice row.
  await composer.fill("//pins");
  await composer.press("Enter");
  await expect(page.getByText(/remember the magic word/).first()).toBeVisible();
  await expect(composer).toHaveValue("");

  // //unpin 1 removes the pin (the pinned message is the first user row).
  await composer.fill("//unpin 1");
  await composer.press("Enter");
  await expect(page.getByText(/unpinned message 1/i)).toBeVisible();
  await expect(page.locator("[data-pinned='true']")).toHaveCount(0);
});

test("//pin without targets is rejected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await composer.fill("//pin");
  await composer.press("Enter");
  await expect(page.getByText(/specify the target persona/i)).toBeVisible();
  await expect(composer).toHaveValue("//pin");
});
