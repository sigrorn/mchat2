// Layout: Settings button at bottom of sidebar, Add persona at top
// of persona panel — issue #13.
import { test, expect } from "@playwright/test";

test("Settings · Providers is positioned below all conversation rows", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();

  const lastRow = page.locator("aside ul li button").last();
  const settingsBtn = page.getByRole("button", { name: /Settings · Providers/ });

  const lastRowBox = await lastRow.boundingBox();
  const settingsBox = await settingsBtn.boundingBox();
  expect(lastRowBox).toBeTruthy();
  expect(settingsBox).toBeTruthy();
  expect(settingsBox!.y).toBeGreaterThan(lastRowBox!.y);
});

test("+ Add persona is positioned above the first persona row", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).first().click();

  // Open the create form, create one persona.
  await page.getByRole("button", { name: "+ Add persona" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Alice");
  await page.getByRole("button", { name: "Create" }).click();

  // After creation, "+ Add persona" should be visible again and sit
  // above the persona's row.
  const addBtn = page.getByRole("button", { name: "+ Add persona" });
  const personaRow = page.getByText("Alice", { exact: false }).first();

  const addBox = await addBtn.boundingBox();
  const personaBox = await personaRow.boundingBox();
  expect(addBox).toBeTruthy();
  expect(personaBox).toBeTruthy();
  expect(addBox!.y).toBeLessThan(personaBox!.y);
});
