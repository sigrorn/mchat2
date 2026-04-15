// Tail-follow scroll behavior — issue #6.
import { test, expect } from "@playwright/test";

test("follows the tail when pinned to bottom, leaves scroll alone otherwise", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();
  const composer = page.getByPlaceholder(/Type a message/);
  await expect(composer).toBeVisible();

  // Many-token mock message — produces a tall bubble that forces the
  // container to overflow so scroll semantics are meaningful.
  const big = Array.from({ length: 40 }, (_, i) => `chunk ${i}\n`).join("|");
  await composer.fill(`@mock [[MOCK: tokens=${big}, delay=10]]`);
  await composer.press("Enter");

  await expect(page.getByText(/chunk 39/)).toBeVisible({ timeout: 10_000 });

  // Find the scrollable message container.
  const container = page.locator(".overflow-auto").first();
  const pinnedInfo = await container.evaluate((el) => ({
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));
  expect(pinnedInfo.scrollTop + pinnedInfo.clientHeight).toBeGreaterThanOrEqual(
    pinnedInfo.scrollHeight - 16,
  );

  // Scroll to top and send another message — scrollTop must stay put.
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  await composer.fill(`@mock [[MOCK: tokens=${big}, delay=10]]`);
  await composer.press("Enter");
  // Let the stream finish.
  await page.waitForTimeout(1500);
  const afterSecond = await container.evaluate((el) => el.scrollTop);
  expect(afterSecond).toBeLessThan(100);
});
