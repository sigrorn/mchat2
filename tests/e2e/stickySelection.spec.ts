// E2E: an @-addressed send selects the targeted persona, so a follow-up
// implicit send still produces a user row + assistant row. Issue #7.
import { test, expect } from "@playwright/test";

test("implicit follow-up after @-addressed send still goes through", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();

  const composer = page.getByPlaceholder(/Type a message/);
  await expect(composer).toBeVisible();

  // First send: explicit @mock.
  await composer.fill("@mock first [[MOCK: tokens=hi]]");
  await composer.press("Enter");
  // Use a locator scoped to the chat pane to avoid matching the Debug
  // button's "set working directory first" text (#60).
  await expect(
    page.locator(".bg-neutral-100").getByText("first", { exact: false }),
  ).toBeVisible({ timeout: 10_000 });
  // Assistant reply is the bubble whose entire text is exactly 'hi'.
  await expect(page.getByText("hi", { exact: true })).toBeVisible();

  // Second send: no prefix at all. With sticky selection it still targets mock.
  await composer.fill("second [[MOCK: tokens=ok]]");
  await composer.press("Enter");

  // The user row 'second' must appear (i.e. didn't vanish into limbo).
  await expect(page.getByText("second", { exact: false })).toBeVisible({ timeout: 10_000 });
});
