/**
 * The results dashboard (#47) in a real browser: the links on its overview
 * land on the page they name with focus on its heading, and with the user's
 * own files the heading the user was taken to keeps focus when the engine
 * answers.
 */
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(
      `../../../packages/brokers/test/fixtures/trading212/${name}`,
      import.meta.url,
    ),
  );

const heading = (page: Page) => page.locator("#main h1");
const results = (page: Page) =>
  page.getByRole("navigation", { name: "Results" });

async function english(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("input[value=en]").check({ force: true });
}

async function demoResults(page: Page): Promise<void> {
  await english(page);
  await page.getByRole("button", { name: "Explore the demo" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  for (let step = 0; step < 2; step += 1) {
    await page.locator(".actions-row .btn-primary").click();
  }
  await expect(heading(page)).toHaveText("Overview");
}

test("the overview's links land on what they name, focused", async ({
  page,
}) => {
  await demoResults(page);

  await page
    .locator("#main")
    .getByRole("button", { name: "Show notes" })
    .click();
  await expect(heading(page)).toHaveText("Notes");
  await expect(heading(page)).toBeFocused();

  await results(page)
    .getByRole("button", { name: /^Overview/ })
    .click();
  await page.getByRole("button", { name: "View all gains" }).click();
  await expect(heading(page)).toHaveText("Gains");
  await expect(heading(page)).toBeFocused();

  await results(page)
    .getByRole("button", { name: /^Overview/ })
    .click();
  await page.getByRole("button", { name: "Download for eDavki" }).click();
  await expect(page.locator("#returns-title")).toBeFocused();
  await expect(page.locator("#returns-title")).toBeInViewport();
});

test("with own files, the heading keeps focus when the results are ready", async ({
  page,
}) => {
  await english(page);
  await page.getByRole("button", { name: "Use my files" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles([
      fixture("t212-invest-v3-2025.csv"),
      fixture("t212-invest-v4-2026.csv"),
    ]);
  await expect(page.getByText("Trading 212, 6 Jan 2026")).toBeVisible();
  await page.locator(".actions-row .btn-primary").click();
  await page.locator("#details-taxNumber").fill("12345678");
  await page.getByRole("button", { name: "See results" }).click();
  await expect(heading(page)).toHaveText("Overview");
  await expect(heading(page)).toBeFocused();
  // The engine answers: the same heading, still focused, and said aloud.
  await expect(page.getByText("Your results are ready.")).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Download Doh-KDVP" }),
  ).toBeVisible();
  await expect(heading(page)).toBeFocused();
});
