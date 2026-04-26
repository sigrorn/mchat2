// Settings · Providers dialog (#170): renamed sidebar button, two
// tabs, openai-compat preset combobox + form, register link visibility.
import { test, expect } from "@playwright/test";

test("Settings · Providers opens a tabbed dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settings · Providers/ }).click();
  // Tab strip — both tabs are present.
  await expect(page.getByRole("tab", { name: "Standard providers" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "OpenAI-compatible providers" }),
  ).toBeVisible();
});

test("Standard tab shows API-key fields and a Register link when a key is unset", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settings · Providers/ }).click();
  // Default tab is Standard. Each native provider's display name is rendered.
  // Anthropic = "Claude" in the registry.
  await expect(page.getByText("Claude", { exact: true })).toBeVisible();
  // No key set in the in-memory keychain → register link visible.
  await expect(page.getByRole("button", { name: /Register at Claude/ })).toBeVisible();
});

test("OpenAI-compat tab lists the four built-in presets in the combobox", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settings · Providers/ }).click();
  await page.getByRole("tab", { name: "OpenAI-compatible providers" }).click();

  const combo = page.getByRole("combobox", { name: /Provider/ }).first();
  await expect(combo).toBeVisible();
  // The select element should contain options for each built-in.
  const options = await combo.locator("option").allTextContents();
  expect(options.some((o) => o.includes("OpenRouter"))).toBe(true);
  expect(options.some((o) => o.includes("OVHcloud"))).toBe(true);
  expect(options.some((o) => o.includes("IONOS"))).toBe(true);
  expect(options.some((o) => o.includes("Infomaniak"))).toBe(true);
  expect(options.some((o) => o.includes("Add custom"))).toBe(true);
});

test("OpenAI-compat tab shows Infomaniak's Product ID field when selected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settings · Providers/ }).click();
  await page.getByRole("tab", { name: "OpenAI-compatible providers" }).click();

  const combo = page.getByRole("combobox", { name: /Provider/ }).first();
  await combo.selectOption({ value: "builtin:infomaniak" });

  await expect(page.getByLabel("PRODUCT_ID")).toBeVisible();
});
