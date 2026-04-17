// ------------------------------------------------------------------
// E2E smoke test
// Responsibility: Boot the app under `vite dev`, where
//                 installBrowserMocks swaps every Tauri capability
//                 (SQL, keychain, FS) and every provider adapter for
//                 in-memory equivalents. Exercises the end-to-end
//                 send path against the mock provider.
// ------------------------------------------------------------------

import { test, expect } from "@playwright/test";

test("create conversation and send a mocked message", async ({ page }) => {
  await page.goto("/");
  const newBtn = page.getByRole("button", { name: "New conversation" }).first();
  await expect(newBtn).toBeVisible();
  await newBtn.click();

  const composer = page.getByRole("textbox");
  await expect(composer).toBeVisible();

  // Mock directive (see providers/mock.ts) so we control the stream
  // shape without a real provider round-trip.
  await composer.fill("@mock hi [[MOCK: tokens=one|two|three]]");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("onetwothree", { exact: false })).toBeVisible({ timeout: 10_000 });
});
